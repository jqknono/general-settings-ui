import { i18n } from '../utils/i18n.js';

export class FormGenerator {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.onChangeCallback = null;
        this.data = {};
    }

    /**
     * 生成表单
     */
    generateForm(schema) {
        if (!this.container || !schema) {
            return;
        }

        this.container.innerHTML = '';
        
        if (schema.type === 'object' && schema.properties) {
            this.generateObjectForm(schema.properties, schema.required);
        } else {
            this.container.innerHTML = `
                <div class="empty-state">
                    <span class="codicon codicon-warning"></span>
                    <p>${i18n.t('ui.unsupportedSchemaType')}: ${schema.type}</p>
                </div>
            `;
        }
    }

    /**
     * 生成对象表单
     */
    generateObjectForm(properties, required = []) {
        const fragment = document.createDocumentFragment();

        for (const [key, prop] of Object.entries(properties)) {
            const isRequired = required.includes(key);
            const formGroup = this.createFormGroup(key, prop, isRequired);
            fragment.appendChild(formGroup);
        }

        this.container.appendChild(fragment);
    }

    /**
     * 创建表单组
     */
    createFormGroup(key, prop, isRequired = false) {
        const group = document.createElement('div');
        group.className = 'form-group';
        group.dataset.property = key;

        const label = this.createLabel(key, prop, isRequired);
        group.appendChild(label);

        if (prop.description) {
            const description = this.createDescription(prop.description);
            group.appendChild(description);
        }

        const control = this.createControl(key, prop);
        group.appendChild(control);

        return group;
    }

    /**
     * 创建标签
     */
    createLabel(key, prop, isRequired) {
        const label = document.createElement('label');
        label.className = 'form-label';
        label.textContent = prop.title || key;
        
        if (isRequired) {
            label.textContent += ' *';
        }
        
        label.htmlFor = `field-${key}`;
        return label;
    }

    /**
     * 创建描述
     */
    createDescription(description) {
        const desc = document.createElement('div');
        desc.className = 'form-description';
        desc.textContent = description;
        return desc;
    }

    /**
     * 创建控件
     */
    createControl(key, prop) {
        const control = document.createElement('div');
        control.className = 'form-control-wrapper';

        let input;
        
        switch (prop.type) {
            case 'string':
                input = this.createStringInput(key, prop);
                break;
            case 'number':
            case 'integer':
                input = this.createNumberInput(key, prop);
                break;
            case 'boolean':
                input = this.createBooleanInput(key, prop);
                break;
            case 'array':
                input = this.createArrayInput(key, prop);
                break;
            case 'object':
                input = this.createObjectInput(key, prop);
                break;
            case 'enum':
                input = this.createEnumInput(key, prop);
                break;
            default:
                input = this.createStringInput(key, prop);
        }

        control.appendChild(input);
        return control;
    }

    /**
     * 创建字符串输入
     */
    createStringInput(key, prop) {
        const input = document.createElement('textarea');
        input.className = 'form-control';
        input.id = `field-${key}`;
        input.placeholder = prop.default || '';
        input.value = this.data[key] || prop.default || '';

        if (prop.enum) {
            return this.createEnumInput(key, prop);
        }

        if (prop.minLength !== undefined) {
            input.minLength = prop.minLength;
        }
        
        if (prop.maxLength !== undefined) {
            input.maxLength = prop.maxLength;
        }

        if (prop.pattern) {
            input.pattern = prop.pattern;
        }

        input.addEventListener('input', () => {
            this.updateData(key, input.value);
        });

        return input;
    }

    /**
     * 创建数字输入
     */
    createNumberInput(key, prop) {
        const input = document.createElement('input');
        input.className = 'form-control';
        input.id = `field-${key}`;
        input.type = 'number';
        input.value = this.data[key] ?? prop.default ?? 0;

        if (prop.type === 'integer') {
            input.step = '1';
        } else {
            input.step = 'any';
        }

        if (prop.minimum !== undefined) {
            input.min = prop.minimum;
        }
        
        if (prop.maximum !== undefined) {
            input.max = prop.maximum;
        }

        input.addEventListener('input', () => {
            const value = parseFloat(input.value);
            this.updateData(key, isNaN(value) ? null : value);
        });

        return input;
    }

    /**
     * 创建布尔输入
     */
    createBooleanInput(key, prop) {
        const wrapper = document.createElement('div');
        wrapper.className = 'checkbox-wrapper';

        const input = document.createElement('input');
        input.className = 'form-control';
        input.id = `field-${key}`;
        input.type = 'checkbox';
        input.checked = this.data[key] ?? prop.default ?? false;

        const label = document.createElement('label');
        label.htmlFor = `field-${key}`;
        label.textContent = prop.title || key;

        input.addEventListener('change', () => {
            this.updateData(key, input.checked);
        });

        wrapper.appendChild(input);
        wrapper.appendChild(label);

        return wrapper;
    }

    /**
     * 创建数组输入
     */
    createArrayInput(key, prop) {
        const wrapper = document.createElement('div');
        wrapper.className = 'form-array';
        wrapper.dataset.property = key;

        const header = document.createElement('div');
        header.className = 'array-header';
        header.innerHTML = `
            <span>${prop.title || key}</span>
            <vscode-button appearance="icon" class="add-item-btn" data-key="${key}">
                <span class="codicon codicon-add"></span>
            </vscode-button>
        `;

        const container = document.createElement('div');
        container.className = 'array-items';
        container.dataset.property = key;

        const items = this.data[key] || [];

        items.forEach((item, index) => {
            const itemElement = this.createArrayItem(key, prop, item, index);
            container.appendChild(itemElement);
        });

        header.addEventListener('click', (e) => {
            if (e.target.closest('.add-item-btn')) {
                this.addArrayItem(key, prop);
            }
        });

        wrapper.appendChild(header);
        wrapper.appendChild(container);

        return wrapper;
    }

    /**
     * 创建数组项
     */
    createArrayItem(key, prop, item, index) {
        const itemElement = document.createElement('div');
        itemElement.className = 'form-array-item';
        itemElement.dataset.index = index;

        let control;
        
        if (prop.items && prop.items.type) {
            switch (prop.items.type) {
                case 'string':
                    control = this.createStringInput(`${key}[${index}]`, prop.items);
                    break;
                case 'number':
                case 'integer':
                    control = this.createNumberInput(`${key}[${index}]`, prop.items);
                    break;
                case 'boolean':
                    control = this.createBooleanInput(`${key}[${index}]`, prop.items);
                    break;
                default:
                    control = this.createStringInput(`${key}[${index}]`, prop.items);
            }
            
            // 设置值
            if (control.tagName === 'TEXTAREA' || control.tagName === 'INPUT') {
                if (control.type === 'checkbox') {
                    control.checked = item;
                } else {
                    control.value = item;
                }
            }
        } else {
            control = document.createElement('input');
            control.className = 'form-control';
            control.type = 'text';
            control.value = item;
        }

        const removeBtn = document.createElement('vscode-button');
        removeBtn.appearance = 'icon';
        removeBtn.className = 'remove-item-btn';
        removeBtn.innerHTML = '<span class="codicon codicon-trash"></span>';
        
        removeBtn.addEventListener('click', () => {
            this.removeArrayItem(key, index);
        });

        itemElement.appendChild(control);
        itemElement.appendChild(removeBtn);

        return itemElement;
    }

    /**
     * 创建对象输入
     */
    createObjectInput(key, prop) {
        const wrapper = document.createElement('div');
        wrapper.className = 'form-object';
        wrapper.dataset.property = key;

        const header = document.createElement('div');
        header.className = 'object-header';
        header.innerHTML = `
            <span>${prop.title || key}</span>
            <vscode-button appearance="icon" class="toggle-object-btn" data-key="${key}">
                <span class="codicon codicon-chevron-down"></span>
            </vscode-button>
        `;

        const container = document.createElement('div');
        container.className = 'object-properties';
        container.dataset.property = key;

        if (prop.properties) {
            const objectData = this.data[key] || {};
            
            for (const [subKey, subProp] of Object.entries(prop.properties)) {
                const formGroup = this.createFormGroup(`${key}.${subKey}`, subProp, 
                    (prop.required || []).includes(subKey));
                formGroup.dataset.property = `${key}.${subKey}`;
                container.appendChild(formGroup);
            }
        }

        header.addEventListener('click', (e) => {
            if (e.target.closest('.toggle-object-btn')) {
                container.classList.toggle('collapsed');
            }
        });

        wrapper.appendChild(header);
        wrapper.appendChild(container);

        return wrapper;
    }

    /**
     * 创建枚举输入
     */
    createEnumInput(key, prop) {
        const select = document.createElement('select');
        select.className = 'form-control';
        select.id = `field-${key}`;

        prop.enum.forEach((value, index) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            
            if (this.data[key] === value) {
                option.selected = true;
            }
            
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            this.updateData(key, select.value);
        });

        return select;
    }

    /**
     * 更新数据
     */
    updateData(key, value) {
        const keys = key.split('.');
        let current = this.data;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i].replace(/\[\d+\]/, '');
            if (!current[k]) {
                current[k] = {};
            }
            current = current[k];
        }
        
        const lastKey = keys[keys.length - 1].replace(/\[\d+\]/, '');
        current[lastKey] = value;

        if (this.onChangeCallback) {
            this.onChangeCallback(this.data);
        }
    }

    /**
     * 添加数组项
     */
    addArrayItem(key, prop) {
        if (!this.data[key]) {
            this.data[key] = [];
        }
        
        let newItem;
        if (prop.items && prop.items.type === 'object') {
            newItem = {};
        } else if (prop.items && prop.items.type === 'number') {
            newItem = 0;
        } else if (prop.items && prop.items.type === 'boolean') {
            newItem = false;
        } else {
            newItem = '';
        }
        
        this.data[key].push(newItem);
        this.regenerateForm();
    }

    /**
     * 移除数组项
     */
    removeArrayItem(key, index) {
        if (this.data[key] && Array.isArray(this.data[key])) {
            this.data[key].splice(index, 1);
            this.regenerateForm();
        }
    }

    /**
     * 重新生成表单（用于数组操作后）
     */
    regenerateForm() {
        // 这里需要重新生成整个表单，暂时简化处理
        if (this.onChangeCallback) {
            this.onChangeCallback(this.data);
        }
    }

    /**
     * 更新表单数据
     */
    updateData(data) {
        this.data = { ...data };
        
        // 更新表单控件的值
        if (this.container) {
            const controls = this.container.querySelectorAll('.form-control, textarea, input[type="checkbox"]');
            controls.forEach(control => {
                const property = control.closest('[data-property]')?.dataset.property;
                if (property) {
                    const value = this.getPropertyValue(property);
                    if (control.type === 'checkbox') {
                        control.checked = !!value;
                    } else {
                        control.value = value !== undefined ? value : '';
                    }
                }
            });
        }
    }

    /**
     * 获取属性值
     */
    getPropertyValue(property) {
        const keys = property.split('.');
        let current = this.data;
        
        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return undefined;
            }
        }
        
        return current;
    }

    /**
     * 设置变化回调
     */
    onChange(callback) {
        this.onChangeCallback = callback;
    }
}