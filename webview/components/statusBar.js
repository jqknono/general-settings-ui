/**
 * 状态栏组件
 */
export class StatusBar {
    constructor(validationId, schemaInfoId) {
        this.validationElement = document.getElementById(validationId);
        this.schemaInfoElement = document.getElementById(schemaInfoId);
        this.currentSchema = '';
        this.lastValidationStatus = '';
        this.lastValidationMessage = '';
        
        this.init();
    }

    /**
     * 初始化状态栏
     */
    init() {
        // 设置初始状态
        this.updateSchemaInfo('');
        this.setValidationStatus('', '');
    }

    /**
     * 设置Schema信息
     */
    setSchemaInfo(schemaName) {
        this.currentSchema = schemaName;
        
        if (this.schemaInfoElement) {
            if (schemaName) {
                this.schemaInfoElement.textContent = `Schema: ${schemaName}`;
                this.schemaInfoElement.title = schemaName;
            } else {
                this.schemaInfoElement.textContent = '';
                this.schemaInfoElement.title = '';
            }
        }
    }

    /**
     * 设置验证状态
     */
    setValidationStatus(status, message = '') {
        this.lastValidationStatus = status;
        this.lastValidationMessage = message;
        
        if (!this.validationElement) {
            return;
        }

        // 清除所有状态类
        this.validationElement.className = 'validation-status';
        
        switch (status) {
            case 'success':
                this.validationElement.classList.add('success');
                this.validationElement.innerHTML = `
                    <span class="codicon codicon-check"></span>
                    <span>JSON格式正确</span>
                `;
                break;
                
            case 'error':
                this.validationElement.classList.add('error');
                this.validationElement.innerHTML = `
                    <span class="codicon codicon-error"></span>
                    <span>${message || 'JSON格式错误'}</span>
                `;
                break;
                
            case 'warning':
                this.validationElement.classList.add('warning');
                this.validationElement.innerHTML = `
                    <span class="codicon codicon-warning"></span>
                    <span>${message}</span>
                `;
                break;
                
            case 'loading':
                this.validationElement.innerHTML = `
                    <span class="codicon codicon-loading"></span>
                    <span>验证中...</span>
                `;
                break;
                
            default:
                this.validationElement.innerHTML = '';
                break;
        }
    }

    /**
     * 设置JSON统计信息
     */
    setJsonStats(stats) {
        if (!this.validationElement) {
            return;
        }

        const { lines, characters, depth, isValid } = stats;
        
        let statusHtml = `
            <span class="codicon codicon-file-code"></span>
            <span>${lines} 行 | ${characters} 字符</span>
        `;
        
        if (depth > 0) {
            statusHtml += `
                <span class="codicon codicon-symbol-structure"></span>
                <span>深度: ${depth}</span>
            `;
        }
        
        if (isValid) {
            statusHtml += `
                <span class="codicon codicon-pass"></span>
                <span>有效JSON</span>
            `;
        }

        this.validationElement.innerHTML = statusHtml;
    }

    /**
     * 显示Schema验证结果
     */
    showSchemaValidation(validationResult) {
        if (!this.validationElement) {
            return;
        }

        const { valid, errors = [] } = validationResult;
        
        if (valid) {
            this.setValidationStatus('success', '通过Schema验证');
        } else {
            const errorMessage = errors.length > 0 ? errors[0] : 'Schema验证失败';
            this.setValidationStatus('error', errorMessage);
        }
    }

    /**
     * 显示保存状态
     */
    showSaveStatus(saved, fileName = '') {
        if (!this.validationElement) {
            return;
        }

        if (saved) {
            this.validationElement.innerHTML = `
                <span class="codicon codicon-check"></span>
                <span>已保存: ${fileName}</span>
            `;
            
            // 3秒后恢复原状态
            setTimeout(() => {
                this.updateValidationStatus();
            }, 3000);
        } else {
            this.setValidationStatus('error', '保存失败');
        }
    }

    /**
     * 显示加载状态
     */
    showLoading(message = '加载中...') {
        this.setValidationStatus('loading', message);
    }

    /**
     * 显示错误信息
     */
    showError(error, autoHide = false) {
        this.setValidationStatus('error', error);
        
        if (autoHide) {
            setTimeout(() => {
                this.updateValidationStatus();
            }, 5000);
        }
    }

    /**
     * 显示成功信息
     */
    showSuccess(message, autoHide = false) {
        this.setValidationStatus('success', message);
        
        if (autoHide) {
            setTimeout(() => {
                this.updateValidationStatus();
            }, 3000);
        }
    }

    /**
     * 显示警告信息
     */
    showWarning(message, autoHide = false) {
        this.setValidationStatus('warning', message);
        
        if (autoHide) {
            setTimeout(() => {
                this.updateValidationStatus();
            }, 4000);
        }
    }

