/**
 * Schema选择对话框组件
 */
export class SchemaDialog {
    constructor(dialogId) {
        this.dialog = document.getElementById(dialogId);
        this.schemas = [];
        this.onSelectCallback = null;
        this.onSearchCallback = null;
        this.filteredSchemas = [];
        
        this.init();
    }

    /**
     * 初始化对话框
     */
    init() {
        if (!this.dialog) {
            return;
        }

        // 关闭按钮
        const closeBtn = this.dialog.querySelector('#closeDialogBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hide();
            });
        }

        // 搜索框
        const searchInput = this.dialog.querySelector('#schemaSearch');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.handleSearch(e.target.value);
                }, 300);
            });
        }

        // 点击背景关闭
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) {
                this.hide();
            }
        });

        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.dialog.classList.contains('hidden')) {
                this.hide();
            }
        });
    }

    /**
     * 显示对话框
     */
    show(schemas) {
        this.schemas = schemas || [];
        this.filteredSchemas = [...this.schemas];
        
        this.renderSchemaList();
        this.dialog.classList.remove('hidden');
        
        // 聚焦搜索框
        const searchInput = this.dialog.querySelector('#schemaSearch');
        if (searchInput) {
            searchInput.focus();
            searchInput.value = '';
        }
    }

    /**
     * 隐藏对话框
     */
    hide() {
        this.dialog.classList.add('hidden');
    }

    /**
     * 渲染Schema列表
     */
    renderSchemaList() {
        const listContainer = this.dialog.querySelector('#schemaList');
        if (!listContainer) {
            return;
        }

        if (this.filteredSchemas.length === 0) {
            listContainer.innerHTML = `
                <div class="no-results">
                    <span class="codicon codicon-search"></span>
                    <p>未找到匹配的Schema</p>
                </div>
            `;
            return;
        }

        const fragment = document.createDocumentFragment();
        
        this.filteredSchemas.forEach(schema => {
            const item = this.createSchemaItem(schema);
            fragment.appendChild(item);
        });

        listContainer.innerHTML = '';
        listContainer.appendChild(fragment);
    }

    /**
     * 创建Schema项
     */
    createSchemaItem(schema) {
        const item = document.createElement('div');
        item.className = 'schema-item';
        item.dataset.url = schema.url;

        const name = document.createElement('div');
        name.className = 'schema-name';
        name.textContent = schema.name;

        const description = document.createElement('div');
        description.className = 'schema-description';
        description.textContent = schema.description || '无描述';

        // 添加文件匹配信息
        if (schema.fileMatch && schema.fileMatch.length > 0) {
            const fileMatch = document.createElement('div');
            fileMatch.className = 'schema-filematch';
            fileMatch.textContent = `匹配: ${schema.fileMatch.join(', ')}`;
            description.appendChild(fileMatch);
        }

        item.appendChild(name);
        item.appendChild(description);

        // 点击事件
        item.addEventListener('click', () => {
            this.selectSchema(schema);
        });

        // 悬停效果
        item.addEventListener('mouseenter', () => {
            item.classList.add('hover');
        });

        item.addEventListener('mouseleave', () => {
            item.classList.remove('hover');
        });

        return item;
    }

    /**
     * 选择Schema
     */
    selectSchema(schema) {
        this.hide();
        
        if (this.onSelectCallback) {
            this.onSelectCallback(schema.url);
        }
    }

    /**
     * 处理搜索
     */
    handleSearch(query) {
        const trimmedQuery = query.trim().toLowerCase();
        
        if (!trimmedQuery) {
            this.filteredSchemas = [...this.schemas];
        } else {
            this.filteredSchemas = this.schemas.filter(schema => {
                const name = schema.name.toLowerCase();
                const description = (schema.description || '').toLowerCase();
                const fileMatches = (schema.fileMatch || []).join(' ').toLowerCase();
                
                return name.includes(trimmedQuery) ||
                       description.includes(trimmedQuery) ||
                       fileMatches.includes(trimmedQuery);
            });
        }

        // 按相关性排序
        this.filteredSchemas.sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            const query = trimmedQuery;
            
            // 完全匹配优先
            if (aName === query && bName !== query) return -1;
            if (bName === query && aName !== query) return 1;
            
            // 开头匹配优先
            const aStarts = aName.startsWith(query);
            const bStarts = bName.startsWith(query);
            if (aStarts && !bStarts) return -1;
            if (bStarts && !aStarts) return 1;
            
            // 字母顺序
            return aName.localeCompare(bName);
        });

        this.renderSchemaList();
        
        if (this.onSearchCallback) {
            this.onSearchCallback(query);
        }
    }

    /**
     * 更新Schema列表
     */
    updateSchemaList(schemas) {
        this.schemas = schemas || [];
        this.filteredSchemas = [...this.schemas];
        this.renderSchemaList();
    }

    /**
     * 设置选择回调
     */
    onSelect(callback) {
        this.onSelectCallback = callback;
    }

    /**
     * 设置搜索回调
     */
    onSearch(callback) {
        this.onSearchCallback = callback;
    }

    /**
     * 获取当前选中的Schema
     */
    getSelectedSchema() {
        const selectedItem = this.dialog.querySelector('.schema-item.selected');
        return selectedItem ? selectedItem.dataset.url : null;
    }

    /**
     * 设置键盘导航
     */
    setupKeyboardNavigation() {
        const items = this.dialog.querySelectorAll('.schema-item');
        let currentIndex = -1;

        this.dialog.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    currentIndex = Math.min(currentIndex + 1, items.length - 1);
                    this.highlightItem(currentIndex);
                    break;
                    
                case 'ArrowUp':
                    e.preventDefault();
                    currentIndex = Math.max(currentIndex - 1, 0);
                    this.highlightItem(currentIndex);
                    break;
                    
                case 'Enter':
                    e.preventDefault();
                    if (currentIndex >= 0 && items[currentIndex]) {
                        items[currentIndex].click();
                    }
                    break;
            }
        });
    }

    /**
     * 高亮项目
     */
    highlightItem(index) {
        const items = this.dialog.querySelectorAll('.schema-item');
        
        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    /**
     * 设置加载状态
     */
    setLoading(loading) {
        const listContainer = this.dialog.querySelector('#schemaList');
        if (!listContainer) {
            return;
        }

        if (loading) {
            listContainer.innerHTML = `
                <div class="loading">
                    <span class="codicon codicon-loading"></span>
                    <p>加载中...</p>
                </div>
            `;
        } else {
            this.renderSchemaList();
        }
    }

    /**
     * 显示错误信息
     */
    showError(error) {
        const listContainer = this.dialog.querySelector('#schemaList');
        if (!listContainer) {
            return;
        }

        listContainer.innerHTML = `
            <div class="error">
                <span class="codicon codicon-warning"></span>
                <p>加载失败: ${error}</p>
            </div>
        `;
    }

    /**
     * 获取Schema详情
     */
    async getSchemaDetails(schemaUrl) {
        try {
            // 这里可以调用API获取详细信息
            // 暂时返回基本信息
            const schema = this.schemas.find(s => s.url === schemaUrl);
            return schema || null;
        } catch (error) {
            console.error('获取Schema详情失败:', error);
            return null;
        }
    }

    /**
     * 添加到收藏
     */
    addToFavorites(schemaUrl) {
        const favorites = this.getFavorites();
        if (!favorites.includes(schemaUrl)) {
            favorites.push(schemaUrl);
            this.saveFavorites(favorites);
        }
    }

    /**
     * 从收藏中移除
     */
    removeFromFavorites(schemaUrl) {
        const favorites = this.getFavorites();
        const index = favorites.indexOf(schemaUrl);
        if (index > -1) {
            favorites.splice(index, 1);
            this.saveFavorites(favorites);
        }
    }

    /**
     * 获取收藏列表
     */
    getFavorites() {
        try {
            const stored = localStorage.getItem('schema-favorites');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }

    /**
     * 保存收藏列表
     */
    saveFavorites(favorites) {
        try {
            localStorage.setItem('schema-favorites', JSON.stringify(favorites));
        } catch (error) {
            console.error('保存收藏失败:', error);
        }
    }

    /**
     * 检查是否为收藏
     */
    isFavorite(schemaUrl) {
        return this.getFavorites().includes(schemaUrl);
    }

    /**
     * 销毁对话框
     */
    destroy() {
        if (this.dialog) {
            // 移除事件监听器
            this.dialog.removeEventListener('click', this.hide);
            document.removeEventListener('keydown', this.hide);
            
            // 清理引用
            this.dialog = null;
            this.schemas = [];
            this.filteredSchemas = [];
            this.onSelectCallback = null;
            this.onSearchCallback = null;
        }
    }
}