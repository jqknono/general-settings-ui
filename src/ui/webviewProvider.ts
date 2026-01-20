import * as vscode from 'vscode';
import * as path from 'path';
import { SchemaManager, SchemaInfo } from '../schema/schemaManager';
import { SettingsFormGenerator } from './settingsFormGenerator';

export class WebviewProvider implements vscode.Disposable {
    private readonly _webviewPanelMap = new Map<string, vscode.WebviewPanel>();
    private readonly _panelToIdMap = new Map<vscode.WebviewPanel, string>();
    private readonly _pendingDataMap = new Map<string, { schemaUrl?: string; baseFilePath?: string; jsonData?: string }>();
    private readonly _sourceUriMap = new Map<vscode.WebviewPanel, vscode.Uri>();
    private readonly _autoSaveTimers = new Map<string, NodeJS.Timeout>();
    private readonly _docToWebviewSyncTimers = new Map<string, NodeJS.Timeout>();
    private readonly _suppressNextDocToWebviewSync = new Map<string, { json: string; ts: number }>();
    private readonly _panelSchemaUrlMap = new Map<string, string>();
    private readonly _panelByDocument = new WeakMap<vscode.TextDocument, vscode.WebviewPanel>();
    private readonly _messageQueueMap = new Map<string, Promise<void>>();
    private readonly _lastAppliedRevMap = new Map<string, { sessionId?: string; rev: number }>();
    private _hasShownAutoSaveFailure = false;
    private _hasShownOutputChannel = false;
    private readonly _outputChannel: vscode.OutputChannel;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _settingsFormGenerator: SettingsFormGenerator;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _schemaManager: SchemaManager
    ) {
        this._settingsFormGenerator = new SettingsFormGenerator(this._schemaManager);
        this._outputChannel = vscode.window.createOutputChannel('JSON Schema Store GUI');
        this._disposables.push(this._outputChannel);
        this._registerDocumentSyncListeners();
        this._registerDocumentRebindListeners();
    }

    private _rankSchemasForQuery(query: string, schemas: SchemaInfo[], limit: number): SchemaInfo[] {
        const q = String(query || '').trim().toLowerCase();
        const max = Math.max(1, limit | 0);

        const safeText = (v: unknown) => String(v || '').toLowerCase();

        const scored = schemas.map((schema) => {
            const name = safeText(schema?.name);
            const desc = safeText(schema?.description);
            const fileMatches = Array.isArray(schema?.fileMatch) ? schema.fileMatch.map(safeText).join(' ') : '';

            let score = 0;

            if (!q) {
                score = 1;
            } else if (name === q) {
                score = 1000;
            } else if (name.startsWith(q)) {
                score = 850;
            } else if (name.includes(q)) {
                score = 650;
            }

            if (q && score < 1000) {
                if (fileMatches.includes(q)) {
                    score += 260;
                }
                if (desc.includes(q)) {
                    score += 180;
                }
            }

            return { schema, score };
        });

        scored.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return String(a.schema?.name || '').localeCompare(String(b.schema?.name || ''));
        });

        return scored.slice(0, max).map(s => s.schema);
    }

    private _registerDocumentRebindListeners() {
        const listener = vscode.workspace.onDidSaveTextDocument(
            (document) => {
                const panel = this._panelByDocument.get(document);
                if (!panel) {
                    return;
                }

                const oldPanelId = this._panelToIdMap.get(panel);
                const newPanelId = document.uri.toString();

                if (!oldPanelId) {
                    return;
                }
                if (oldPanelId === newPanelId) {
                    return;
                }

                const existing = this._webviewPanelMap.get(newPanelId);
                if (existing && existing !== panel) {
                    this._log('warn', 'Detected panelId collision after save; skipping auto rebind', {
                        oldPanelId,
                        newPanelId,
                        uri: document.uri.toString()
                    });
                    return;
                }

                const moveKey = <T>(map: Map<string, T>, fromKey: string, toKey: string) => {
                    if (!map.has(fromKey)) {
                        return;
                    }
                    const v = map.get(fromKey);
                    map.delete(fromKey);
                    if (v !== undefined) {
                        map.set(toKey, v);
                    }
                };

                // 1) 更新面板主键映射（Untitled -> file）
                this._webviewPanelMap.delete(oldPanelId);
                this._webviewPanelMap.set(newPanelId, panel);
                this._panelToIdMap.set(panel, newPanelId);

                // 2) 搬迁所有以 panelId 为 key 的状态
                moveKey(this._pendingDataMap, oldPanelId, newPanelId);
                moveKey(this._messageQueueMap, oldPanelId, newPanelId);
                moveKey(this._lastAppliedRevMap, oldPanelId, newPanelId);
                moveKey(this._panelSchemaUrlMap, oldPanelId, newPanelId);
                moveKey(this._docToWebviewSyncTimers, oldPanelId, newPanelId);
                moveKey(this._suppressNextDocToWebviewSync, oldPanelId, newPanelId);

                // 3) 更新写回绑定 URI
                this._sourceUriMap.set(panel, document.uri);

                this._log('info', 'Detected document Save As; auto re-bound Visual Editor to new URI', {
                    oldPanelId,
                    newPanelId,
                    uri: document.uri.toString()
                });

                try {
                    panel.title = `Visual Editor (${document.isUntitled ? 'Untitled' : path.basename(document.uri.fsPath)})`;
                } catch {
                    // ignore
                }
            },
            undefined,
            this._disposables
        );

        this._disposables.push(listener);
    }

    private _registerDocumentSyncListeners() {
        const listener = vscode.workspace.onDidChangeTextDocument(
            (event) => {
                const document = event.document;
                if (!document) {
	                    return;
	                }
	                if (document.languageId !== 'json') {
	                    return;
	                }

	                const panelId = document.uri.toString();
	                const panel = this._webviewPanelMap.get(panelId);
	                if (!panel) {
	                    return;
	                }

                const suppressed = this._suppressNextDocToWebviewSync.get(panelId);
                if (suppressed) {
                    const now = Date.now();
                    // 仅抑制“刚刚由 webview 写回”的那一次变更，避免输入时光标跳动/循环同步
                    if (now - suppressed.ts < 2000 && document.getText() === suppressed.json) {
                        this._suppressNextDocToWebviewSync.delete(panelId);
                        return;
                    }
                }

                const existing = this._docToWebviewSyncTimers.get(panelId);
                if (existing) {
                    clearTimeout(existing);
                }

                // editor -> webview 同步防抖：合并同一轮输入产生的多次 change 事件（1 秒）
	                const timer = setTimeout(async () => {
	                    this._docToWebviewSyncTimers.delete(panelId);

	                    const stillPanel = this._webviewPanelMap.get(panelId);
	                    if (!stillPanel) {
	                        return;
	                    }

                    let jsonData: any;
                    try {
                        jsonData = this._parseJsonWithTrailingCommas(document.getText());
                    } catch (error) {
                        this._log('warn', `Source JSON is temporarily not parseable; skipping sync to webview: panelId=${panelId}`, {
                            uri: document.uri.toString(),
                            error: error instanceof Error ? error.message : String(error)
                        });
                        stillPanel.webview.postMessage({
                            command: 'showError',
                            error: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`
                        });
                        return;
                    }

                    const nextSchemaUrl = typeof jsonData?.$schema === 'string' ? jsonData.$schema : undefined;
                    const prevSchemaUrl = this._panelSchemaUrlMap.get(panelId);
                    if (nextSchemaUrl && nextSchemaUrl !== prevSchemaUrl) {
                        this._log('info', `Detected $schema change; reloading schema: panelId=${panelId}`, {
                            prevSchemaUrl,
                            nextSchemaUrl,
                            uri: document.uri.toString()
                        });
                        this._panelSchemaUrlMap.set(panelId, nextSchemaUrl);
                        await this._loadSchema(stillPanel.webview, nextSchemaUrl, document.uri.fsPath);
                    }

                    stillPanel.webview.postMessage({
                        command: 'loadJson',
                        json: JSON.stringify(jsonData, null, 2)
                    });
                }, 1000);

                this._docToWebviewSyncTimers.set(panelId, timer);
            },
            undefined,
            this._disposables
        );

        this._disposables.push(listener);
    }

    private _postBoundSourceInfo(webview: vscode.Webview, sourceDocument?: vscode.TextDocument) {
        if (!sourceDocument) {
            return;
        }
        webview.postMessage({
            command: 'boundSource',
            source: {
                uri: sourceDocument.uri.toString(),
                fsPath: sourceDocument.uri.fsPath,
                isUntitled: sourceDocument.isUntitled
            }
        });
    }

    private _safeJson(value: any): string {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    private _truncate(value: string, max: number): string {
        if (value.length <= max) {
            return value;
        }
        return `${value.slice(0, max)}…(+${value.length - max} chars)`;
    }

    private _log(level: 'debug' | 'info' | 'warn' | 'error', message: string, extra?: any) {
        const ts = new Date().toISOString();
        const suffix = extra === undefined ? '' : ` | ${this._truncate(this._safeJson(extra), 2000)}`;
        const line = `[${ts}][${level}] ${message}${suffix}`;
        this._outputChannel.appendLine(line);

        if (level === 'error') {
            console.error(line);
        } else if (level === 'warn') {
            console.warn(line);
        } else {
            console.log(line);
        }
    }

    private _enqueueMessage(panel: vscode.WebviewPanel, message: any) {
        const panelId = this._panelToIdMap.get(panel) || panel?.viewType || 'unknown-panel';
        const prev = this._messageQueueMap.get(panelId) || Promise.resolve();

        const next = prev
            .catch(error => {
                this._log('warn', `Previous message handling failed; continuing with next messages: panelId=${panelId}`, {
                    error: error instanceof Error ? error.message : String(error)
                });
            })
            .then(async () => {
                this._log('debug', `Start handling webview message: panelId=${panelId}`, {
                    command: message?.command,
                    meta: message?.meta
                });
                await this._handleWebviewMessage(message, panel);
                this._log('debug', `Finished handling webview message: panelId=${panelId}`, {
                    command: message?.command,
                    meta: message?.meta
                });
            })
            .catch(error => {
                this._log('error', `Failed to handle webview message: panelId=${panelId}`, {
                    command: message?.command,
                    meta: message?.meta,
                    error: error instanceof Error ? error.stack || error.message : String(error)
                });
            });

        this._messageQueueMap.set(panelId, next);
    }

    /**
     * 解析 JSON，支持尾随逗号（trailing commas）
     */
    private _parseJsonWithTrailingCommas(content: string): any {
        // 移除字符串中的尾随逗号（在 } 或 ] 之前的逗号）
        const cleanedContent = content.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(cleanedContent);
    }

    public async openEditor(schemaUrl?: string, sourceDocument?: vscode.TextDocument) {
        if (!this._hasShownOutputChannel) {
            this._hasShownOutputChannel = true;
            this._outputChannel.show(true);
        }

        this._log('info', 'openEditor invoked', {
            schemaUrl,
            source: sourceDocument ? { uri: sourceDocument.uri.toString(), isUntitled: sourceDocument.isUntitled } : undefined,
            active: vscode.window.activeTextEditor?.document?.uri?.toString()
        });

        // 如果未提供 sourceDocument，尝试绑定到当前活动 JSON；否则提示用户选择/新建
        if (!sourceDocument) {
            const active = vscode.window.activeTextEditor?.document;
            if (active && active.languageId === 'json') {
                sourceDocument = active;
            } else {
                const choice = await vscode.window.showQuickPick(
                    [
                        { label: 'Choose a JSON file…', value: 'pick' as const },
                        { label: 'Create a new JSON file (Untitled)', value: 'new' as const }
                    ],
                    { placeHolder: 'The visual editor must be bound to a JSON file (changes will be written back).' }
                );

                if (!choice) {
                    return;
                }

                if (choice.value === 'pick') {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        filters: { JSON: ['json'] },
                        openLabel: 'Bind to this JSON file'
                    });

                    const uri = picked?.[0];
                    if (!uri) {
                        return;
                    }

                    sourceDocument = await vscode.workspace.openTextDocument(uri);
                } else {
                    const initial = schemaUrl
                        ? JSON.stringify({ $schema: schemaUrl }, null, 2)
                        : JSON.stringify({}, null, 2);
                    sourceDocument = await vscode.workspace.openTextDocument({
                        language: 'json',
                        content: `${initial}\n`
                    });
                    // 给用户一个可见的“绑定对象”（可手动保存到磁盘）
                    await vscode.window.showTextDocument(sourceDocument, vscode.ViewColumn.Active);
                }
            }
        }

        // 以绑定文件 URI 作为面板 key：同一 JSON 文件复用同一个 Visual Editor
        const panelId = sourceDocument.uri.toString();
        const sourceFilePath = sourceDocument.uri.fsPath;
        let jsonData: any = null;

        let panel = this._webviewPanelMap.get(panelId);
        const isNewPanel = !panel;
        
        if (sourceDocument) {
            try {
                this._log('info', 'Read and parse source JSON', { uri: sourceDocument.uri.toString(), fsPath: sourceDocument.uri.fsPath });
                const content = sourceDocument.getText();
                jsonData = this._parseJsonWithTrailingCommas(content);
                this._log('debug', 'Source JSON parsed successfully (trailing commas supported)', {
                    uri: sourceDocument.uri.toString(),
                    topKeys: jsonData && typeof jsonData === 'object' ? Object.keys(jsonData).slice(0, 30) : [],
                    hasSchema: !!jsonData?.$schema
                });

                if (!schemaUrl && jsonData.$schema) {
                    schemaUrl = jsonData.$schema;
                    this._log('info', 'Extracted $schema from source JSON', { schemaUrl });
                }
            } catch (error) {
                this._log('error', 'Failed to parse source JSON', {
                    uri: sourceDocument.uri.toString(),
                    error: error instanceof Error ? error.stack || error.message : String(error)
                });
                vscode.window.showErrorMessage(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        
        if (!panel) {
            const newPanel = vscode.window.createWebviewPanel(
                'jsonSchemaStoreGUI.editor',
                `Visual Editor (${sourceDocument.isUntitled ? 'Untitled' : path.basename(sourceFilePath)})`,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this._context.extensionUri, 'webview'),
                        vscode.Uri.joinPath(this._context.extensionUri, 'out', 'webview')
                    ]
                }
            );

            // 先建立面板映射，确保消息队列等逻辑可以稳定拿到 panelId
            this._webviewPanelMap.set(panelId, newPanel);
            this._panelToIdMap.set(newPanel, panelId);

            // 存储绑定的源文件 URI（确保之后始终写回同一个 JSON 文件）
            this._sourceUriMap.set(newPanel, sourceDocument.uri);

            newPanel.webview.html = this._getHtmlForWebview(newPanel.webview);

            newPanel.onDidDispose(() => {
                this._webviewPanelMap.delete(panelId);
                this._panelToIdMap.delete(newPanel);
                this._pendingDataMap.delete(panelId);
                this._sourceUriMap.delete(newPanel);
                this._panelSchemaUrlMap.delete(panelId);
                this._suppressNextDocToWebviewSync.delete(panelId);
                const timer = this._docToWebviewSyncTimers.get(panelId);
                if (timer) {
                    clearTimeout(timer);
                    this._docToWebviewSyncTimers.delete(panelId);
                }
                this._messageQueueMap.delete(panelId);
                this._lastAppliedRevMap.delete(panelId);
                this._log('info', 'Webview panel disposed', { panelId });
            });

            newPanel.webview.onDidReceiveMessage(
                (message: any) => {
                    this._enqueueMessage(newPanel, message);
                },
                undefined,
                this._disposables
            );

            panel = newPanel;
        } else {
            // 复用面板时，刷新绑定 URI（防止旧引用）
            this._sourceUriMap.set(panel, sourceDocument.uri);
            panel.title = `Visual Editor (${sourceDocument.isUntitled ? 'Untitled' : path.basename(sourceFilePath)})`;
        }

        this._panelByDocument.set(sourceDocument, panel);

        if (schemaUrl || jsonData) {
            this._log('info', `Preparing initial payload for panel: panelId=${panelId}`, {
                schemaUrl,
                hasJsonData: !!jsonData,
                sourceFilePath
            });
            if (isNewPanel) {
                this._pendingDataMap.set(panelId, {
                    schemaUrl,
                    baseFilePath: sourceFilePath,
                    jsonData: jsonData ? JSON.stringify(jsonData, null, 2) : undefined
                });
                if (schemaUrl) {
                    this._panelSchemaUrlMap.set(panelId, schemaUrl);
                }
            } else {
                // 面板已就绪（retainContextWhenHidden=true），直接下发数据即可
                if (schemaUrl) {
                    this._panelSchemaUrlMap.set(panelId, schemaUrl);
                    await this._loadSchema(panel.webview, schemaUrl, sourceFilePath);
                }
                if (jsonData) {
                    panel.webview.postMessage({
                        command: 'loadJson',
                        json: JSON.stringify(jsonData, null, 2)
                    });
                }
            }
        }

        // 面板已存在/已就绪时，立即告知 webview 当前绑定源文件信息
        if (!isNewPanel) {
            this._postBoundSourceInfo(panel.webview, sourceDocument);
        }

        panel.reveal();
    }

    public async openEditorFromActive() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('No active JSON file');
            return;
        }

        if (activeEditor.document.languageId !== 'json') {
            vscode.window.showWarningMessage('Please open a JSON file');
            return;
        }

        await this.openEditor(undefined, activeEditor.document);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'out', 'webview', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'webview', 'styles.css')
        );

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Settings Editor</title>
            <link href="${styleUri}" rel="stylesheet">
        </head>
        <body>
            <div class="container">
                <div class="settings-topbar">
                    <div class="settings-search-wrapper" id="settingsSearchWrapper">
                        <input id="settingsSearch" class="settings-search-input" type="search" placeholder="Search settings" autocomplete="off" />
                        <div id="settingsSearchResults" class="settings-search-results hidden" role="listbox" aria-label="Search results"></div>
                    </div>
                </div>
                <header class="header">
                    <div class="header-left">
                        <h1 id="schemaTitle">Settings Editor</h1>
                        <span id="schemaDescription" class="schema-description">Visual JSON Schema Settings Editor</span>
                        <span id="boundSource" class="bound-source"></span>
                    </div>
                    <div class="header-right">
                        <button id="openSchemaDialogBtn" class="action-button" type="button">Select Schema</button>
                    </div>
                </header>

                <div class="main-content">
                    <div class="form-panel">
                        <div class="form-container">
                            <div id="formEditor" class="form-editor">
                                <div class="empty-state">
                                    <span class="codicon codicon-file-code"></span>
                                    <p>Please select a Schema to start editing</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="schemaStoreDialog" class="dialog hidden" role="dialog" aria-modal="true" aria-labelledby="schemaStoreDialogTitle">
                <div class="dialog-content">
                    <div class="dialog-header">
                        <h2 id="schemaStoreDialogTitle">Select Schema</h2>
                        <button id="schemaStoreCloseBtn" class="icon-button" type="button" aria-label="Close dialog">
                            <span class="codicon codicon-close"></span>
                        </button>
                    </div>
                    <div class="dialog-body">
                        <div class="schema-dialog-toolbar">
                            <input id="schemaStoreSearchInput" class="control-input schema-store-search" type="search" placeholder="Search Schema..." autocomplete="off" />
                            <button id="schemaStoreRefreshBtn" class="action-button secondary" type="button">Refresh</button>
                        </div>
                        <div id="schemaStoreList" class="schema-list"></div>
                        <div class="schema-dialog-footer">
                            <span class="schema-dialog-footer-text">Source: SchemaStore.org</span>
                            <a class="schema-dialog-link" href="https://www.schemastore.org/" target="_blank" rel="noreferrer">Open</a>
                        </div>
                    </div>
                </div>
            </div>

            <script type="module" src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    private async _handleWebviewMessage(
        message: any,
        panel: vscode.WebviewPanel
    ) {
        if (!panel) {
            return;
        }

        const panelId = this._panelToIdMap.get(panel) || 'unknown-panel';

        // 从映射中获取绑定的源文件 URI（始终写回同一个 JSON 文件）
        const sourceUri = this._sourceUriMap.get(panel);
        let sourceDocument: vscode.TextDocument | undefined;
        if (sourceUri) {
            try {
                sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
            } catch (error) {
                this._log('error', `Failed to open bound source document: panelId=${panelId}`, {
                    sourceUri: sourceUri.toString(),
                    error: error instanceof Error ? error.stack || error.message : String(error)
                });
            }
        }

        switch (message.command) {
            case 'ready':
                this._log('info', `Webview ready: panelId=${panelId}`, {
                    sourceUri: sourceDocument?.uri?.toString(),
                    pendingKeys: Array.from(this._pendingDataMap.keys())
                });
                this._postBoundSourceInfo(panel.webview, sourceDocument);
                {
                    const sessionId = typeof message?.meta?.sessionId === 'string' ? message.meta.sessionId : undefined;
                    if (sessionId) {
                        const lastApplied = this._lastAppliedRevMap.get(panelId);
                        if (!lastApplied || lastApplied.sessionId !== sessionId) {
                            // webview 发生 reload 时，rev 会从 0 重新开始；这里按 sessionId 重置，避免误判为“过期消息”
                            this._lastAppliedRevMap.set(panelId, { sessionId, rev: 0 });
                            this._log('debug', `Detected new webview sessionId; reset lastAppliedRev: panelId=${panelId}`, {
                                sessionId,
                                prevSessionId: lastApplied?.sessionId,
                                prevRev: lastApplied?.rev
                            });
                        }
                    }
                }
                if (panelId) {
                    const pendingData = this._pendingDataMap.get(panelId);
                    this._log('debug', `Read pendingData: panelId=${panelId}`, pendingData);
                    if (pendingData) {
                        if (pendingData.schemaUrl) {
                            this._panelSchemaUrlMap.set(panelId, pendingData.schemaUrl);
                            await this._loadSchema(panel.webview, pendingData.schemaUrl, pendingData.baseFilePath);
                        }
                        if (pendingData.jsonData) {
                            panel.webview.postMessage({
                                command: 'loadJson',
                                json: pendingData.jsonData
                            });
                        }
                        this._pendingDataMap.delete(panelId);
                    }
                }
                break;
            case 'getLanguage':
                {
                    const config = vscode.workspace.getConfiguration('jsonSchemaStoreGUI');
                    const raw = config.get<string>('defaultLanguage', 'en-us');
                    const language = raw === 'zh-cn' ? 'zh-cn' : 'en-us';
                    panel.webview.postMessage({
                        command: 'language',
                        language
                    });
                }
                break;
            case 'schemaStoreSearch':
                {
                    const query = typeof message?.query === 'string' ? message.query : '';
                    const requestId = typeof message?.requestId === 'string' ? message.requestId : '';

                    try {
                        const all = await this._schemaManager.searchSchemas(query);
                        const ranked = this._rankSchemasForQuery(query, all, 200);
                        panel.webview.postMessage({
                            command: 'schemaStoreSearchResult',
                            requestId,
                            query,
                            total: all.length,
                            schemas: ranked.map(s => ({
                                name: s.name,
                                description: s.description,
                                url: s.url,
                                fileMatch: s.fileMatch
                            }))
                        });
                    } catch (error) {
                        panel.webview.postMessage({
                            command: 'schemaStoreSearchResult',
                            requestId,
                            query,
                            total: 0,
                            schemas: [],
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
                break;
            case 'schemaStoreRefresh':
                {
                    const query = typeof message?.query === 'string' ? message.query : '';
                    const requestId = typeof message?.requestId === 'string' ? message.requestId : '';

                    try {
                        await this._schemaManager.refreshCache();
                        const all = await this._schemaManager.searchSchemas(query);
                        const ranked = this._rankSchemasForQuery(query, all, 200);
                        panel.webview.postMessage({
                            command: 'schemaStoreSearchResult',
                            requestId,
                            query,
                            total: all.length,
                            schemas: ranked.map(s => ({
                                name: s.name,
                                description: s.description,
                                url: s.url,
                                fileMatch: s.fileMatch
                            }))
                        });
                    } catch (error) {
                        panel.webview.postMessage({
                            command: 'schemaStoreSearchResult',
                            requestId,
                            query,
                            total: 0,
                            schemas: [],
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
                break;
            case 'loadSchema':
                this._log('info', `Received loadSchema: panelId=${panelId}`, {
                    schemaUrl: message?.schemaUrl,
                    baseFilePath: sourceDocument?.uri?.fsPath
                });
                this._postBoundSourceInfo(panel.webview, sourceDocument);
                if (typeof message?.schemaUrl === 'string' && message.schemaUrl.trim()) {
                    this._panelSchemaUrlMap.set(panelId, message.schemaUrl.trim());
                }
                await this._loadSchema(panel.webview, message.schemaUrl, sourceDocument?.uri.fsPath);
                break;
            case 'log':
                this._log(
                    (message?.level as any) || 'info',
                    `Webview log: panelId=${panelId} | ${message?.text || ''}`,
                    { data: message?.data, meta: message?.meta, sourceUri: sourceDocument?.uri?.toString() }
                );
                break;
            case 'updateJson':
                if (!sourceDocument) {
                    vscode.window.showWarningMessage('Not bound to a JSON file: cannot write visual changes back to the source file.');
                    this._log('warn', `updateJson failed: no bound source document: panelId=${panelId}`, {
                        meta: message?.meta
                    });
                    panel.webview.postMessage({
                        command: 'updateJsonAck',
                        meta: {
                            ok: false,
                            reason: 'no-bound-document',
                            panelId,
                            rev: message?.meta?.rev
                        }
                    });
                    return;
                }

                {
                    const rev = typeof message?.meta?.rev === 'number' ? message.meta.rev : undefined;
                    const sessionId = typeof message?.meta?.sessionId === 'string' ? message.meta.sessionId : undefined;
                    const lastApplied = this._lastAppliedRevMap.get(panelId);
                    const lastAppliedRev = lastApplied?.rev;
                    const lastSessionId = lastApplied?.sessionId;

                    if (
                        typeof rev === 'number' &&
                        typeof lastAppliedRev === 'number' &&
                        rev <= lastAppliedRev &&
                        // 若 sessionId 不同，说明 webview 重载过，rev 重新开始，此时不应当按“过期”丢弃
                        (!sessionId || !lastSessionId || sessionId === lastSessionId)
                    ) {
                        this._log('warn', `Ignored stale updateJson: panelId=${panelId}`, {
                            rev,
                            lastAppliedRev,
                            sessionId,
                            lastSessionId,
                            meta: message?.meta
                        });
                        panel.webview.postMessage({
                            command: 'updateJsonAck',
                            meta: { ok: false, ignored: true, reason: 'stale-rev', panelId, rev, lastAppliedRev }
                        });
                        return;
                    }

                    const result = await this._updateJson(panel.webview, message.json, sourceDocument, {
                        panelId,
                        meta: message?.meta
                    });
                    if (result.ok && typeof rev === 'number') {
                        this._lastAppliedRevMap.set(panelId, { sessionId, rev });
                    }
                }
                break;
            case 'updateForm':
                if (!sourceDocument) {
                    vscode.window.showWarningMessage('Not bound to a JSON file: cannot write visual changes back to the source file.');
                    this._log('warn', `updateForm failed: no bound source document: panelId=${panelId}`, {
                        meta: message?.meta
                    });
                    return;
                }
                await this._updateForm(panel.webview, message.data, sourceDocument, {
                    panelId,
                    meta: message?.meta
                });
                break;
            default:
                this._log('warn', `Received unknown command: panelId=${panelId}`, { command: message?.command, message });
                break;
        }
    }

    private async _loadSchema(webview: vscode.Webview, schemaUrl: string, baseFilePath?: string) {
        try {
            this._log('info', 'Start loading schema', { schemaUrl, baseFilePath });
            const schema = await this._schemaManager.getSchema(schemaUrl, baseFilePath);
            this._log('info', 'Schema loaded successfully', {
                schemaUrl,
                baseFilePath,
                title: schema?.title,
                hasProperties: !!schema?.properties
            });
            const settingsHtml = await this._settingsFormGenerator.generateSettingsForm(schemaUrl, baseFilePath);
            this._log('info', 'Settings HTML generated', { length: settingsHtml.length, schemaUrl });
            webview.postMessage({
                command: 'loadSchema',
                schema: schema,
                settingsHtml: settingsHtml
            });
        } catch (error) {
            this._log('error', 'Failed to load schema', {
                schemaUrl,
                baseFilePath,
                error: error instanceof Error ? error.stack || error.message : String(error)
            });
            vscode.window.showErrorMessage(`Failed to load schema: ${error instanceof Error ? error.message : String(error)}`);
            webview.postMessage({
                command: 'showError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async _replaceDocumentText(sourceDocument: vscode.TextDocument, text: string): Promise<boolean> {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            sourceDocument.positionAt(0),
            sourceDocument.positionAt(sourceDocument.getText().length)
        );
        edit.replace(sourceDocument.uri, fullRange, text);
        return vscode.workspace.applyEdit(edit);
    }

    private async _updateJson(
        webview: vscode.Webview,
        json: string,
        sourceDocument?: vscode.TextDocument,
        context?: { panelId?: string; meta?: any }
    ): Promise<{ ok: boolean; noop?: boolean; reason?: string }> {
        if (sourceDocument) {
            try {
                const panelId = context?.panelId || 'unknown-panel';
                const rev = context?.meta?.rev;

                this._log('info', `Preparing to write JSON: panelId=${panelId}`, {
                    rev,
                    uri: sourceDocument.uri.toString(),
                    isUntitled: sourceDocument.isUntitled,
                    isClosed: sourceDocument.isClosed,
                    version: sourceDocument.version,
                    beforeLength: sourceDocument.getText().length,
                    incomingLength: typeof json === 'string' ? json.length : -1,
                    meta: context?.meta
                });

                if (sourceDocument.isClosed) {
                    this._log('warn', `Write failed: source document is closed: panelId=${panelId}`, { uri: sourceDocument.uri.toString(), rev });
                    webview.postMessage({
                        command: 'updateJsonAck',
                        meta: { ok: false, reason: 'document-closed', panelId, rev, uri: sourceDocument.uri.toString() }
                    });
                    return { ok: false, reason: 'document-closed' };
                }

                const currentText = sourceDocument.getText();
                if (currentText === json) {
                    this._log('debug', `Write skipped: content unchanged: panelId=${panelId}`, { rev, uri: sourceDocument.uri.toString() });
                    webview.postMessage({
                        command: 'updateJsonAck',
                        meta: {
                            ok: true,
                            noop: true,
                            reason: 'no-change',
                            panelId,
                            rev,
                            uri: sourceDocument.uri.toString(),
                            version: sourceDocument.version,
                            isDirty: sourceDocument.isDirty
                        }
                    });
                    return { ok: true, noop: true, reason: 'no-change' };
                }

                // 标记下一次文档 change 事件为“来自 webview 的写回”，避免 doc->webview 的反向同步导致光标跳动
                this._suppressNextDocToWebviewSync.set(panelId, { json, ts: Date.now() });

                const ok = await this._replaceDocumentText(sourceDocument, json);
                if (!ok) {
                    this._suppressNextDocToWebviewSync.delete(panelId);
                    vscode.window.showWarningMessage('Failed to write JSON: the document may be read-only or not editable. Check file permissions or re-bind the source file.');
                    this._log('error', `Write failed: workspace.applyEdit returned false: panelId=${panelId}`, {
                        rev,
                        uri: sourceDocument.uri.toString()
                    });
                    webview.postMessage({
                        command: 'updateJsonAck',
                        meta: { ok: false, reason: 'applyEdit-false', panelId, rev, uri: sourceDocument.uri.toString() }
                    });
                    return { ok: false, reason: 'applyEdit-false' };
                }

                this._log('info', `Write completed: panelId=${panelId}`, {
                    rev,
                    uri: sourceDocument.uri.toString(),
                    afterLength: sourceDocument.getText().length,
                    version: sourceDocument.version,
                    isDirty: sourceDocument.isDirty
                });
                await this._scheduleAutoSave(sourceDocument);
                webview.postMessage({
                    command: 'updateJsonAck',
                    meta: {
                        ok: true,
                        panelId,
                        rev,
                        uri: sourceDocument.uri.toString(),
                        version: sourceDocument.version,
                        isDirty: sourceDocument.isDirty
                    }
                });
                return { ok: true };
            } catch (error) {
                const panelId = context?.panelId || 'unknown-panel';
                const rev = context?.meta?.rev;
                this._log('error', `Write error: panelId=${panelId}`, {
                    rev,
                    uri: sourceDocument.uri.toString(),
                    error: error instanceof Error ? error.stack || error.message : String(error)
                });
                webview.postMessage({
                    command: 'updateJsonAck',
                    meta: {
                        ok: false,
                        reason: 'exception',
                        panelId,
                        rev,
                        uri: sourceDocument.uri.toString(),
                        error: error instanceof Error ? error.message : String(error)
                    }
                });
                return { ok: false, reason: 'exception' };
            }
        }
        return { ok: false, reason: 'no-document' };
    }

    private async _updateForm(
        webview: vscode.Webview,
        data: any,
        sourceDocument?: vscode.TextDocument,
        context?: { panelId?: string; meta?: any }
    ) {
        if (sourceDocument) {
            try {
                const panelId = context?.panelId || 'unknown-panel';
                this._log('info', `Received updateForm: panelId=${panelId}`, {
                    uri: sourceDocument.uri.toString(),
                    meta: context?.meta
                });
                const json = JSON.stringify(data, null, 2);
                const ok = await this._replaceDocumentText(sourceDocument, json);
                if (!ok) {
                    vscode.window.showWarningMessage('Failed to write JSON: the document may be read-only or not editable. Check file permissions or re-bind the source file.');
                    this._log('error', `updateForm write failed: workspace.applyEdit returned false: panelId=${panelId}`, {
                        uri: sourceDocument.uri.toString()
                    });
                    return;
                }
                await this._scheduleAutoSave(sourceDocument);
            } catch (error) {
                const panelId = context?.panelId || 'unknown-panel';
                this._log('error', `updateForm write error: panelId=${panelId}`, {
                    uri: sourceDocument.uri.toString(),
                    error: error instanceof Error ? error.stack || error.message : String(error)
                });
            }
        }
    }

    private async _scheduleAutoSave(sourceDocument: vscode.TextDocument) {
        const config = vscode.workspace.getConfiguration('jsonSchemaStoreGUI');
        const enabled = config.get<boolean>('autoSaveOnEdit', true);
        if (!enabled) {
            this._log('debug', 'Auto save disabled (autoSaveOnEdit=false)', { uri: sourceDocument.uri.toString() });
            return;
        }

        // 避免 Untitled 文档触发“另存为”弹窗
        if (sourceDocument.isUntitled) {
            this._log('debug', 'Skip auto save: untitled document', { uri: sourceDocument.uri.toString() });
            return;
        }

        const debounceMs = Math.max(0, config.get<number>('autoSaveDebounceMs', 800));
        const key = sourceDocument.uri.toString();
        this._log('debug', 'Schedule auto save', { uri: key, debounceMs });

        const existing = this._autoSaveTimers.get(key);
        if (existing) {
            clearTimeout(existing);
            this._log('debug', 'Canceled previous auto save timer', { uri: key });
        }

        const timer = setTimeout(async () => {
            this._autoSaveTimers.delete(key);
            try {
                // 可能用户已关闭文档
                if (sourceDocument.isClosed) {
                    this._log('debug', 'Auto save skipped: document closed', { uri: key });
                    return;
                }

                // 没有脏改动则无需保存
                if (!sourceDocument.isDirty) {
                    this._log('debug', 'Auto save skipped: document not dirty', { uri: key, version: sourceDocument.version });
                    return;
                }

                this._log('info', 'Start auto save', { uri: key, version: sourceDocument.version });
                const ok = await sourceDocument.save();
                if (!ok && sourceDocument.isDirty) {
                    // 某些情况下 save() 可能返回 false（例如文档状态变更），回退到 saveAll
                    this._log('warn', 'sourceDocument.save() returned false; falling back to workspace.saveAll()', { uri: key });
                    await vscode.workspace.saveAll(false);
                }

                if (sourceDocument.isDirty && !this._hasShownAutoSaveFailure) {
                    this._hasShownAutoSaveFailure = true;
                    vscode.window.showWarningMessage(
                        'Auto save failed: changes were applied but could not be persisted to disk. Please save manually or check file permissions.'
                    );
                    this._log('warn', 'Auto save failed: document is still dirty', { uri: key, version: sourceDocument.version });
                }
                if (!sourceDocument.isDirty) {
                    this._log('info', 'Auto save succeeded', { uri: key, version: sourceDocument.version });
                }
            } catch (error) {
                this._log('error', 'Auto save error', {
                    uri: key,
                    error: error instanceof Error ? error.stack || error.message : String(error)
                });
                if (!this._hasShownAutoSaveFailure) {
                    this._hasShownAutoSaveFailure = true;
                    vscode.window.showWarningMessage(
                        `Auto save failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }, debounceMs);

        this._autoSaveTimers.set(key, timer);
    }

    public dispose() {
        this._disposables.forEach(d => d.dispose());
        this._webviewPanelMap.forEach(panel => panel.dispose());
        this._webviewPanelMap.clear();
        this._panelToIdMap.clear();
        this._pendingDataMap.clear();
        this._sourceUriMap.clear();
        this._panelSchemaUrlMap.clear();
        this._suppressNextDocToWebviewSync.clear();
        this._docToWebviewSyncTimers.forEach(timer => clearTimeout(timer));
        this._docToWebviewSyncTimers.clear();
        this._autoSaveTimers.forEach(timer => clearTimeout(timer));
        this._autoSaveTimers.clear();
    }
}