    /**
     * 更新验证状态（基于当前状态重新显示）
     */
    updateValidationStatus() {
        this.setValidationStatus(this.lastValidationStatus, this.lastValidationMessage);
    }

    /**
     * 显示光标位置信息
     */
    showCursorInfo(line, column) {
        if (!this.validationElement) {
            return;
        }

        const info = `行 ${line}, 列 ${column}`;
        
        // 如果有当前状态信息，追加光标信息
        if (this.lastValidationStatus && this.lastValidationStatus !== '') {
            this.validationElement.innerHTML += ` | ${info}`;
        } else {
            this.validationElement.innerHTML = info;
        }
    }

    /**
     * 显示选择信息
     */
    showSelectionInfo(selectedChars, selectedLines) {
        if (!this.validationElement) {
            return;
        }

        if (selectedChars > 0) {
            const info = `已选择 ${selectedChars} 字符`;
            if (selectedLines > 1) {
                info += ` (${selectedLines} 行)`;
            }
            
            this.validationElement.innerHTML = info;
        }
    }

    /**
     * 显示文件大小信息
     */
    showFileSize(size) {
        if (!this.schemaInfoElement) {
            return;
        }

        let sizeText;
        if (size < 1024) {
            sizeText = `${size} B`;
        } else if (size < 1024 * 1024) {
            sizeText = `${(size / 1024).toFixed(1)} KB`;
        } else {
            sizeText = `${(size / (1024 * 1024)).toFixed(1)} MB`;
        }

        const currentText = this.schemaInfoElement.textContent;
        const separator = currentText && currentText.trim() !== '' ? ' | ' : '';
        
        this.schemaInfoElement.textContent = `${currentText}${separator}${sizeText}`;
    }

    /**
     * 显示编码信息
     */
    showEncoding(encoding = 'UTF-8') {
        if (!this.schemaInfoElement) {
            return;
        }

        const currentText = this.schemaInfoElement.textContent;
        const separator = currentText && currentText.trim() !== '' ? ' | ' : '';
        
        this.schemaInfoElement.textContent = `${currentText}${separator}${encoding}`;
    }

    /**
     * 显示修改状态
     */
    showModified(modified) {
        if (!this.schemaInfoElement) {
            return;
        }

        const currentText = this.schemaInfoElement.textContent;
        const separator = currentText && currentText.trim() !== '' ? ' | ' : '';
        
        if (modified) {
            this.schemaInfoElement.textContent = `${currentText}${separator}已修改`;
            this.schemaInfoElement.classList.add('modified');
        } else {
            this.schemaInfoElement.textContent = currentText.replace(' | 已修改', '');
            this.schemaInfoElement.classList.remove('modified');
        }
    }

    /**
     * 清空状态栏
     */
    clear() {
        if (this.validationElement) {
            this.validationElement.innerHTML = '';
            this.validationElement.className = 'validation-status';
        }
        
        if (this.schemaInfoElement) {
            this.schemaInfoElement.textContent = '';
            this.schemaInfoElement.className = 'schema-info';
        }
        
        this.currentSchema = '';
        this.lastValidationStatus = '';
        this.lastValidationMessage = '';
    }

    /**
     * 设置主题
     */
    setTheme(theme) {
        // 可以根据主题调整样式
        if (this.validationElement) {
            this.validationElement.setAttribute('data-theme', theme);
        }
        
        if (this.schemaInfoElement) {
            this.schemaInfoElement.setAttribute('data-theme', theme);
        }
    }

    /**
     * 获取当前状态
     */
    getStatus() {
        return {
            schema: this.currentSchema,
            validation: {
                status: this.lastValidationStatus,
                message: this.lastValidationMessage
            }
        };
    }

    /**
     * 添加自定义状态指示器
     */
    addStatusIndicator(id, content, className = '') {
        if (!this.validationElement) {
            return null;
        }

        const indicator = document.createElement('span');
        indicator.id = id;
        indicator.className = `status-indicator ${className}`;
        indicator.innerHTML = content;
        
        this.validationElement.appendChild(indicator);
        
        return indicator;
    }

    /**
     * 移除状态指示器
     */
    removeStatusIndicator(id) {
        const indicator = this.validationElement?.querySelector(`#${id}`);
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * 更新状态指示器
     */
    updateStatusIndicator(id, content, className = '') {
        const indicator = this.validationElement?.querySelector(`#${id}`);
        if (indicator) {
            indicator.innerHTML = content;
            indicator.className = `status-indicator ${className}`;
        }
    }

    /**
     * 销毁状态栏
     */
    destroy() {
        if (this.validationElement) {
            this.validationElement.innerHTML = '';
            this.validationElement.className = 'validation-status';
        }
        
        if (this.schemaInfoElement) {
            this.schemaInfoElement.textContent = '';
            this.schemaInfoElement.className = 'schema-info';
        }
        
        this.currentSchema = '';
        this.lastValidationStatus = '';
        this.lastValidationMessage = '';
    }
}