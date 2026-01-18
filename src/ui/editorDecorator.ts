import * as vscode from 'vscode';

export class EditorDecoratorManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _statusBarItem: vscode.StatusBarItem;

    constructor() {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = 'jsonSchemaStoreGUI.openEditorFromActive';

        this._registerListeners();
    }

    /**
     * 解析 JSON，支持尾随逗号（trailing commas）
     */
    private _parseJsonWithTrailingCommas(content: string): any {
        const cleanedContent = content.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(cleanedContent);
    }

    private _registerListeners() {
        const activeEditorChangeListener = vscode.window.onDidChangeActiveTextEditor(
            (editor) => {
                this._updateEditorDecorations(editor);
            },
            null,
            this._disposables
        );

        const documentChangeListener = vscode.workspace.onDidChangeTextDocument(
            (event) => {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === event.document) {
                    this._updateEditorDecorations(editor);
                }
            },
            null,
            this._disposables
        );

        const textEditorSelectionChangeListener = vscode.window.onDidChangeTextEditorSelection(
            (event) => {
                if (event.selections.length === 1 && event.selections[0].start.line === 0) {
                    const editor = event.textEditor;
                    if (editor && editor.document.languageId === 'json') {
                        try {
                            const content = editor.document.getText();
                            const jsonData = this._parseJsonWithTrailingCommas(content);
                            if (jsonData.$schema) {
                                vscode.commands.executeCommand('jsonSchemaStoreGUI.openEditorFromActive');
                            }
                        } catch (error) {
                            // Ignore parsing errors
                        }
                    }
                }
            },
            null,
            this._disposables
        );

        this._disposables.push(
            activeEditorChangeListener,
            documentChangeListener,
            textEditorSelectionChangeListener
        );
    }

    private async _updateEditorDecorations(editor: vscode.TextEditor | undefined) {
        if (!editor || editor.document.languageId !== 'json') {
            this._statusBarItem.hide();
            return;
        }

        try {
            const content = editor.document.getText();
            const jsonData = this._parseJsonWithTrailingCommas(content);

            if (jsonData.$schema) {
                this._statusBarItem.text = '$(split-right) Open Visual Editor';
                this._statusBarItem.tooltip = 'Open visual configuration editor';
                this._statusBarItem.show();
            } else {
                this._statusBarItem.hide();
            }
        } catch (error) {
            this._statusBarItem.hide();
        }
    }

    public dispose() {
        this._statusBarItem.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}