/**
 * JSON编辑器组件
 */
export class JsonEditor {
    constructor(editorId) {
        this.editor = document.getElementById(editorId);
        this.onChangeCallback = null;
        this.currentValue = '';
        
        this.init();
    }

    /**
     * 初始化编辑器
     */
    init() {
        if (!this.editor) {
            return;
        }

        // 设置基本样式和属性
        this.editor.spellcheck = false;
        this.editor.setAttribute('autocomplete', 'off');
        this.editor.setAttribute('autocorrect', 'off');
        this.editor.setAttribute('autocapitalize', 'off');
        
        // 监听输入事件
        this.editor.addEventListener('input', () => {
            this.handleChange();
        });

        // 监听键盘事件
        this.editor.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });

        // 监听粘贴事件
        this.editor.addEventListener('paste', (e) => {
            this.handlePaste(e);
        });
    }

    /**
     * 设置编辑器值
     */
    setValue(value) {
        if (value !== this.currentValue) {
            this.editor.value = value;
            this.currentValue = value;
        }
    }

    /**
     * 获取编辑器值
     */
    getValue() {
        return this.editor.value;
    }

    /**
     * 设置变化回调
     */
    onChange(callback) {
        this.onChangeCallback = callback;
    }

    /**
     * 处理输入变化
     */
    handleChange() {
        const newValue = this.editor.value;
        
        if (newValue !== this.currentValue) {
            this.currentValue = newValue;
            
            // 检查JSON格式
            const isValid = this.isValidJson(newValue);
            this.editor.classList.toggle('invalid', !isValid);
            
            if (this.onChangeCallback) {
                this.onChangeCallback(newValue);
            }
        }
    }

    /**
     * 处理键盘事件
     */
    handleKeyDown(e) {
        // Tab键处理
        if (e.key === 'Tab') {
            e.preventDefault();
            this.insertTab();
            return;
        }

        // 快捷键处理
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's':
                    e.preventDefault();
                    // 触发保存
                    document.getElementById('saveBtn')?.click();
                    break;
                case 'f':
                    e.preventDefault();
                    // 触发格式化
                    document.getElementById('formatJsonBtn')?.click();
                    break;
            }
        }

        // 自动缩进
        if (e.key === 'Enter') {
            setTimeout(() => {
                this.autoIndent();
            }, 0);
        }
    }

    /**
     * 处理粘贴事件
     */
    handlePaste(e) {
        e.preventDefault();
        const text = e.clipboardData.getData('text');
        
        // 尝试格式化粘贴的JSON
        try {
            const parsed = JSON.parse(text);
            const formatted = JSON.stringify(parsed, null, 2);
            this.insertText(formatted);
        } catch {
            // 如果不是有效的JSON，直接插入
            this.insertText(text);
        }
    }

    /**
     * 插入制表符
     */
    insertTab() {
        const start = this.editor.selectionStart;
        const end = this.editor.selectionEnd;
        const value = this.editor.value;
        
        this.editor.value = value.substring(0, start) + '  ' + value.substring(end);
        this.editor.selectionStart = this.editor.selectionEnd = start + 2;
        
        this.handleChange();
    }

    /**
     * 插入文本
     */
    insertText(text) {
        const start = this.editor.selectionStart;
        const end = this.editor.selectionEnd;
        const value = this.editor.value;
        
        this.editor.value = value.substring(0, start) + text + value.substring(end);
        this.editor.selectionStart = this.editor.selectionEnd = start + text.length;
        
        this.handleChange();
    }

    /**
     * 自动缩进
     */
    autoIndent() {
        const start = this.editor.selectionStart;
        const lines = this.editor.value.substring(0, start).split('\n');
        const currentLine = lines[lines.length - 1];
        
        // 查找上一行的缩进
        let indent = '';
        if (lines.length > 1) {
            const prevLine = lines[lines.length - 2];
            const match = prevLine.match(/^(\s*)/);
            if (match) {
                indent = match[1];
            }
            
            // 如果上一行以 { 或 [ 开头，增加缩进
            if (prevLine.trim().endsWith('{') || prevLine.trim().endsWith('[')) {
                indent += '  ';
            }
        }
        
        // 如果当前行以 } 或 ] 开头，减少缩进
        if (currentLine.trim().startsWith('}') || currentLine.trim().startsWith(']')) {
            indent = indent.substring(0, Math.max(0, indent.length - 2));
        }
        
        // 插入缩进
        this.insertText('\n' + indent);
    }

    /**
     * 检查JSON是否有效
     */
    isValidJson(text) {
        try {
            JSON.parse(text);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 获取当前光标位置的JSON路径
     */
    getCurrentJsonPath() {
        const start = this.editor.selectionStart;
        const text = this.editor.value.substring(0, start);
        const lines = text.split('\n');
        const currentLine = lines[lines.length - 1];
        
        // 简单的路径解析，可以根据需要改进
        const match = currentLine.match(/^\s*"([^"]+)"/);
        return match ? match[1] : '';
    }

    /**
     * 格式化当前选中的JSON
     */
    formatSelection() {
        const start = this.editor.selectionStart;
        const end = this.editor.selectionEnd;
        
        if (start === end) {
            // 没有选中内容，格式化全部
            this.formatAll();
            return;
        }
        
        const selectedText = this.editor.value.substring(start, end);
        
        try {
            const parsed = JSON.parse(selectedText);
            const formatted = JSON.stringify(parsed, null, 2);
            
            this.editor.value = this.editor.value.substring(0, start) + formatted + this.editor.value.substring(end);
            this.handleChange();
        } catch {
            // 无法格式化选中的文本
        }
    }

    /**
     * 格式化全部内容
     */
    formatAll() {
        try {
            const parsed = JSON.parse(this.editor.value);
            const formatted = JSON.stringify(parsed, null, 2);
            this.setValue(formatted);
        } catch {
            // JSON格式错误，不进行格式化
        }
    }

    /**
     * 查找和替换
     */
    findAndReplace(searchText, replaceText, caseSensitive = false) {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        
        const newValue = this.editor.value.replace(regex, replaceText);
        
        if (newValue !== this.editor.value) {
            this.setValue(newValue);
            return true;
        }
        
        return false;
    }

    /**
     * 获取统计信息
     */
    getStats() {
        const text = this.editor.value;
        const lines = text.split('\n').length;
        const characters = text.length;
        const charactersWithoutSpaces = text.replace(/\s/g, '').length;
        
        let isValid = false;
        let depth = 0;
        
        try {
            const parsed = JSON.parse(text);
            isValid = true;
            depth = this.getJsonDepth(parsed);
        } catch {
            // JSON无效
        }
        
        return {
            lines,
            characters,
            charactersWithoutSpaces,
            isValid,
            depth
        };
    }

    /**
     * 获取JSON深度
     */
    getJsonDepth(obj, currentDepth = 0) {
        if (typeof obj !== 'object' || obj === null) {
            return currentDepth;
        }
        
        let maxDepth = currentDepth;
        
        for (const key in obj) {
            const depth = this.getJsonDepth(obj[key], currentDepth + 1);
            maxDepth = Math.max(maxDepth, depth);
        }
        
        return maxDepth;
    }

    /**
     * 设置焦点
     */
    focus() {
        this.editor.focus();
    }

    /**
     * 选择全部文本
     */
    selectAll() {
        this.editor.select();
    }

    /**
     * 设置只读状态
     */
    setReadOnly(readOnly) {
        this.editor.readOnly = readOnly;
    }

    /**
     * 设置占位符
     */
    setPlaceholder(placeholder) {
        this.editor.placeholder = placeholder;
    }

    /**
     * 添加CSS类
     */
    addClass(className) {
        this.editor.classList.add(className);
    }

    /**
     * 移除CSS类
     */
    removeClass(className) {
        this.editor.classList.remove(className);
    }

    /**
     * 切换CSS类
     */
    toggleClass(className, force) {
        this.editor.classList.toggle(className, force);
    }

    /**
     * 销毁编辑器
     */
    destroy() {
        if (this.editor) {
            // 移除事件监听器
            this.editor.removeEventListener('input', this.handleChange);
            this.editor.removeEventListener('keydown', this.handleKeyDown);
            this.editor.removeEventListener('paste', this.handlePaste);
            
            // 清理引用
            this.editor = null;
            this.onChangeCallback = null;
        }
    }
}