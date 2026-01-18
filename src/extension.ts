import * as vscode from 'vscode';
import { SchemaManager } from './schema/schemaManager';
import { WebviewProvider } from './ui/webviewProvider';
import { SchemaExplorerProvider } from './ui/schemaExplorerProvider';
import { EditorDecoratorManager } from './ui/editorDecorator';

let schemaManager: SchemaManager;
let webviewProvider: WebviewProvider;
let schemaExplorerProvider: SchemaExplorerProvider;
let editorDecoratorManager: EditorDecoratorManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('JSON Schema Store GUI extension activated');

    schemaManager = new SchemaManager(context);
    webviewProvider = new WebviewProvider(context, schemaManager);
    schemaExplorerProvider = new SchemaExplorerProvider(schemaManager);
    editorDecoratorManager = new EditorDecoratorManager();

    const isUri = (value: unknown): value is vscode.Uri => {
        return (
            !!value &&
            typeof value === 'object' &&
            typeof (value as vscode.Uri).scheme === 'string' &&
            typeof (value as vscode.Uri).toString === 'function'
        );
    };

    const openEditorCommand = vscode.commands.registerCommand(
        'jsonSchemaStoreGUI.openEditor',
        async (...args: any[]) => {
            // 可能的调用形式：
            // - openEditor(schemaUrl: string)                 （Schema Explorer / 命令面板）
            // - openEditor(resource: vscode.Uri)              （editor/context 等菜单）
            // - openEditor(schemaUrl: string, resource: Uri)  （自定义调用）
            let schemaUrl: string | undefined;
            let resource: vscode.Uri | undefined;

            for (const arg of args) {
                if (typeof arg === 'string' && arg.trim()) {
                    schemaUrl = arg.trim();
                    continue;
                }
                if (isUri(arg)) {
                    resource = arg;
                }
            }

            if (resource) {
                const doc = await vscode.workspace.openTextDocument(resource);
                await webviewProvider.openEditor(schemaUrl, doc);
                return;
            }

            if (schemaUrl) {
                await webviewProvider.openEditor(schemaUrl);
                return;
            }

            // 兼容从编辑器右键菜单触发（无参数）时，默认使用当前活动 JSON 文件
            await webviewProvider.openEditorFromActive();
        }
    );

    const openEditorFromActiveCommand = vscode.commands.registerCommand(
        'jsonSchemaStoreGUI.openEditorFromActive',
        async (resource?: vscode.Uri) => {
            // editor/title 菜单通常会把当前资源 URI 作为第一个参数传入
            if (isUri(resource)) {
                const doc = await vscode.workspace.openTextDocument(resource);
                await webviewProvider.openEditor(undefined, doc);
                return;
            }

            await webviewProvider.openEditorFromActive();
        }
    );

    const searchSchemaCommand = vscode.commands.registerCommand(
        'jsonSchemaStoreGUI.searchSchema',
        async () => {
            const schemas = await schemaManager.searchSchemas('');
            const quickPickItems = schemas.map(schema => ({
                label: schema.name,
                description: schema.description,
                url: schema.url
            }));
            
            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Select a schema to edit'
            });
            
            if (selected) {
                webviewProvider.openEditor(selected.url);
            }
        }
    );

    const refreshSchemasCommand = vscode.commands.registerCommand(
        'jsonSchemaStoreGUI.refreshSchemas',
        async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Refresh schema cache',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Refreshing...' });
                await schemaManager.refreshCache();
                progress.report({ increment: 100, message: 'Done' });
            });
            
            vscode.window.showInformationMessage('Schema cache refreshed');
            schemaExplorerProvider.refresh();
        }
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'jsonSchemaStoreGUISchemaExplorer',
            schemaExplorerProvider
        )
    );

    context.subscriptions.push(
        openEditorCommand,
        openEditorFromActiveCommand,
        searchSchemaCommand,
        refreshSchemasCommand,
        editorDecoratorManager
    );

    initializeExtension(context);
}

async function initializeExtension(context: vscode.ExtensionContext) {
    try {
        const needsInit = await schemaManager.needsInitialization();
        
        if (needsInit) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Initialize schema cache',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Downloading schema catalog...' });
                await schemaManager.initializeCache();
                progress.report({ increment: 100, message: 'Done' });
            });
        }
    } catch (error) {
        console.error('Extension initialization failed:', error);
        vscode.window.showErrorMessage(
            `Extension initialization failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export function deactivate() {
    console.log('JSON Schema Store GUI extension deactivated');
}
