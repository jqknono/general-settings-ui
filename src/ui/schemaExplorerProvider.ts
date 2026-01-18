import * as vscode from 'vscode';
import { SchemaInfo, SchemaManager } from '../schema/schemaManager';

export class SchemaExplorerProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'jsonSchemaStoreGUISchemaExplorer';
    
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _schemaManager: SchemaManager
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 监听来自webview的消息
        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'selectSchema':
                        this._selectSchema(message.schemaId);
                        break;
                    case 'refreshSchemas':
                        this._refreshSchemas();
                        break;
                    case 'searchSchemas':
                        this._searchSchemas(message.query);
                        break;
                }
            },
            undefined,
            this._disposables
        );

        // 初始加载schema列表
        this._loadSchemas();
    }

    public refresh() {
        if (this._view) {
            this._loadSchemas();
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Schema Explorer</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    margin: 0;
                    padding: 10px;
                }
                
                .header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 10px;
                    gap: 5px;
                }
                
                .search-box {
                    flex: 1;
                    padding: 4px 8px;
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 2px;
                }
                
                .refresh-btn {
                    padding: 4px 8px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 2px;
                    cursor: pointer;
                }
                
                .refresh-btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                .schema-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                
                .schema-item {
                    padding: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    cursor: pointer;
                    transition: background-color 0.1s;
                }
                
                .schema-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .schema-item.selected {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }
                
                .schema-name {
                    font-weight: bold;
                    margin-bottom: 2px;
                }
                
                .schema-description {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                
                .loading {
                    text-align: center;
                    padding: 20px;
                    color: var(--vscode-descriptionForeground);
                }
                
                .no-results {
                    text-align: center;
                    padding: 20px;
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <input type="text" class="search-box" placeholder="Search schemas..." id="searchInput">
                <button class="refresh-btn" id="refreshBtn">Refresh</button>
            </div>
            <div id="schemaList" class="schema-list">
                <div class="loading">Loading...</div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                const searchInput = document.getElementById('searchInput');
                const refreshBtn = document.getElementById('refreshBtn');
                const schemaList = document.getElementById('schemaList');
                
                let searchTimeout;
                
                // 搜索功能
                searchInput.addEventListener('input', (e) => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        vscode.postMessage({
                            command: 'searchSchemas',
                            query: e.target.value
                        });
                    }, 300);
                });
                
                // 刷新按钮
                refreshBtn.addEventListener('click', () => {
                    vscode.postMessage({
                        command: 'refreshSchemas'
                    });
                });
                
                // 接收来自扩展的消息
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.type) {
                        case 'updateSchemaList':
                            renderSchemaList(message.schemas);
                            break;
                        case 'showLoading':
                            showLoading();
                            break;
                        case 'showError':
                            showError(message.error);
                            break;
                    }
                });
                
                function renderSchemaList(schemas) {
                    if (!schemas || schemas.length === 0) {
                        schemaList.innerHTML = '<div class="no-results">No schemas found</div>';
                        return;
                    }
                    
                    const html = schemas.map(schema => \`
                        <div class="schema-item" data-schema-id="\${schema.id}">
                            <div class="schema-name">\${schema.name}</div>
                            <div class="schema-description">\${schema.description || 'No description'}</div>
                        </div>
                    \`).join('');
                    
                    schemaList.innerHTML = html;
                    
                    // 添加点击事件
                    schemaList.querySelectorAll('.schema-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const schemaId = item.getAttribute('data-schema-id');
                            vscode.postMessage({
                                command: 'selectSchema',
                                schemaId: schemaId
                            });
                        });
                    });
                }
                
                function showLoading() {
                    schemaList.innerHTML = '<div class="loading">Loading...</div>';
                }
                
                function showError(error) {
                    schemaList.innerHTML = \`<div class="no-results">Error: \${error}</div>\`;
                }
            </script>
        </body>
        </html>`;
    }

    private async _loadSchemas() {
        try {
            const schemas = await this._schemaManager.getAllSchemas();
            this._sendToWebview({
                type: 'updateSchemaList',
                schemas: schemas.map((schema: SchemaInfo) => ({
                    id: schema.url,
                    name: schema.name,
                    description: schema.description
                }))
            });
        } catch (error) {
            this._sendToWebview({
                type: 'showError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private _selectSchema(schemaId: string) {
        // 打开编辑器
        vscode.commands.executeCommand('jsonSchemaStoreGUI.openEditor', schemaId);
    }

    private async _refreshSchemas() {
        this._sendToWebview({ type: 'showLoading' });
        try {
            await this._schemaManager.refreshCache();
            await this._loadSchemas();
        } catch (error) {
            this._sendToWebview({
                type: 'showError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async _searchSchemas(query: string) {
        try {
            const schemas = await this._schemaManager.searchSchemas(query);
            this._sendToWebview({
                type: 'updateSchemaList',
                schemas: schemas.map((schema: SchemaInfo) => ({
                    id: schema.url,
                    name: schema.name,
                    description: schema.description
                }))
            });
        } catch (error) {
            this._sendToWebview({
                type: 'showError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private _sendToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private get _extensionUri(): vscode.Uri {
        // 这里需要从context获取，暂时使用当前工作目录
        return vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file('.');
    }
}
