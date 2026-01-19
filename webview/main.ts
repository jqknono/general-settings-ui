export {};

declare global {
    interface Window {
        vscode?: any;
    }
}

declare function acquireVsCodeApi(): any;

interface SettingsSearchItem {
    key: string;
    title: string;
    description: string;
    categoryDomId: string;
    categoryTitle: string;
    propertyDomId: string;
}

interface TopLevelUiTarget {
    propertyDomId: string;
    categoryDomId: string;
    categoryTitle: string;
}

type UiLanguage = 'en-us' | 'zh-cn';

const SCHEMA_STORE_UI_TEXT: Record<
    UiLanguage,
    {
        openButton: string;
        dialogTitle: string;
        searchPlaceholder: string;
        refresh: string;
        loading: string;
        noResults: string;
        errorPrefix: string;
        sourceLabel: string;
    }
> = {
    'en-us': {
        openButton: 'Select Schema',
        dialogTitle: 'Select Schema',
        searchPlaceholder: 'Search Schema...',
        refresh: 'Refresh',
        loading: 'Loading...',
        noResults: 'No schemas found',
        errorPrefix: 'Error',
        sourceLabel: 'Source: SchemaStore.org'
    },
    'zh-cn': {
        openButton: '选择Schema',
        dialogTitle: '选择Schema',
        searchPlaceholder: '搜索Schema...',
        refresh: '刷新',
        loading: '加载中...',
        noResults: '未找到匹配的Schema',
        errorPrefix: '加载失败',
        sourceLabel: '来源: SchemaStore.org'
    }
};

class SettingsEditorApp {
    schema: any;
    data: any;
    currentSchemaUrl: string | null;
    private _baseData: any;
    private _dirtyPaths: Set<string>;
    private _dirtyCollectionPaths: Set<string>;
    private _formSyncTimer: number | null;
    private _formSyncDebounceMs: number;
    private _sessionId: string;
    private _syncRev: number;
    private _lastSentRev: number;
    private _lastAckRev: number;
    private _lastSentJsonText: string | null;
    private _lastSentJsonTs: number;
    private _searchIndex: SettingsSearchItem[];
    private _searchResults: SettingsSearchItem[];
    private _searchSelectedIndex: number;
    private _searchField: any | null;
    private _searchResultsEl: HTMLElement | null;
    private _searchWrapperEl: HTMLElement | null;
    private _uiLanguage: UiLanguage;
    private _schemaDialogEl: HTMLElement | null;
    private _schemaDialogTitleEl: HTMLElement | null;
    private _schemaDialogFooterTextEl: HTMLElement | null;
    private _schemaOpenBtnEl: HTMLButtonElement | null;
    private _schemaCloseBtnEl: HTMLButtonElement | null;
    private _schemaSearchInputEl: HTMLInputElement | null;
    private _schemaRefreshBtnEl: HTMLButtonElement | null;
    private _schemaListEl: HTMLElement | null;
    private _schemaSearchTimer: number | null;
    private _schemaLastRequestId: string;
    private _schemaLastQuery: string;

    constructor() {
        // VS Code webview 与扩展通信的桥接对象
        window.vscode = acquireVsCodeApi();

        this.schema = null;
        this.data = {};
        this._baseData = {};
        this._dirtyPaths = new Set<string>();
        this._dirtyCollectionPaths = new Set<string>();
        this._formSyncTimer = null;
        // 用户期望“任何改动立即同步到源 JSON”，这里不再做输入防抖
        this._formSyncDebounceMs = 0;
        this._sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        this._syncRev = 0;
        this._lastSentRev = 0;
        this._lastAckRev = 0;
        this._lastSentJsonText = null;
        this._lastSentJsonTs = 0;
        this.currentSchemaUrl = null;
        this._searchIndex = [];
        this._searchResults = [];
        this._searchSelectedIndex = -1;
        this._searchField = null;
        this._searchResultsEl = null;
        this._searchWrapperEl = null;
        this._uiLanguage = 'en-us';
        this._schemaDialogEl = null;
        this._schemaDialogTitleEl = null;
        this._schemaDialogFooterTextEl = null;
        this._schemaOpenBtnEl = null;
        this._schemaCloseBtnEl = null;
        this._schemaSearchInputEl = null;
        this._schemaRefreshBtnEl = null;
        this._schemaListEl = null;
        this._schemaSearchTimer = null;
        this._schemaLastRequestId = '';
        this._schemaLastQuery = '';
        
        this.init();
    }

    async init() {
        window.addEventListener('message', (event) => {
            this.handleMessage(event.data);
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupUI());
        } else {
            this.setupUI();
        }
    }

    setupUI() {
        this._searchWrapperEl = document.getElementById('settingsSearchWrapper');
        this._searchField = document.getElementById('settingsSearch') as any;
        this._searchResultsEl = document.getElementById('settingsSearchResults');

        if (this._searchField) {
            this._searchField.addEventListener('input', () => this.handleSearchInput());
            this._searchField.addEventListener('keydown', (e: KeyboardEvent) => this.handleSearchKeydown(e));
            this._searchField.addEventListener('focus', () => this.maybeShowSearchResults());
        }

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            const isFind = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f';
            if (isFind && this._searchField) {
                e.preventDefault();
                this._searchField.focus();
            }
        });

        document.addEventListener('click', (e) => {
            if (!this._searchWrapperEl || !this._searchResultsEl) return;
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (this._searchWrapperEl.contains(target)) return;
            this.hideSearchResults();
        });

        this.setupSchemaStoreDialog();

        this.debugLog('webview ready: postMessage(ready)', { sessionId: this._sessionId });
        this.postMessage({ command: 'ready', meta: { sessionId: this._sessionId, ts: Date.now() } });
        this.postMessage({ command: 'getLanguage' });
    }

    handleMessage(message) {
        switch (message.command) {
            case 'loadSchema':
                this.debugLog('recv loadSchema', {
                    sessionId: this._sessionId,
                    hasSchema: !!message.schema,
                    settingsHtmlLength: message.settingsHtml ? String(message.settingsHtml).length : 0
                });
                this.loadSchema(message.schema, message.settingsHtml);
                break;
            case 'loadJson':
                this.debugLog('recv loadJson', {
                    sessionId: this._sessionId,
                    length: message.json ? String(message.json).length : 0
                });
                // Ignore the JSON echoed back from our own write to avoid full re-render (which blurs focused inputs).
                if (
                    typeof message?.json === 'string' &&
                    this._lastSentJsonText &&
                    Date.now() - this._lastSentJsonTs < 2500
                ) {
                    const echoed = this.safeParseJsonText(message.json);
                    const sent = this.safeParseJsonText(this._lastSentJsonText);
                    if (echoed !== undefined && sent !== undefined && this.deepEqualJson(echoed, sent)) {
                        this.debugLog('ignore loadJson (echo from self, semantically equal)', {
                            sessionId: this._sessionId,
                            rev: this._lastSentRev,
                            tsDeltaMs: Date.now() - this._lastSentJsonTs
                        });
                        return;
                    }
                }
                this.updateData(message.json);
                break;
            case 'boundSource':
                this.updateBoundSource(message.source);
                break;
            case 'language':
                this.handleLanguage(message.language);
                break;
            case 'schemaStoreSearchResult':
                this.handleSchemaStoreSearchResult(message);
                break;
            case 'updateForm':
                this.debugLog('recv updateForm', { sessionId: this._sessionId });
                this.updateFormData(message.data);
                break;
            case 'updateJsonAck':
                this.handleUpdateJsonAck(message.meta);
                break;
            case 'showError':
                this.showError(message.error);
                break;
        }
    }

    private handleLanguage(language: any) {
        const next = language === 'zh-cn' ? 'zh-cn' : 'en-us';
        this._uiLanguage = next;
        this.applySchemaStoreUiTexts();
    }

    private tSchemaStore<K extends keyof (typeof SCHEMA_STORE_UI_TEXT)['en-us']>(key: K): string {
        const langPack = SCHEMA_STORE_UI_TEXT[this._uiLanguage] || SCHEMA_STORE_UI_TEXT['en-us'];
        return (langPack as any)[key] || (SCHEMA_STORE_UI_TEXT['en-us'] as any)[key] || String(key);
    }

    private setupSchemaStoreDialog() {
        this._schemaOpenBtnEl = document.getElementById('openSchemaDialogBtn') as HTMLButtonElement | null;
        this._schemaDialogEl = document.getElementById('schemaStoreDialog');
        this._schemaDialogTitleEl = document.getElementById('schemaStoreDialogTitle');
        this._schemaDialogFooterTextEl = this._schemaDialogEl
            ? (this._schemaDialogEl.querySelector('.schema-dialog-footer-text') as HTMLElement | null)
            : null;
        this._schemaCloseBtnEl = document.getElementById('schemaStoreCloseBtn') as HTMLButtonElement | null;
        this._schemaSearchInputEl = document.getElementById('schemaStoreSearchInput') as HTMLInputElement | null;
        this._schemaRefreshBtnEl = document.getElementById('schemaStoreRefreshBtn') as HTMLButtonElement | null;
        this._schemaListEl = document.getElementById('schemaStoreList');

        this.applySchemaStoreUiTexts();

        if (this._schemaOpenBtnEl) {
            this._schemaOpenBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openSchemaStoreDialog();
            });
        }

        if (this._schemaCloseBtnEl) {
            this._schemaCloseBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeSchemaStoreDialog();
            });
        }

        if (this._schemaDialogEl) {
            this._schemaDialogEl.addEventListener('click', (e) => {
                if (e.target === this._schemaDialogEl) {
                    this.closeSchemaStoreDialog();
                }
            });
        }

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (!this._schemaDialogEl) return;
            if (this._schemaDialogEl.classList.contains('hidden')) return;
            this.closeSchemaStoreDialog();
        });

        if (this._schemaSearchInputEl) {
            this._schemaSearchInputEl.addEventListener('input', () => {
                if (this._schemaSearchTimer !== null) {
                    window.clearTimeout(this._schemaSearchTimer);
                }
                this._schemaSearchTimer = window.setTimeout(() => {
                    this._schemaSearchTimer = null;
                    const q = String(this._schemaSearchInputEl?.value || '');
                    this.requestSchemaStoreSearch(q, 'search');
                }, 200);
            });
        }

        if (this._schemaRefreshBtnEl) {
            this._schemaRefreshBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                const q = String(this._schemaSearchInputEl?.value || '');
                this.requestSchemaStoreSearch(q, 'refresh');
            });
        }
    }

    private applySchemaStoreUiTexts() {
        if (this._schemaOpenBtnEl) this._schemaOpenBtnEl.textContent = this.tSchemaStore('openButton');
        if (this._schemaDialogTitleEl) this._schemaDialogTitleEl.textContent = this.tSchemaStore('dialogTitle');
        if (this._schemaSearchInputEl) this._schemaSearchInputEl.placeholder = this.tSchemaStore('searchPlaceholder');
        if (this._schemaRefreshBtnEl) this._schemaRefreshBtnEl.textContent = this.tSchemaStore('refresh');
        if (this._schemaDialogFooterTextEl) this._schemaDialogFooterTextEl.textContent = this.tSchemaStore('sourceLabel');
    }

    private openSchemaStoreDialog() {
        if (!this._schemaDialogEl) return;
        this._schemaDialogEl.classList.remove('hidden');
        if (this._schemaSearchInputEl) {
            this._schemaSearchInputEl.focus();
            this._schemaSearchInputEl.select();
        }
        const q = String(this._schemaSearchInputEl?.value || '');
        this.requestSchemaStoreSearch(q, 'search');
    }

    private closeSchemaStoreDialog() {
        if (!this._schemaDialogEl) return;
        this._schemaDialogEl.classList.add('hidden');
    }

    private newRequestId(): string {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    private requestSchemaStoreSearch(query: string, mode: 'search' | 'refresh') {
        const requestId = this.newRequestId();
        this._schemaLastRequestId = requestId;
        this._schemaLastQuery = String(query || '');
        this.renderSchemaStoreLoading();
        this.postMessage({
            command: mode === 'refresh' ? 'schemaStoreRefresh' : 'schemaStoreSearch',
            query: this._schemaLastQuery,
            requestId
        });
    }

    private renderSchemaStoreLoading() {
        if (!this._schemaListEl) return;
        this._schemaListEl.innerHTML = `
            <div class="loading">
                <span class="codicon codicon-loading"></span>
                <p>${this.escapeHtml(this.tSchemaStore('loading'))}</p>
            </div>
        `;
    }

    private handleSchemaStoreSearchResult(message: any) {
        const requestId = typeof message?.requestId === 'string' ? message.requestId : '';
        if (requestId && this._schemaLastRequestId && requestId !== this._schemaLastRequestId) {
            return;
        }
        const schemas = Array.isArray(message?.schemas) ? message.schemas : [];
        const error = typeof message?.error === 'string' ? message.error : '';
        this.renderSchemaStoreList(schemas, error);
    }

    private renderSchemaStoreList(schemas: any[], error: string) {
        if (!this._schemaListEl) return;

        if (error) {
            this._schemaListEl.innerHTML = `
                <div class="no-results">
                    <span class="codicon codicon-warning"></span>
                    <p>${this.escapeHtml(this.tSchemaStore('errorPrefix'))}: ${this.escapeHtml(error)}</p>
                </div>
            `;
            return;
        }

        if (!schemas || schemas.length === 0) {
            this._schemaListEl.innerHTML = `
                <div class="no-results">
                    <span class="codicon codicon-search"></span>
                    <p>${this.escapeHtml(this.tSchemaStore('noResults'))}</p>
                </div>
            `;
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const schema of schemas) {
            const url = typeof schema?.url === 'string' ? schema.url : '';
            if (!url) continue;

            const item = document.createElement('div');
            item.className = 'schema-item';
            item.dataset.url = url;

            const name = document.createElement('div');
            name.className = 'schema-name';
            name.textContent = String(schema?.name || url);

            const description = document.createElement('div');
            description.className = 'schema-item-description';
            description.textContent = String(schema?.description || '');

            const fm = Array.isArray(schema?.fileMatch) ? schema.fileMatch.filter((x: any) => typeof x === 'string') : [];
            if (fm.length > 0) {
                const fileMatch = document.createElement('div');
                fileMatch.className = 'schema-item-filematch';
                fileMatch.textContent = fm.slice(0, 6).join(', ');
                description.appendChild(fileMatch);
            }

            item.appendChild(name);
            item.appendChild(description);

            item.addEventListener('click', () => {
                this.closeSchemaStoreDialog();
                this.loadSchema(url);
            });

            fragment.appendChild(item);
        }

        this._schemaListEl.innerHTML = '';
        this._schemaListEl.appendChild(fragment);
    }

    private updateBoundSource(source: any) {
        const el = document.getElementById('boundSource');
        if (!el) return;

        const fsPath = typeof source?.fsPath === 'string' ? source.fsPath : '';
        const uri = typeof source?.uri === 'string' ? source.uri : '';
        const isUntitled = !!source?.isUntitled;

        const baseName = (() => {
            const raw = fsPath || uri;
            const parts = String(raw).split(/[\\/]/g).filter(Boolean);
            return parts.length > 0 ? parts[parts.length - 1] : raw;
        })();

        el.textContent = isUntitled ? `Bound file: ${baseName || 'Untitled (unsaved)'}` : `Bound file: ${baseName}`;
        el.setAttribute('title', fsPath || uri);
    }

    async loadSchema(schemaUrlOrObject, settingsHtml?: string) {
        try {
            console.log('loadSchema called with:', schemaUrlOrObject, 'settingsHtml length:', settingsHtml?.length);
            let schema;
            let schemaUrl;

            if (typeof schemaUrlOrObject === 'string') {
                schemaUrl = schemaUrlOrObject;
                this.postMessage({
                    command: 'loadSchema',
                    schemaUrl: schemaUrl
                });
                return;
            } else {
                schema = schemaUrlOrObject;
                schemaUrl = schemaUrlOrObject.url;
            }

            this.schema = schema;
            this.currentSchemaUrl = schemaUrl;
            console.log('Schema loaded, currentSchemaUrl:', this.currentSchemaUrl);

            const titleElement = document.getElementById('schemaTitle');
            const descriptionElement = document.getElementById('schemaDescription');
            
            if (titleElement && schema.title) {
                titleElement.textContent = schema.title;
            }
            
            if (descriptionElement && schema.description) {
                descriptionElement.textContent = schema.description;
            }

            if (settingsHtml) {
                const formEditor = document.getElementById('formEditor');
                if (formEditor) {
                    formEditor.innerHTML = settingsHtml;
                    this.setupFormEventListeners();
                    this.renderArrayObjectItemsFromData(this._baseData);
                    this.renderMapObjectItemsFromData(this._baseData);
                    this.updateFormInputs();
                    this.syncAnyOfObjectsFromData(this._baseData);
                    this.buildSearchIndex();
                    this.handleSearchInput();
                }
            }
        } catch (error) {
            console.error('Load schema failed:', error);
            this.showError(`Failed to load schema: ${error.message}`);
        }
    }

    setupFormEventListeners() {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return;

        formEditor.querySelectorAll('.sidebar-item').forEach(item => {
            (item as HTMLElement).addEventListener('click', () => {
                const el = item as HTMLElement;
                const targetId = el.getAttribute('data-scroll-to') || '';
                if (targetId) {
                    this.activateSidebarItem(el);
                    this.scrollToSettingId(targetId);
                }
            });
        });

        formEditor.addEventListener('change', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (target.classList.contains('anyof-selector')) {
                this.handleAnyOfSelectorChange(target as any);
                return;
            }
            if (!target.dataset || !target.dataset.path) return;
            if (target.classList.contains('map-key-input')) {
                const mapPath = this.getCollectionRootForControl(target);
                const itemEl = target.closest('.map-item') as HTMLElement | null;
                if (mapPath && itemEl) {
                    this.rebindMapItem(mapPath, itemEl);
                    this.validateMapObject(mapPath);
                }
            }
            this.applyControlValidations(target);
            this.markDirtyFromControl(target);
            this.handleFormChange('change', target.dataset.path);
        });

        // 输入时立即同步（默认 change 只会在失焦后触发）
        formEditor.addEventListener('input', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (!target.dataset || !target.dataset.path) return;

            if (target.classList.contains('map-key-input')) {
                const mapPath = this.getCollectionRootForControl(target);
                const itemEl = target.closest('.map-item') as HTMLElement | null;
                if (mapPath && itemEl) {
                    this.rebindMapItem(mapPath, itemEl);
                    this.validateMapObject(mapPath);
                }
            }

            this.applyControlValidations(target);

            // 避免与 change 重复触发（checkbox/select 通常已在 change 中处理）
            const type = target.dataset.type;
            const tag = (target as any).tagName ? String((target as any).tagName).toUpperCase() : '';
            if (type === 'boolean' || tag === 'SELECT') return;

            this.markDirtyFromControl(target);
            this.handleFormChange('input', target.dataset.path);
        });

        formEditor.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            const addBtn = target.closest('.array-add-button') as HTMLElement | null;
            if (addBtn) {
                const arrayPath = addBtn.getAttribute('data-array-path') || '';
                if (arrayPath) {
                    this.addArrayItem(arrayPath);
                    this.handleFormChange('array-add', arrayPath);
                }
                return;
            }

            const removeBtn = target.closest('.array-remove-button') as HTMLElement | null;
            if (removeBtn) {
                const arrayPath = removeBtn.getAttribute('data-array-path') || '';
                const itemEl = target.closest('.array-item') as HTMLElement | null;
                if (arrayPath && itemEl) {
                    this.removeArrayItem(arrayPath, itemEl);
                    this.handleFormChange('array-remove', arrayPath);
                }
                return;
            }

            const mapAddBtn = target.closest('.map-add-button') as HTMLElement | null;
            if (mapAddBtn) {
                const mapPath = mapAddBtn.getAttribute('data-map-path') || '';
                if (mapPath) {
                    this.addMapItem(mapPath);
                    this.handleFormChange('map-add', mapPath);
                }
                return;
            }

            const mapRemoveBtn = target.closest('.map-remove-button') as HTMLElement | null;
            if (mapRemoveBtn) {
                const mapPath = mapRemoveBtn.getAttribute('data-map-path') || '';
                const itemEl = target.closest('.map-item') as HTMLElement | null;
                if (mapPath && itemEl) {
                    this.removeMapItem(mapPath, itemEl);
                    this.handleFormChange('map-remove', mapPath);
                }
            }
        });
    }

    switchCategory(categoryId: string) {
        const sidebarItems = document.querySelectorAll('.sidebar-item');
        sidebarItems.forEach(item => {
            if ((item as HTMLElement).dataset.category === categoryId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        const categories = document.querySelectorAll('.settings-category');
        categories.forEach(category => {
            if (category.id === `category-${categoryId}`) {
                category.classList.remove('hidden');
            } else {
                category.classList.add('hidden');
            }
        });
    }

    private activateSidebarItem(item: HTMLElement) {
        document.querySelectorAll('.sidebar-item.active').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
    }

    private scrollToSettingId(settingId: string) {
        const target = document.getElementById(settingId) as HTMLElement | null;
        if (!target) return;

        document.querySelectorAll('.property-item.search-target').forEach(el => el.classList.remove('search-target'));
        target.classList.add('search-target');
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        window.setTimeout(() => target.classList.remove('search-target'), 1400);
    }

    private handleFormChange(reason: string, hintPath?: string) {
        const updated = this.buildUpdatedJson();
        if (JSON.stringify(updated) !== JSON.stringify(this.data)) {
            this.data = updated;
            const rev = ++this._syncRev;
            this._lastSentRev = rev;

            const dirtyPaths = Array.from(this._dirtyPaths);
            const dirtyCollections = Array.from(this._dirtyCollectionPaths);
            const json = JSON.stringify(this.data, null, 2);
            this._lastSentJsonText = json;
            this._lastSentJsonTs = Date.now();

            this.postMessage({
                command: 'updateJson',
                json,
                meta: {
                    sessionId: this._sessionId,
                    rev,
                    reason,
                    hintPath,
                    dirtyPathCount: dirtyPaths.length,
                    dirtyCollectionCount: dirtyCollections.length,
                    dirtyPaths: dirtyPaths.slice(0, 30),
                    dirtyCollections: dirtyCollections.slice(0, 30),
                    ts: Date.now()
                }
            });
        }
    }

    private scheduleFormSync() {
        if (this._formSyncTimer !== null) {
            window.clearTimeout(this._formSyncTimer);
        }

        this._formSyncTimer = window.setTimeout(() => {
            this._formSyncTimer = null;
            this.handleFormChange('debounced');
        }, this._formSyncDebounceMs);
    }

    private buildUpdatedJson(): any {
        const updated: any = this.cloneJson(this._baseData || {});

        for (const path of this._dirtyPaths) {
            if (this.isUnderDirtyCollection(path)) continue;
            // 注意：属性容器节点也带有 data-path，必须选择真正的表单控件（带 data-type 的 input/select/textarea），否则会读不到 value 导致“改了但不写回/不新增字段”
            const control = document.querySelector(
                `input[data-path="${CSS.escape(path)}"][data-type], select[data-path="${CSS.escape(path)}"][data-type], textarea[data-path="${CSS.escape(path)}"][data-type]`
            ) as HTMLElement | null;
            if (!control) continue;

            if (this.isControlInInvalidEditState(control)) {
                continue;
            }

            const value = this.readControlValue(control);
            if (value === undefined) {
                this.deleteValueAtPointer(updated, path);
            } else {
                this.setValueAtPointer(updated, path, value);
            }
        }

        for (const collectionPath of this._dirtyCollectionPaths) {
            const collected = this.collectCollectionValue(collectionPath);
            if (collected === undefined) {
                // collection 处于无效编辑态（例如 map key 不合法/重复），此时不落盘该 collection 的变更
                continue;
            }

            if (Array.isArray(collected)) {
                if (collected.length === 0) this.deleteValueAtPointer(updated, collectionPath);
                else this.setValueAtPointer(updated, collectionPath, collected);
                continue;
            }

            if (!collected || (typeof collected === 'object' && Object.keys(collected).length === 0)) {
                this.deleteValueAtPointer(updated, collectionPath);
            } else {
                this.setValueAtPointer(updated, collectionPath, collected);
            }
        }

        return this.pruneEmptyObjects(updated, this._baseData);
    }

    private isControlInInvalidEditState(control: HTMLElement): boolean {
        const variant = control.closest('.anyof-variant') as HTMLElement | null;
        if (variant && variant.dataset.anyofActive === 'false') {
            return false;
        }
        if ((control as any)?.disabled) {
            return false;
        }
        const input = control as any;
        const raw = typeof input?.value === 'string' ? input.value : '';
        const hasText = String(raw ?? '').trim().length > 0;
        const validity = input?.validity;
        const isValid = validity ? !!validity.valid : true;
        return hasText && !isValid;
    }

    private applyControlValidations(control: HTMLElement) {
        this.applyExclusiveMinimumValidation(control);
        this.applyPatternValidation(control);
    }

    private applyExclusiveMinimumValidation(control: HTMLElement) {
        const el = control as any;
        if (!el || !el.dataset) return;
        const raw = el.dataset.exclusiveMinimum;
        if (raw === undefined) return;

        const min = parseFloat(String(raw));
        if (!Number.isFinite(min)) return;

        const type = String(el.dataset.type || '');
        if (type !== 'number' && type !== 'integer') return;

        const valRaw = typeof el.value === 'string' ? el.value.trim() : '';
        if (!valRaw) {
            try {
                el.setCustomValidity?.('');
            } catch {
                // ignore
            }
            return;
        }

        const num = type === 'integer' ? parseInt(valRaw, 10) : parseFloat(valRaw);
        if (!Number.isFinite(num) || num <= min) {
            try {
                el.setCustomValidity?.(`Must be > ${min}`);
            } catch {
                // ignore
            }
        } else {
            try {
                el.setCustomValidity?.('');
            } catch {
                // ignore
            }
        }
    }

    private applyPatternValidation(control: HTMLElement) {
        const el = control as any;
        if (!el || !el.dataset) return;

        const patternRaw = typeof el.dataset.pattern === 'string' ? String(el.dataset.pattern || '') : '';
        if (!patternRaw) return;

        const type = String(el.dataset.type || '');
        if (type !== 'string') return;

        if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) return;

        const raw = typeof control.value === 'string' ? control.value : '';
        const shouldPreserve = String((control as any)?.dataset?.mapRole || '') === 'value';
        const value = shouldPreserve ? String(raw ?? '') : String(raw ?? '').trim();

        if (!value) {
            try {
                control.setCustomValidity('');
            } catch {
                // ignore
            }
            return;
        }

        try {
            const re = new RegExp(patternRaw);
            if (!re.test(value)) {
                try {
                    control.setCustomValidity(`不符合 pattern：${patternRaw}`);
                } catch {
                    // ignore
                }
            } else {
                try {
                    control.setCustomValidity('');
                } catch {
                    // ignore
                }
            }
        } catch {
            // schema 里如果给了无法编译的 pattern，避免阻塞用户编辑
            try {
                control.setCustomValidity('');
            } catch {
                // ignore
            }
        }
    }

    private captureFocusState():
        | { kind: 'path'; path: string; selectionStart?: number; selectionEnd?: number }
        | { kind: 'mapKey'; mapPath: string; key: string; selectionStart?: number; selectionEnd?: number }
        | null {
        const active = document.activeElement as any;
        if (!active) return null;

        const isTextInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
        if (!isTextInput) return null;

        const selectionStart = typeof active.selectionStart === 'number' ? active.selectionStart : undefined;
        const selectionEnd = typeof active.selectionEnd === 'number' ? active.selectionEnd : undefined;

        if (active.classList && active.classList.contains('map-key-input')) {
            const mapRoot = active.closest('.map-object') as HTMLElement | null;
            const mapPath = mapRoot?.getAttribute('data-map-path') || '';
            if (!mapPath) return null;
            return {
                kind: 'mapKey',
                mapPath,
                key: String(active.value ?? ''),
                selectionStart,
                selectionEnd
            };
        }

        const path = active.getAttribute && active.getAttribute('data-path');
        const type = active.dataset ? active.dataset.type : '';
        if (typeof path === 'string' && path && type && type !== 'boolean') {
            return { kind: 'path', path, selectionStart, selectionEnd };
        }

        return null;
    }

    private restoreFocusState(state: ReturnType<SettingsEditorApp['captureFocusState']>) {
        if (!state) return;

        const focusEl = (el: HTMLElement | null) => {
            if (!el) return;
            try {
                (el as any).focus?.({ preventScroll: true });
            } catch {
                try {
                    (el as any).focus?.();
                } catch {
                    // ignore
                }
            }

            const start = (state as any).selectionStart;
            const end = (state as any).selectionEnd;
            if (typeof start === 'number' && typeof end === 'number') {
                try {
                    (el as any).setSelectionRange?.(start, end);
                } catch {
                    // ignore
                }
            }
        };

        if (state.kind === 'path') {
            const selector =
                `input[data-path="${CSS.escape(state.path)}"][data-type],` +
                ` textarea[data-path="${CSS.escape(state.path)}"][data-type],` +
                ` select[data-path="${CSS.escape(state.path)}"][data-type]`;
            focusEl(document.querySelector(selector) as HTMLElement | null);
            return;
        }

        if (state.kind === 'mapKey') {
            const root = document.querySelector(`.map-object[data-map-path="${CSS.escape(state.mapPath)}"]`) as HTMLElement | null;
            if (!root) return;
            const inputs = Array.from(root.querySelectorAll('.map-key-input')) as HTMLInputElement[];
            const exact = inputs.find(i => (i.value ?? '') === state.key) || null;
            focusEl(exact || inputs[inputs.length - 1] || null);
        }
    }

    updateData(json) {
        const focusState = this.captureFocusState();
        try {
            const parsed = JSON.parse(json);
            this.data = parsed;
            this._baseData = this.cloneJson(parsed);
            this._dirtyPaths.clear();
            this._dirtyCollectionPaths.clear();
            this.debugLog('updateData: reset baseData & dirty sets', {
                sessionId: this._sessionId,
                topKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 30) : []
            });
            this.renderArrayObjectItemsFromData(this._baseData);
            this.renderMapObjectItemsFromData(this._baseData);
            this.updateFormInputs();
            this.syncAnyOfObjectsFromData(this._baseData);
            this.buildSearchIndex();
            this.restoreFocusState(focusState);
        } catch (error) {
            console.error('Failed to parse JSON:', error);
        }
    }

    updateFormData(data) {
        this.data = data;
        this.updateFormInputs();
        this.syncAnyOfObjectsFromData(this.data);
    }

    updateFormInputs() {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor || !this.data) return;

        formEditor.querySelectorAll('input[data-path], select[data-path], textarea[data-path]').forEach(input => {
            if ((input as any).dataset && typeof (input as any).dataset.const === 'string') {
                // const 字段由 schema 固定，保持渲染时的值
                return;
            }
            if ((input as any).disabled) {
                return;
            }
            const path = (input as HTMLElement).dataset.path;
            if (!path) return;
            const value = this.getValueAtPointer(this.data, path);

            const type = (input as HTMLElement).dataset.type;
            if (type === 'mapKey') {
                // map 的 key 由 map-item 渲染时写入，不随 data-path 自动回填
                return;
            }
            if (type === 'boolean') {
                // 如果 JSON 未显式设置该字段，保持 schema 默认状态（由初始 HTML 决定）
                if (value !== undefined) {
                    (input as HTMLInputElement).checked = !!value;
                }
                return;
            }

            (input as HTMLInputElement).value = value !== undefined ? String(value) : '';
        });
    }

    private cloneJson(value: any): any {
        return JSON.parse(JSON.stringify(value ?? {}));
    }

    private markDirtyFromControl(control: HTMLElement) {
        if ((control as any).dataset && typeof (control as any).dataset.const === 'string') {
            return;
        }
        if ((control as any).disabled) {
            return;
        }
        const path = control.dataset.path;
        if (!path) return;

        const collectionRoot = this.getCollectionRootForControl(control);
        if (collectionRoot) {
            this._dirtyCollectionPaths.add(collectionRoot);
            return;
        }

        const current = this.readControlValue(control);
        const original = this.getValueAtPointer(this._baseData, path);

        if (this.valuesEqual(current, original)) {
            this._dirtyPaths.delete(path);
        } else {
            this._dirtyPaths.add(path);
        }
    }

    private parsePointer(pointer: string): Array<string | number> {
        const raw = pointer.startsWith('/') ? pointer.slice(1) : pointer;
        if (!raw) return [];
        return raw.split('/').map(seg => {
            const decoded = seg.replace(/~1/g, '/').replace(/~0/g, '~');
            if (/^\d+$/.test(decoded)) {
                return Number(decoded);
            }
            return decoded;
        });
    }

    private getValueAtPointer(root: any, pointer: string): any {
        const parts = this.parsePointer(pointer);
        let cur: any = root;
        for (const part of parts) {
            if (cur === null || cur === undefined) return undefined;
            cur = cur[part as any];
        }
        return cur;
    }

    private setValueAtPointer(root: any, pointer: string, value: any) {
        const parts = this.parsePointer(pointer);
        if (parts.length === 0) return;
        let cur: any = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            const next = parts[i + 1];
            const shouldBeArray = typeof next === 'number';

            if (cur[part as any] === undefined) {
                cur[part as any] = shouldBeArray ? [] : {};
            }
            cur = cur[part as any];
        }
        const last = parts[parts.length - 1];
        cur[last as any] = value;
    }

    private deleteValueAtPointer(root: any, pointer: string) {
        const parts = this.parsePointer(pointer);
        if (parts.length === 0) return;
        let cur: any = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (cur === null || cur === undefined) return;
            cur = cur[part as any];
        }
        const last = parts[parts.length - 1];
        if (!cur || typeof cur !== 'object') return;

        if (typeof last === 'number' && Array.isArray(cur)) {
            cur.splice(last, 1);
            return;
        }
        delete cur[last as any];
    }

    private pruneEmptyObjects(node: any, base: any): any {
        if (!node || typeof node !== 'object') return node;

        if (Array.isArray(node)) {
            return node.map((v, i) => this.pruneEmptyObjects(v, base?.[i]));
        }

        for (const key of Object.keys(node)) {
            node[key] = this.pruneEmptyObjects(node[key], base?.[key]);
            const child = node[key];
            const baseChild = base?.[key];
            const isEmptyObj = child && typeof child === 'object' && !Array.isArray(child) && Object.keys(child).length === 0;
            if (isEmptyObj && (baseChild === undefined || (baseChild && typeof baseChild === 'object' && Object.keys(baseChild).length === 0))) {
                delete node[key];
            }
        }
        return node;
    }

    private getCollectionRootForControl(control: HTMLElement): string | null {
        const arrayRoot = control.closest('.array-object') as HTMLElement | null;
        if (arrayRoot) {
            const path = arrayRoot.getAttribute('data-array-path') || '';
            return path || null;
        }

        const mapRoot = control.closest('.map-object') as HTMLElement | null;
        if (mapRoot) {
            const path = mapRoot.getAttribute('data-map-path') || '';
            return path || null;
        }

        return null;
    }

    private isUnderDirtyCollection(path: string): boolean {
        for (const root of this._dirtyCollectionPaths) {
            if (path === root) return true;
            if (path.startsWith(root + '/')) return true;
        }
        return false;
    }

    private renderArrayObjectItemsFromData(data: any) {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return;

        const arrays = Array.from(formEditor.querySelectorAll('.array-object')) as HTMLElement[];
        for (const arrayEl of arrays) {
            const arrayPath = arrayEl.getAttribute('data-array-path') || '';
            const arrayDom = arrayEl.getAttribute('data-array-dom') || '';
            if (!arrayPath) continue;

            const itemsContainer = arrayDom
                ? document.getElementById(`array-items-${arrayDom}`)
                : (arrayEl.querySelector('.array-items') as HTMLElement | null);
            const template = arrayDom
                ? (document.getElementById(`array-template-${arrayDom}`) as HTMLTemplateElement | null)
                : (arrayEl.querySelector('template.array-template, template') as HTMLTemplateElement | null);
            if (!itemsContainer || !template) continue;

            itemsContainer.innerHTML = '';
            const value = this.getValueAtPointer(data, arrayPath);
            const list = Array.isArray(value) ? value : [];
            for (let i = 0; i < list.length; i++) {
                const item = this.createArrayItemFromTemplate(template, arrayPath, i);
                this.applyArrayItemExamples(arrayEl, item, arrayPath, i);
                itemsContainer.appendChild(item);
            }
        }
    }

    private renderMapObjectItemsFromData(data: any) {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return;

        const maps = Array.from(formEditor.querySelectorAll('.map-object')) as HTMLElement[];
        for (const mapEl of maps) {
            const mapPath = mapEl.getAttribute('data-map-path') || '';
            const mapDom = mapEl.getAttribute('data-map-dom') || '';
            if (!mapPath || !mapDom) continue;

            const itemsContainer = document.getElementById(`map-items-${mapDom}`);
            const template = document.getElementById(`map-template-${mapDom}`) as HTMLTemplateElement | null;
            if (!itemsContainer || !template) continue;

            itemsContainer.innerHTML = '';
            const value = this.getValueAtPointer(data, mapPath);
            const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
            const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
            for (const k of keys) {
                const item = this.createMapItemFromTemplate(template, mapEl, mapPath, k);
                itemsContainer.appendChild(item);
            }
        }
    }

    private addArrayItem(arrayPath: string) {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return;

        const arrayEl = formEditor.querySelector(`.array-object[data-array-path="${CSS.escape(arrayPath)}"]`) as HTMLElement | null;
        if (!arrayEl) return;

        const arrayDom = arrayEl.getAttribute('data-array-dom') || '';
        const itemsContainer = arrayDom
            ? document.getElementById(`array-items-${arrayDom}`)
            : (arrayEl.querySelector('.array-items') as HTMLElement | null);
        const template = arrayDom
            ? (document.getElementById(`array-template-${arrayDom}`) as HTMLTemplateElement | null)
            : (arrayEl.querySelector('template.array-template, template') as HTMLTemplateElement | null);
        if (!itemsContainer || !template) return;

        const index = itemsContainer.querySelectorAll('.array-item').length;
        const item = this.createArrayItemFromTemplate(template, arrayPath, index);
        this.applyArrayItemExamples(arrayEl, item, arrayPath, index);
        itemsContainer.appendChild(item);
        this._dirtyCollectionPaths.add(arrayPath);

        const firstControl = item.querySelector('[data-path]') as HTMLElement | null;
        if (firstControl && 'focus' in firstControl) {
            (firstControl as any).focus();
        }
    }

    private addMapItem(mapPath: string) {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return;

        const mapEl = formEditor.querySelector(`.map-object[data-map-path="${CSS.escape(mapPath)}"]`) as HTMLElement | null;
        if (!mapEl) return;

        const mapDom = mapEl.getAttribute('data-map-dom') || '';
        const itemsContainer = document.getElementById(`map-items-${mapDom}`);
        const template = document.getElementById(`map-template-${mapDom}`) as HTMLTemplateElement | null;
        if (!itemsContainer || !template) return;

        const item = this.createMapItemFromTemplate(template, mapEl, mapPath, '');
        itemsContainer.appendChild(item);
        this._dirtyCollectionPaths.add(mapPath);

        const keyInput = item.querySelector('.map-key-input') as HTMLInputElement | null;
        if (keyInput) keyInput.focus();
    }

    private removeMapItem(mapPath: string, itemEl: HTMLElement) {
        itemEl.remove();
        this._dirtyCollectionPaths.add(mapPath);
        this.validateMapObject(mapPath);
    }

    private removeArrayItem(arrayPath: string, itemEl: HTMLElement) {
        itemEl.remove();
        this.reindexArrayItems(arrayPath);
        this._dirtyCollectionPaths.add(arrayPath);
    }

    private reindexArrayItems(arrayPath: string) {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return;

        const arrayEl = formEditor.querySelector(`.array-object[data-array-path="${CSS.escape(arrayPath)}"]`) as HTMLElement | null;
        if (!arrayEl) return;

        const arrayDom = arrayEl.getAttribute('data-array-dom') || '';
        const itemsContainer = arrayDom
            ? document.getElementById(`array-items-${arrayDom}`)
            : (arrayEl.querySelector('.array-items') as HTMLElement | null);
        if (!itemsContainer) return;

        const items = Array.from(itemsContainer.querySelectorAll('.array-item')) as HTMLElement[];
        const basePrefix = arrayPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        items.forEach((item, newIndex) => {
            item.setAttribute('data-array-index', String(newIndex));
            const titleEl = item.querySelector('.array-item-title') as HTMLElement | null;
            if (titleEl) {
                titleEl.textContent = `Item ${newIndex}`;
            }

            const controls = Array.from(item.querySelectorAll('[data-path]')) as HTMLElement[];
            for (const c of controls) {
                const p = c.getAttribute('data-path') || '';
                if (!p) continue;
                // 把 `${arrayPath}/<oldIndex>` 段替换成 `${arrayPath}/${newIndex}`
                const updated = p.replace(new RegExp(`^${basePrefix}\\/\\d+(?=\\/|$)`), `${arrayPath}/${newIndex}`);
                c.setAttribute('data-path', updated);
            }

            const anyOfRoots = Array.from(item.querySelectorAll('[data-anyof-path]')) as HTMLElement[];
            for (const el of anyOfRoots) {
                const p = el.getAttribute('data-anyof-path') || '';
                if (!p) continue;
                const updated = p.replace(new RegExp(`^${basePrefix}\\/\\d+(?=\\/|$)`), `${arrayPath}/${newIndex}`);
                el.setAttribute('data-anyof-path', updated);
            }

            this.applyArrayItemExamples(arrayEl, item, arrayPath, newIndex);
            this.applyPlaceholderExamples(item);
        });
    }

    private createArrayItemFromTemplate(template: HTMLTemplateElement, arrayPath: string, index: number): HTMLElement {
        const clone = template.content.cloneNode(true) as DocumentFragment;
        const wrapper = document.createElement('div');
        wrapper.appendChild(clone);
        const item = wrapper.querySelector('.array-item') as HTMLElement;

        // 替换 __INDEX__
        item.setAttribute('data-array-index', String(index));
        const titleEl = item.querySelector('.array-item-title') as HTMLElement | null;
        if (titleEl) {
            titleEl.textContent = `Item ${index}`;
        }

        const keySeg = (() => {
            const parts = String(arrayPath || '').split('/').filter(Boolean);
            return parts.length > 0 ? parts[parts.length - 1] : '';
        })();

        const controls = Array.from(item.querySelectorAll('[data-path]')) as HTMLElement[];
        for (const c of controls) {
            const p = c.getAttribute('data-path') || '';
            let updated = p.replace(/__INDEX__/g, String(index));
            if (keySeg) {
                updated = updated.replace(/\/__KEY__(?=\/|$)/g, `/${keySeg}`);
            }
            c.setAttribute('data-path', updated);
        }

        const anyOfRoots = Array.from(item.querySelectorAll('[data-anyof-path]')) as HTMLElement[];
        for (const el of anyOfRoots) {
            const p = el.getAttribute('data-anyof-path') || '';
            let updated = p.replace(/__INDEX__/g, String(index));
            if (keySeg) {
                updated = updated.replace(/\/__KEY__(?=\/|$)/g, `/${keySeg}`);
            }
            el.setAttribute('data-anyof-path', updated);
        }

        const removeBtn = item.querySelector('.array-remove-button') as HTMLElement | null;
        if (removeBtn) {
            removeBtn.setAttribute('data-array-path', arrayPath);
        }

        this.applyPlaceholderExamples(item);
        return item;
    }

    private safeParseJson(value: string | null): any {
        if (!value) return undefined;
        try {
            return JSON.parse(value);
        } catch {
            return undefined;
        }
    }

    private applyPlaceholderExamples(rootEl: HTMLElement) {
        const controls = Array.from(rootEl.querySelectorAll('[data-placeholder-examples]')) as Array<
            HTMLInputElement | HTMLTextAreaElement | HTMLElement
        >;

        for (const c of controls) {
            if (!(c instanceof HTMLInputElement || c instanceof HTMLTextAreaElement)) continue;

            const raw = c.getAttribute('data-placeholder-examples');
            const examples = this.safeParseJson(raw);
            if (!Array.isArray(examples) || examples.length === 0) continue;

            // 若用户已有输入值，则不要覆盖（placeholder 无意义且会干扰视觉）
            if (typeof c.value === 'string' && c.value.length > 0) continue;

            const cached = (() => {
                const v = String((c as any)?.dataset?.placeholderExampleIndex || '').trim();
                if (!v) return null;
                const n = parseInt(v, 10);
                return Number.isFinite(n) && n >= 0 && n < examples.length ? n : null;
            })();

            const idx = cached ?? Math.floor(Math.random() * examples.length);
            (c as any).dataset.placeholderExampleIndex = String(idx);

            const example = examples[idx];
            if (example === undefined || example === null) continue;

            if (typeof example === 'string' || typeof example === 'number') {
                c.placeholder = String(example);
            } else if (typeof example === 'boolean') {
                // boolean 没有 placeholder
            } else {
                c.placeholder = JSON.stringify(example);
            }
        }
    }

    private applyArrayItemExamples(arrayEl: HTMLElement, itemEl: HTMLElement, arrayPath: string, index: number) {
        const examplesRaw = arrayEl.getAttribute('data-array-examples');
        const examples = this.safeParseJson(examplesRaw);
        if (!Array.isArray(examples) || examples.length === 0) return;

        const cached = (() => {
            const v = String(itemEl.dataset.arrayExampleIndex || '').trim();
            if (!v) return null;
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n >= 0 && n < examples.length ? n : null;
        })();

        const exampleIndex = cached ?? Math.floor(Math.random() * examples.length);
        itemEl.dataset.arrayExampleIndex = String(exampleIndex);

        const example = examples[exampleIndex];
        if (example === undefined || example === null) return;

        // scalar item: 控件直接绑定到 `${arrayPath}/${index}`
        const direct = itemEl.querySelector(
            `[data-path="${CSS.escape(arrayPath + '/' + String(index))}"][data-type]`
        ) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;

        if (direct && (direct instanceof HTMLInputElement || direct instanceof HTMLTextAreaElement)) {
            if (typeof example === 'string' || typeof example === 'number') {
                direct.placeholder = String(example);
            } else if (typeof example === 'boolean') {
                // boolean 没有 placeholder
            } else {
                direct.placeholder = JSON.stringify(example);
            }
            return;
        }

        // object item: 逐字段设置 placeholder（仅对 input/textarea 生效）
        if (example && typeof example === 'object' && !Array.isArray(example)) {
            const controls = Array.from(itemEl.querySelectorAll('[data-path][data-type]')) as HTMLElement[];
            const prefix = `${arrayPath}/${index}/`;
            for (const c of controls) {
                const p = c.getAttribute('data-path') || '';
                if (!p.startsWith(prefix)) continue;
                const rest = p.slice(prefix.length);
                // 只处理对象的“直接子属性”，更深层级交给 schema 自身的 placeholder
                if (!rest || rest.includes('/')) continue;
                const keySeg = rest.replace(/~1/g, '/').replace(/~0/g, '~');
                const v = (example as any)[keySeg];
                if (v === undefined || v === null) continue;

                if (c instanceof HTMLInputElement || c instanceof HTMLTextAreaElement) {
                    if (typeof v === 'string' || typeof v === 'number') c.placeholder = String(v);
                    else c.placeholder = JSON.stringify(v);
                }
            }
        }
    }

    private encodeJsonPointerSegment(seg: string): string {
        return String(seg).replace(/~/g, '~0').replace(/\//g, '~1');
    }

    private createMapItemFromTemplate(
        template: HTMLTemplateElement,
        mapEl: HTMLElement,
        mapPath: string,
        key: string
    ): HTMLElement {
        const clone = template.content.cloneNode(true) as DocumentFragment;
        const wrapper = document.createElement('div');
        wrapper.appendChild(clone);
        const item = wrapper.querySelector('.map-item') as HTMLElement;

        const keyInput = item.querySelector('.map-key-input') as HTMLInputElement | null;

        const keyPattern = mapEl.getAttribute('data-map-key-pattern') || '';

        if (keyInput) {
            keyInput.value = key || '';
            if (keyPattern) {
                try {
                    keyInput.pattern = keyPattern;
                } catch {
                    // ignore invalid HTML pattern
                }
                keyInput.title = `Key must match: ${keyPattern}`;
            }
        }

        // Track what segment is currently baked into data-path attributes for this item.
        // Newly cloned templates still use "__KEY__".
        item.dataset.mapKeySeg = '__KEY__';

        const removeBtn = item.querySelector('.map-remove-button') as HTMLElement | null;
        if (removeBtn) {
            removeBtn.setAttribute('data-map-path', mapPath);
        }

        this.rebindMapItem(mapPath, item);
        return item;
    }

    private rebindMapItem(mapPath: string, itemEl: HTMLElement) {
        const keyInput = itemEl.querySelector('.map-key-input') as HTMLInputElement | null;
        if (!keyInput) return;

        const rawKey = (keyInput.value ?? '').trim();
        const prevSeg = String(itemEl.dataset.mapKeySeg || '__KEY__');

        // Update all bound paths under this map item (scalar value OR object value fields).
        if (rawKey) {
            const newSeg = this.encodeJsonPointerSegment(rawKey);
            const oldPrefix = `${mapPath}/${prevSeg}`;
            const placeholderPrefix = `${mapPath}/__KEY__`;

            const bound = Array.from(itemEl.querySelectorAll('[data-path]')) as HTMLElement[];
            for (const el of bound) {
                const t = (el as any)?.dataset?.type;
                if (t === 'mapKey') continue;

                const p = el.getAttribute('data-path') || '';
                if (!p) continue;

                let updated = p;
                if (updated.startsWith(oldPrefix)) {
                    updated = `${mapPath}/${newSeg}${updated.slice(oldPrefix.length)}`;
                } else if (updated.startsWith(placeholderPrefix)) {
                    updated = `${mapPath}/${newSeg}${updated.slice(placeholderPrefix.length)}`;
                }
                if (updated !== p) {
                    el.setAttribute('data-path', updated);
                }
            }

            const boundArrayPaths = Array.from(itemEl.querySelectorAll('[data-array-path]')) as HTMLElement[];
            for (const el of boundArrayPaths) {
                const p = el.getAttribute('data-array-path') || '';
                if (!p) continue;
                let updated = p;
                if (updated.startsWith(oldPrefix)) {
                    updated = `${mapPath}/${newSeg}${updated.slice(oldPrefix.length)}`;
                } else if (updated.startsWith(placeholderPrefix)) {
                    updated = `${mapPath}/${newSeg}${updated.slice(placeholderPrefix.length)}`;
                }
                if (updated !== p) {
                    el.setAttribute('data-array-path', updated);
                }
            }

            const anyOfRoots = Array.from(itemEl.querySelectorAll('[data-anyof-path]')) as HTMLElement[];
            for (const el of anyOfRoots) {
                const p = el.getAttribute('data-anyof-path') || '';
                if (!p) continue;
                let updated = p;
                if (updated.startsWith(oldPrefix)) {
                    updated = `${mapPath}/${newSeg}${updated.slice(oldPrefix.length)}`;
                } else if (updated.startsWith(placeholderPrefix)) {
                    updated = `${mapPath}/${newSeg}${updated.slice(placeholderPrefix.length)}`;
                }
                if (updated !== p) {
                    el.setAttribute('data-anyof-path', updated);
                }
            }

            itemEl.dataset.mapKeySeg = newSeg;
        }

        // Enable/disable value controls when key is empty; keep const fields read-only.
        // Also disable nested buttons/selectors to prevent creating items under "__KEY__".
        // NOTE: map 的标量值可能渲染在 header（紧凑布局），所以这里要覆盖整个 item。
        const interactives = Array.from(itemEl.querySelectorAll('input, select, textarea, button')) as Array<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
        >;

        for (const el of interactives) {
            if (el.classList.contains('map-key-input')) continue;
            if (el.classList.contains('map-remove-button')) continue;
            const isConst = typeof (el as any)?.dataset?.const === 'string';
            const variant = el.closest('.anyof-variant') as HTMLElement | null;
            const isInactiveVariant = !!(variant && variant.dataset.anyofActive === 'false');

            if (!rawKey) {
                el.disabled = true;
                continue;
            }

            if (isInactiveVariant) {
                el.disabled = true;
                continue;
            }

            if (isConst) {
                el.disabled = true;
                continue;
            }

            el.disabled = false;
        }
    }

    private validateMapObject(mapPath: string): boolean {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return true;

        const mapEl = formEditor.querySelector(`.map-object[data-map-path="${CSS.escape(mapPath)}"]`) as HTMLElement | null;
        if (!mapEl) return true;

        const patternRaw = mapEl.getAttribute('data-map-key-pattern') || '';
        const pattern = (() => {
            const p = String(patternRaw || '');
            if (!p) return null;
            try {
                if (p.startsWith('^') && p.endsWith('$')) return new RegExp(p);
                return new RegExp(`^(?:${p})$`);
            } catch {
                return null;
            }
        })();

        const keys = new Map<string, number>();
        const items = Array.from(mapEl.querySelectorAll('.map-item')) as HTMLElement[];
        let ok = true;

        for (const item of items) {
            const keyInput = item.querySelector('.map-key-input') as HTMLInputElement | null;
            if (!keyInput) continue;

            const k = (keyInput.value ?? '').trim();

            keyInput.setCustomValidity('');
            keyInput.classList.remove('map-key-invalid');

            if (!k) {
                // 新增行未填写 key：不算错误，但也不会被写入
                continue;
            }

            if (pattern && !pattern.test(k)) {
                ok = false;
                keyInput.setCustomValidity(`Key must match: ${patternRaw}`);
                keyInput.classList.add('map-key-invalid');
                continue;
            }

            const count = keys.get(k) || 0;
            keys.set(k, count + 1);
        }

        for (const item of items) {
            const keyInput = item.querySelector('.map-key-input') as HTMLInputElement | null;
            if (!keyInput) continue;
            const k = (keyInput.value ?? '').trim();
            if (!k) continue;
            if ((keys.get(k) || 0) > 1) {
                ok = false;
                keyInput.setCustomValidity('Duplicate key');
                keyInput.classList.add('map-key-invalid');
            }
        }

        return ok;
    }

    private syncAnyOfObjectsFromData(data: any) {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return;

        const roots = Array.from(formEditor.querySelectorAll('.anyof-object')) as HTMLElement[];
        for (const root of roots) {
            const path = root.getAttribute('data-anyof-path') || '';
            const selector = root.querySelector('.anyof-selector') as HTMLSelectElement | null;
            if (!path || !selector) continue;

            const value = this.getValueAtPointer(data, path);
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const variants = Array.from(root.querySelectorAll('.anyof-variant')) as HTMLElement[];
                for (const v of variants) {
                    const k = v.getAttribute('data-anyof-discriminator-key') || '';
                    const c = v.getAttribute('data-anyof-discriminator-const') || '';
                    const idx = v.getAttribute('data-anyof-index') || '';
                    if (!k || !c || !idx) continue;
                    if ((value as any)[k] === c) {
                        selector.value = idx;
                        break;
                    }
                }
            }

            this.applyAnyOfObjectSelection(root);
        }
    }

    private applyAnyOfObjectSelection(anyOfRoot: HTMLElement) {
        const selector = anyOfRoot.querySelector('.anyof-selector') as HTMLSelectElement | null;
        if (!selector) return;

        const activeIndex = String(selector.value || '0');
        const variants = Array.from(anyOfRoot.querySelectorAll('.anyof-variant')) as HTMLElement[];
        for (const v of variants) {
            const idx = v.getAttribute('data-anyof-index') || '';
            const active = idx === activeIndex;

            v.dataset.anyofActive = active ? 'true' : 'false';
            v.classList.toggle('hidden', !active);
            v.classList.toggle('active', active);

            const controls = Array.from(v.querySelectorAll('[data-type]')) as HTMLElement[];
            for (const c of controls) {
                const isConst = typeof (c as any)?.dataset?.const === 'string';
                const shouldDisableByMapKey = (() => {
                    const mapItem = c.closest('.map-item') as HTMLElement | null;
                    if (!mapItem) return false;
                    const keyInput = mapItem.querySelector('.map-key-input') as HTMLInputElement | null;
                    if (!keyInput) return false;
                    return (keyInput.value ?? '').trim().length === 0;
                })();

                if (!active) {
                    (c as any).disabled = true;
                    continue;
                }

                if (isConst) {
                    (c as any).disabled = true;
                    continue;
                }

                (c as any).disabled = shouldDisableByMapKey;
            }
        }
    }

    private handleAnyOfSelectorChange(selector: HTMLSelectElement) {
        const root = selector.closest('.anyof-object') as HTMLElement | null;
        if (!root) return;

        this.applyAnyOfObjectSelection(root);

        const collectionRoot = this.getCollectionRootForControl(selector as any);
        if (collectionRoot) {
            this._dirtyCollectionPaths.add(collectionRoot);
            this.handleFormChange('anyof-change', collectionRoot);
            return;
        }

        const controls = Array.from(root.querySelectorAll('[data-path][data-type]')) as HTMLElement[];
        for (const c of controls) {
            const p = c.getAttribute('data-path') || '';
            if (!p) continue;
            this._dirtyPaths.add(p);
        }
        this.handleFormChange('anyof-change', root.getAttribute('data-anyof-path') || '');
    }

    private collectCollectionValue(path: string): any[] | Record<string, any> | undefined {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return [];

        const arrayEl = formEditor.querySelector(`.array-object[data-array-path="${CSS.escape(path)}"]`) as HTMLElement | null;
        if (arrayEl) {
            return this.collectArrayObjectValue(path);
        }

        const mapEl = formEditor.querySelector(`.map-object[data-map-path="${CSS.escape(path)}"]`) as HTMLElement | null;
        if (mapEl) {
            return this.collectMapObjectValue(path);
        }

        return [];
    }

    private collectArrayObjectValue(arrayPath: string): any[] | undefined {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return [];

        const arrayEl = formEditor.querySelector(`.array-object[data-array-path="${CSS.escape(arrayPath)}"]`) as HTMLElement | null;
        if (!arrayEl) return [];

        const arrayDom = arrayEl.getAttribute('data-array-dom') || '';
        const itemsContainer = arrayDom
            ? document.getElementById(`array-items-${arrayDom}`)
            : (arrayEl.querySelector('.array-items') as HTMLElement | null);
        if (!itemsContainer) return [];

        const items = Array.from(itemsContainer.querySelectorAll('.array-item')) as HTMLElement[];
        const result: any[] = [];

        for (const itemEl of items) {
            const indexStr = itemEl.getAttribute('data-array-index') || '0';
            const index = parseInt(indexStr, 10);
            const prefix = `${arrayPath}/${index}`;

            // scalar array: 单控件直接绑定到 `${arrayPath}/${index}`
            const direct = itemEl.querySelector(
                `[data-path="${CSS.escape(prefix)}"][data-type]`
            ) as HTMLElement | null;
            if (direct) {
                if (this.isControlInInvalidEditState(direct)) {
                    return undefined;
                }
                const v = this.readControlValue(direct);
                if (v !== undefined) {
                    result.push(v);
                }
                continue;
            }

            // object array: 多控件以 `${arrayPath}/${index}/...` 方式绑定
            const obj: any = {};

            const controls = Array.from(itemEl.querySelectorAll('[data-path]')) as HTMLElement[];
            for (const c of controls) {
                const p = c.getAttribute('data-path') || '';
                if (!p.startsWith(prefix + '/')) continue;
                if (this.isControlInInvalidEditState(c)) {
                    return undefined;
                }
                const rel = p.slice(prefix.length);
                const value = this.readControlValue(c);
                if (value === undefined) continue;
                this.setValueAtPointer(obj, rel, value);
            }

            if (obj && typeof obj === 'object' && Object.keys(obj).length > 0) {
                result.push(obj);
            }
        }

        return result;
    }

    private collectMapObjectValue(mapPath: string): Record<string, any> | undefined {
        const formEditor = document.getElementById('formEditor');
        if (!formEditor) return {};

        const mapEl = formEditor.querySelector(`.map-object[data-map-path="${CSS.escape(mapPath)}"]`) as HTMLElement | null;
        if (!mapEl) return {};

        if (!this.validateMapObject(mapPath)) {
            // map key 不合法/重复：跳过写回，避免把临时无效输入写入源 JSON
            return undefined;
        }

        const mapDom = mapEl.getAttribute('data-map-dom') || '';
        const itemsContainer = document.getElementById(`map-items-${mapDom}`);
        if (!itemsContainer) return {};

        const items = Array.from(itemsContainer.querySelectorAll('.map-item')) as HTMLElement[];
        const result: Record<string, any> = {};

        for (const item of items) {
            const keyInput = item.querySelector('.map-key-input') as HTMLInputElement | null;
            if (!keyInput) continue;

            const key = (keyInput.value ?? '').trim();
            if (!key) continue;

            const keySeg = this.encodeJsonPointerSegment(key);
            const valuePrefix = `${mapPath}/${keySeg}`;

            // Scalar map value: single control bound to `${mapPath}/${keySeg}`
            const scalar = item.querySelector(
                `[data-map-role="value"][data-path="${CSS.escape(valuePrefix)}"][data-type]`
            ) as HTMLElement | null;

            if (scalar) {
                if (this.isControlInInvalidEditState(scalar)) {
                    return undefined;
                }
                const parsed = this.readControlValue(scalar);
                if (parsed === undefined) continue;
                result[key] = parsed;
                continue;
            }

            // Array map value: nested array-object bound to `${mapPath}/${keySeg}`
            const nestedArray = item.querySelector(
                `.array-object[data-array-path="${CSS.escape(valuePrefix)}"]`
            ) as HTMLElement | null;
            if (nestedArray) {
                const collected = this.collectArrayObjectValue(valuePrefix);
                if (collected === undefined) {
                    return undefined;
                }
                if (Array.isArray(collected) && collected.length > 0) {
                    result[key] = collected;
                }
                continue;
            }

            // Object map value: multiple controls bound under `${mapPath}/${keySeg}/...`
            const obj: any = {};
            const controls = Array.from(item.querySelectorAll('[data-path][data-type]')) as HTMLElement[];
            for (const c of controls) {
                const p = c.getAttribute('data-path') || '';
                if (!p.startsWith(valuePrefix + '/')) continue;
                if (this.isControlInInvalidEditState(c)) {
                    return undefined;
                }
                const value = this.readControlValue(c);
                if (value === undefined) continue;
                const rel = p.slice(valuePrefix.length);
                this.setValueAtPointer(obj, rel, value);
            }

            if (obj && typeof obj === 'object' && Object.keys(obj).length > 0) {
                result[key] = obj;
            }
        }

        return result;
    }

    private readControlValue(control: HTMLElement): any | undefined {
        const variant = control.closest('.anyof-variant') as HTMLElement | null;
        if (variant && variant.dataset.anyofActive === 'false') {
            return undefined;
        }

        const constRaw = (control as any)?.dataset?.const;
        if (typeof constRaw === 'string') {
            try {
                return JSON.parse(constRaw);
            } catch {
                return constRaw;
            }
        }

        if ((control as any)?.disabled) {
            return undefined;
        }

        const type = control.dataset.type;

        if (type === 'boolean') {
            return (control as HTMLInputElement).checked;
        }

        const raw = (control as HTMLInputElement).value;

        // Map string values should preserve empty string (e.g. env vars allow "").
        if ((type === 'string' || type === 'enum') && (control as any)?.dataset?.mapRole === 'value') {
            return String(raw ?? '');
        }

        const str = (raw ?? '').trim();

        if (type === 'number' || type === 'integer') {
            if (!str) return undefined;
            const num = type === 'integer' ? parseInt(str, 10) : parseFloat(str);
            return Number.isFinite(num) ? num : undefined;
        }

        if (type === 'array') {
            if (!str) return undefined;
            const parts = str.split(',').map(s => s.trim()).filter(Boolean);
            return parts.length > 0 ? parts : undefined;
        }

        // string / enum / 其他输入：空值表示“未设置”
        return str ? str : undefined;
    }

    private safeParseJsonText(text: string | null): any | undefined {
        if (typeof text !== 'string' || text.trim().length === 0) return undefined;
        try {
            return JSON.parse(text);
        } catch {
            return undefined;
        }
    }

    private deepEqualJson(a: any, b: any): boolean {
        if (a === b) return true;
        if (a === null || b === null) return a === b;
        if (typeof a !== typeof b) return false;

        if (Array.isArray(a) || Array.isArray(b)) {
            if (!Array.isArray(a) || !Array.isArray(b)) return false;
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.deepEqualJson(a[i], b[i])) return false;
            }
            return true;
        }

        if (typeof a === 'object' && typeof b === 'object') {
            const aKeys = Object.keys(a).sort();
            const bKeys = Object.keys(b).sort();
            if (aKeys.length !== bKeys.length) return false;
            for (let i = 0; i < aKeys.length; i++) {
                if (aKeys[i] !== bKeys[i]) return false;
                const k = aKeys[i];
                if (!this.deepEqualJson(a[k], b[k])) return false;
            }
            return true;
        }

        return false;
    }

    private valuesEqual(a: any, b: any): boolean {
        if (a === undefined && b === undefined) return true;
        if (a === undefined && b === null) return false;
        if (a === null && b === undefined) return false;
        if (Array.isArray(a) || Array.isArray(b)) {
            if (!Array.isArray(a) || !Array.isArray(b)) return false;
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) return false;
            }
            return true;
        }
        return a === b;
    }

    private normalizeText(value: string): string {
        return (value || '').toLowerCase().trim();
    }

    private getSearchQuery(): string {
        const raw = (this._searchField && typeof this._searchField.value === 'string') ? this._searchField.value : '';
        return String(raw || '');
    }

    private maybeShowSearchResults() {
        const query = this.getSearchQuery().trim();
        if (query.length === 0) return;
        this.showSearchResults();
    }

    private handleSearchInput() {
        const query = this.getSearchQuery().trim();
        if (!this._searchResultsEl) return;

        if (query.length === 0) {
            this._searchResults = [];
            this._searchSelectedIndex = -1;
            this.hideSearchResults();
            return;
        }

        this._searchResults = this.searchSettings(query);
        this._searchSelectedIndex = this._searchResults.length > 0 ? 0 : -1;
        this.renderSearchResults(query);
        this.showSearchResults();
    }

    private handleSearchKeydown(e: KeyboardEvent) {
        if (!this._searchResultsEl) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            if (!this._searchResultsEl.classList.contains('hidden')) {
                this.hideSearchResults();
            } else if (this._searchField) {
                this._searchField.value = '';
                this.handleSearchInput();
            }
            return;
        }

        if (this._searchResults.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._searchSelectedIndex = Math.min(this._searchSelectedIndex + 1, this._searchResults.length - 1);
            this.updateSearchActiveItem();
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._searchSelectedIndex = Math.max(this._searchSelectedIndex - 1, 0);
            this.updateSearchActiveItem();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const item = this._searchResults[this._searchSelectedIndex];
            if (item) {
                this.navigateToSetting(item);
            }
            return;
        }
    }

    private showSearchResults() {
        if (!this._searchResultsEl) return;
        if (this._searchResultsEl.innerHTML.trim().length === 0) return;
        this._searchResultsEl.classList.remove('hidden');
    }

    private hideSearchResults() {
        if (!this._searchResultsEl) return;
        this._searchResultsEl.classList.add('hidden');
    }

    private buildSearchIndex() {
        this._searchIndex = [];

        const topLevelTargets = new Map<string, TopLevelUiTarget>();

        const items = Array.from(document.querySelectorAll('.property-item')) as HTMLElement[];
        for (const el of items) {
            const key = el.getAttribute('data-property') || '';
            const propertyDomId = el.getAttribute('data-property-dom') || '';
            const categoryDomId = el.getAttribute('data-category') || '';

            const titleEl = el.querySelector('.property-title') as HTMLElement | null;
            const descEl = el.querySelector('.property-description') as HTMLElement | null;

            const title = (titleEl?.innerText || '').replace(/\*/g, '').trim();
            const description = (descEl?.innerText || '').trim();

            const topLevel = el.closest('.property-item.depth-0') as HTMLElement | null;
            const topLevelTitleEl = topLevel?.querySelector('.property-title') as HTMLElement | null;
            const categoryTitle = (topLevelTitleEl?.innerText || '').replace(/\*/g, '').trim();

            if (!key || !propertyDomId) continue;

            // 仅对顶层 key 建立映射，供 schema 扩展索引使用
            if (topLevel && topLevel === el) {
                topLevelTargets.set(key, { propertyDomId, categoryDomId, categoryTitle });
            }

            this._searchIndex.push({
                key,
                title: title || key,
                description,
                categoryDomId,
                categoryTitle,
                propertyDomId
            });
        }

        this.extendSearchIndexFromSchema(topLevelTargets);
    }

    private extendSearchIndexFromSchema(topLevelTargets: Map<string, TopLevelUiTarget>) {
        if (!this.schema || typeof this.schema !== 'object') return;
        const root: any = this.schema;
        const rootProps: Record<string, any> | undefined = root.properties;
        if (!rootProps) return;

        const maxDepth = 6;
        const maxExtraItems = 1500;
        let added = 0;

        const seenKeys = new Set<string>(this._searchIndex.map(i => `${i.propertyDomId}::${i.key}`));
        const visitedRefs = new Set<string>();
        const visitedObjects = new WeakSet<object>();

        const resolveInternalRef = (ref: string): any | undefined => {
            if (!ref.startsWith('#/')) return undefined;
            const parts = ref
                .slice(2)
                .split('/')
                .map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));

            let cur: any = root;
            for (const p of parts) {
                cur = cur?.[p];
            }
            return cur;
        };

        const getRefName = (ref: string): string => {
            const m = ref.match(/#\/(?:\$defs|definitions)\/([^/]+)$/);
            return m ? m[1] : ref;
        };

        const formatPath = (parts: string[]): string => {
            let out = '';
            for (const p of parts) {
                if (!out) {
                    out = p;
                    continue;
                }
                if (p === '[]') {
                    out += '[]';
                } else {
                    out += `.${p}`;
                }
            }
            return out;
        };

        const addItem = (target: TopLevelUiTarget, key: string, title: string, description: string) => {
            if (added >= maxExtraItems) return;
            const deDupeKey = `${target.propertyDomId}::${key}`;
            if (seenKeys.has(deDupeKey)) return;
            seenKeys.add(deDupeKey);
            added += 1;
            this._searchIndex.push({
                key,
                title,
                description,
                categoryDomId: target.categoryDomId,
                categoryTitle: target.categoryTitle,
                propertyDomId: target.propertyDomId
            });
        };

        const walk = (node: any, pathParts: string[], target: TopLevelUiTarget, depth: number) => {
            if (!node || typeof node !== 'object') return;
            if (depth > maxDepth) return;

            if (visitedObjects.has(node)) return;
            visitedObjects.add(node);

            // follow internal $ref
            if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
                const ref = node.$ref as string;
                const refName = getRefName(ref);
                const refKey = `${formatPath(pathParts)} • ${refName}`;
                const resolved = resolveInternalRef(ref);
                const desc = (resolved && typeof resolved === 'object' && typeof resolved.description === 'string') ? resolved.description : '';
                addItem(target, refKey, refName, desc);

                if (visitedRefs.has(ref)) return;
                visitedRefs.add(ref);

                if (resolved) {
                    walk(resolved, pathParts, target, depth + 1);
                }
                return;
            }

            const variants = []
                .concat(Array.isArray(node.anyOf) ? node.anyOf : [])
                .concat(Array.isArray(node.oneOf) ? node.oneOf : [])
                .concat(Array.isArray(node.allOf) ? node.allOf : []);

            for (const v of variants) {
                walk(v, pathParts, target, depth + 1);
            }

            // object properties
            const props: Record<string, any> | undefined = node.properties;
            if (props && typeof props === 'object') {
                for (const [propName, propSchema] of Object.entries(props)) {
                    const nextPath = pathParts.concat(propName);
                    const title = (propSchema && typeof propSchema.title === 'string') ? propSchema.title : propName;
                    const desc = (propSchema && typeof propSchema.description === 'string') ? propSchema.description : '';
                    addItem(target, formatPath(nextPath), title, desc);
                    walk(propSchema, nextPath, target, depth + 1);
                }
            }

            // array items
            const items = node.items;
            if (items) {
                walk(items, pathParts.concat('[]'), target, depth + 1);
            }
        };

        for (const [topKey, topSchema] of Object.entries(rootProps)) {
            const target = topLevelTargets.get(topKey);
            if (!target) continue;
            walk(topSchema, [topKey], target, 0);
            if (added >= maxExtraItems) break;
        }
    }

    private searchSettings(query: string): SettingsSearchItem[] {
        const q = this.normalizeText(query);
        if (!q) return [];

        const scored = this._searchIndex.map(item => {
            const key = this.normalizeText(item.key);
            const title = this.normalizeText(item.title);
            const desc = this.normalizeText(item.description);

            let score = 0;

            if (key === q) score = 1000;
            else if (key.startsWith(q)) score = 800;
            else if (key.includes(q)) score = 600;

            if (score === 0) {
                if (title === q) score = 550;
                else if (title.startsWith(q)) score = 450;
                else if (title.includes(q)) score = 350;
            }

            if (score === 0 && desc.includes(q)) score = 200;

            return { item, score };
        }).filter(x => x.score > 0);

        scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));

        return scored.slice(0, 50).map(x => x.item);
    }

    private renderSearchResults(query: string) {
        if (!this._searchResultsEl) return;

        if (this._searchResults.length === 0) {
            this._searchResultsEl.innerHTML = `<div class="settings-search-empty">No results for "${this.escapeHtml(query)}"</div>`;
            return;
        }

        this._searchResultsEl.innerHTML = this._searchResults.map((r, index) => {
            const activeClass = index === this._searchSelectedIndex ? 'active' : '';
            const meta = `${this.escapeHtml(r.categoryTitle || 'General')} • ${this.escapeHtml(r.key)}`;
            return `
                <div class="settings-search-result ${activeClass}" role="option" data-index="${index}">
                    <div class="settings-search-result-title">${this.escapeHtml(r.title)}</div>
                    <div class="settings-search-result-meta">${meta}</div>
                </div>
            `;
        }).join('');

        this._searchResultsEl.querySelectorAll('.settings-search-result').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
            el.addEventListener('click', () => {
                const idx = Number((el as HTMLElement).dataset.index);
                const item = this._searchResults[idx];
                if (item) this.navigateToSetting(item);
            });
        });
    }

    private updateSearchActiveItem() {
        if (!this._searchResultsEl) return;
        const nodes = Array.from(this._searchResultsEl.querySelectorAll('.settings-search-result')) as HTMLElement[];
        nodes.forEach((n, i) => {
            if (i === this._searchSelectedIndex) n.classList.add('active');
            else n.classList.remove('active');
        });

        const active = nodes[this._searchSelectedIndex];
        if (active) {
            active.scrollIntoView({ block: 'nearest' });
        }
    }

    private navigateToSetting(item: SettingsSearchItem) {
        const settingEl = document.getElementById(`setting-${item.propertyDomId}`) as HTMLElement | null;
        if (!settingEl) return;

        document.querySelectorAll('.property-item.search-target').forEach(el => el.classList.remove('search-target'));

        settingEl.classList.add('search-target');
        settingEl.scrollIntoView({ block: 'center', behavior: 'smooth' });

        const control = settingEl.querySelector('[data-key]') as HTMLElement | null;
        if (control && 'focus' in control) {
            (control as any).focus();
        }

        window.setTimeout(() => settingEl.classList.remove('search-target'), 1400);
        this.hideSearchResults();
    }

    private escapeHtml(value: string): string {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private log(level: 'debug' | 'info' | 'warn' | 'error', text: string, data?: any) {
        const payload = {
            command: 'log',
            level,
            text,
            data,
            meta: { sessionId: this._sessionId, ts: Date.now() }
        };

        // Webview 侧控制台（需要打开 VS Code Developer Tools 才能看到）
        if (level === 'error') console.error(`[SettingsEditorApp][${this._sessionId}] ${text}`, data);
        else if (level === 'warn') console.warn(`[SettingsEditorApp][${this._sessionId}] ${text}`, data);
        else console.log(`[SettingsEditorApp][${this._sessionId}] ${text}`, data);

        // 同步把日志上报到扩展侧，方便在 Output/Extension Host 中查看
        this.postMessage(payload);
    }

    private debugLog(text: string, data?: any) {
        this.log('debug', text, data);
    }

    private infoLog(text: string, data?: any) {
        this.log('info', text, data);
    }

    private handleUpdateJsonAck(meta: any) {
        const ok = !!meta?.ok;
        const rev = typeof meta?.rev === 'number' ? meta.rev : undefined;

        this.debugLog('recv updateJsonAck', { sessionId: this._sessionId, meta });

        if (!ok) {
            this.log('warn', 'updateJsonAck not ok', { sessionId: this._sessionId, meta });
            return;
        }

        if (typeof rev !== 'number') {
            return;
        }

        if (rev < this._lastAckRev) {
            this.debugLog('ignore updateJsonAck (rev older than lastAckRev)', {
                sessionId: this._sessionId,
                rev,
                lastAckRev: this._lastAckRev
            });
            return;
        }

        this._lastAckRev = rev;

        // 仅当 ack 对应“最新一次发送”时，才提升 baseData，避免乱序 ack 覆盖新状态
        if (rev !== this._lastSentRev) {
            this.debugLog('updateJsonAck rev not latest, skip baseData update', {
                sessionId: this._sessionId,
                rev,
                lastSentRev: this._lastSentRev
            });
            return;
        }

        this._baseData = this.cloneJson(this.data);
        this._dirtyPaths.clear();
        this._dirtyCollectionPaths.clear();

        this.debugLog('baseData updated & dirty sets cleared (after ack)', {
            sessionId: this._sessionId,
            rev,
            uri: meta?.uri,
            version: meta?.version
        });
    }

    showError(error) {
        this.log('error', 'showError', { sessionId: this._sessionId, error });
    }

    postMessage(message) {
        if (window.vscode) {
            window.vscode.postMessage(message);
        }
    }
}

new SettingsEditorApp();
