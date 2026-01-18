import { SchemaManager, SchemaInfo } from '../schema/schemaManager';
import * as vscode from 'vscode';

export interface ConfigCategory {
    id: string;
    title: string;
    description?: string;
    properties: ConfigProperty[];
}

export interface ConfigProperty {
    key: string;
    title: string;
    description?: string;
    type: string;
    default?: any;
    examples?: any[];
    const?: any;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number | boolean;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    required: boolean;
    category: string;
    schema?: any;
    pathParts?: string[];
}

export class SettingsFormGenerator {
    private readonly _schemaManager: SchemaManager;
    private _categories: ConfigCategory[] = [];
    private _topLevelProperties: ConfigProperty[] = [];
    private _rootSchema: any | null = null;
    private _usedDomIds = new Set<string>();
    private _categoryDomIdById = new Map<string, string>();
    private _propertyDomIdByKey = new Map<string, string>();

    constructor(schemaManager: SchemaManager) {
        this._schemaManager = schemaManager;
    }

    public async generateSettingsForm(schemaUrl: string, baseFilePath?: string): Promise<string> {
        const schema = await this._schemaManager.getSchema(schemaUrl, baseFilePath);
        this._rootSchema = schema;
        this._parseSchema(schema);
        return this._generateHtml();
    }

    private _parseSchema(schema: any) {
        this._categories = [];
        this._topLevelProperties = [];
        this._usedDomIds.clear();
        this._categoryDomIdById.clear();
        this._propertyDomIdByKey.clear();

        if (!schema || schema.type !== 'object') {
            return;
        }

        const properties: Record<string, any> = schema.properties || {};
        const required: string[] = schema.required || [];

        for (const [key, prop] of Object.entries(properties)) {
            const category = this._getOrCreateCategory(prop);

            const topLevelProp: ConfigProperty = {
                key,
                title: prop.title || key,
                description: prop.description,
                type: prop.type,
                default: prop.default,
                examples: prop.examples,
                const: prop.const,
                enum: prop.enum,
                minimum: prop.minimum,
                maximum: prop.maximum,
                exclusiveMinimum: prop.exclusiveMinimum,
                pattern: prop.pattern,
                required: required.includes(key),
                category: category.id,
                schema: prop,
                pathParts: [key]
            };

            category.properties.push(topLevelProp);
            this._topLevelProperties.push(topLevelProp);
        }
    }

    private _getOrCreateCategory(prop: Record<string, any>): ConfigCategory {
        let category = prop.category;
        
        if (!category) {
            category = 'General';
        }

        let existingCategory = this._categories.find(c => c.id === category);
        
        if (!existingCategory) {
            existingCategory = {
                id: category,
                title: this._formatCategoryTitle(category),
                description: prop.categoryDescription,
                properties: []
            };
            this._categories.push(existingCategory);
        }

        return existingCategory;
    }

    private _formatCategoryTitle(categoryId: string): string {
        if (categoryId === 'General') {
            return 'General';
        }
        
        return categoryId
            .split(/(?=[A-Z])/)
            .join(' ')
            .replace(/^\w/, c => c.toUpperCase());
    }

    private _generateHtml(): string {
        if (this._topLevelProperties.length === 0) {
            return this._generateEmptyState();
        }

        let html = '<div class="settings-container">';
        
        html += '<div class="settings-sidebar">';
        html += '<div class="sidebar-title">Settings</div>';
        html += '<div class="sidebar-content">';
        
        this._topLevelProperties.forEach((prop, index) => {
            const propDomId = this._getPropertyDomId(prop.key);
            const isActive = index === 0 ? 'active' : '';
            html += `
                <div class="sidebar-item ${isActive}" data-scroll-to="setting-${propDomId}">
                    <span class="sidebar-item-title">${this._escapeHtml(prop.title || prop.key)}</span>
                </div>
            `;
        });
        
        html += '</div></div>';

        html += '<div class="settings-content">';

        html += `
            <div class="settings-page" data-page="root">
                ${this._generatePropertiesHtml('root', this._topLevelProperties)}
            </div>
        `;

        html += '</div></div>';

        return html;
    }

    private _generatePropertiesHtml(categoryDomId: string, properties: ConfigProperty[]): string {
        let html = '<div class="properties-list">';
        
        properties.forEach(prop => {
            html += this._generateSchemaNode(categoryDomId, prop, 0, false);
        });
        
        html += '</div>';
        return html;
    }

    private _generateBooleanControl(pathPointer: string, propDomId: string, defaultValue: any): string {
        return `
            <div class="control-toggle">
                <input 
                    type="checkbox" 
                    id="property-${propDomId}" 
                    data-path="${this._escapeAttr(pathPointer)}"
                    data-type="boolean"
                    ${defaultValue ? 'checked' : ''}
                />
                <label for="property-${propDomId}">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
    }

    private _generateStringControl(pathPointer: string, propDomId: string, placeholderValue: any, pattern?: string, minLength?: number, maxLength?: number): string {
        return `
            <input 
                type="text" 
                id="property-${propDomId}" 
                class="control-input" 
                data-path="${this._escapeAttr(pathPointer)}"
                data-type="string"
                placeholder="${this._escapeAttr(placeholderValue ?? '')}"
                ${pattern ? `data-pattern="${this._escapeAttr(pattern)}"` : ''}
                ${minLength ? `minlength="${minLength}"` : ''}
                ${maxLength ? `maxlength="${maxLength}"` : ''}
            />
        `;
    }

    private _generateNumberControl(pathPointer: string, propDomId: string, placeholderValue: any, type: 'number' | 'integer', minimum?: number, maximum?: number, exclusiveMinimum?: number): string {
        return `
            <input 
                type="number" 
                id="property-${propDomId}" 
                class="control-input" 
                data-path="${this._escapeAttr(pathPointer)}"
                data-type="${type}"
                ${exclusiveMinimum !== undefined ? `data-exclusive-minimum="${this._escapeAttr(String(exclusiveMinimum))}"` : ''}
                placeholder="${this._escapeAttr(placeholderValue ?? '')}"
                ${minimum !== undefined ? `min="${minimum}"` : ''}
                ${maximum !== undefined ? `max="${maximum}"` : ''}
                ${type === 'integer' ? 'step="1"' : 'step="any"'}
            />
        `;
    }

    private _randomExample(schemaNode: any): any {
        const examples = schemaNode?.examples;
        if (!Array.isArray(examples) || examples.length === 0) {
            return undefined;
        }
        return examples[Math.floor(Math.random() * examples.length)];
    }

    private _placeholderValue(schemaNode: any, defaultValue: any): any {
        if (defaultValue !== undefined && defaultValue !== null) {
            return defaultValue;
        }
        return this._randomExample(schemaNode);
    }

    private _placeholderForProp(schemaNode: any, prop: ConfigProperty): any {
        if (prop.default !== undefined && prop.default !== null) {
            return prop.default;
        }
        if (Array.isArray(prop.examples) && prop.examples.length > 0) {
            return prop.examples[Math.floor(Math.random() * prop.examples.length)];
        }
        return this._randomExample(schemaNode);
    }

    private _generateEnumControl(pathPointer: string, propDomId: string, values: string[], defaultValue: any): string {
        return `
            <select 
                id="property-${propDomId}" 
                class="control-select" 
                data-path="${this._escapeAttr(pathPointer)}"
                data-type="enum"
            >
                ${values.map(value => `
                    <option value="${this._escapeAttr(value)}" ${value === defaultValue ? 'selected' : ''}>${this._escapeHtml(value)}</option>
                `).join('')}
            </select>
        `;
    }

    private _generateArrayScalarTemplateControl(pathPointer: string, itemsSchema: any): string {
        const resolved = this._pickSchemaVariant(itemsSchema || {});
        const t = this._schemaType(resolved);
        const placeholder = this._placeholderValue(resolved, resolved?.default);

        const constValue = (resolved && typeof resolved === 'object' && 'const' in resolved) ? (resolved as any).const : undefined;

        // 注意：这里用于 <template>，不要生成 id，避免重复 id 导致行为异常
        if (t === 'boolean') {
            if (constValue !== undefined) {
                return `
                    <div class="control-toggle">
                        <input
                            type="checkbox"
                            data-path="${this._escapeAttr(pathPointer)}"
                            data-type="boolean"
                            data-const="${this._escapeAttr(JSON.stringify(constValue))}"
                            ${constValue ? 'checked' : ''}
                            disabled
                        />
                        <label>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                `;
            }
            return `
                <div class="control-toggle">
                    <input
                        type="checkbox"
                        data-path="${this._escapeAttr(pathPointer)}"
                        data-type="boolean"
                    />
                    <label>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            `;
        }

        if (t === 'string' && Array.isArray(resolved?.enum) && resolved.enum.length > 0) {
            return `
                <select
                    class="control-select"
                    data-path="${this._escapeAttr(pathPointer)}"
                    data-type="enum"
                >
                    ${resolved.enum.map((v: string) => `<option value="${this._escapeAttr(v)}">${this._escapeHtml(v)}</option>`).join('')}
                </select>
            `;
        }

        if (t === 'number' || t === 'integer') {
            const minimum = resolved?.minimum;
            const maximum = resolved?.maximum;
	            const exclusiveMinimum = (() => {
	                const raw = (resolved as any)?.exclusiveMinimum;
	                if (typeof raw === 'number') {
	                    return raw;
	                }
	                if (raw === true && typeof (resolved as any)?.minimum === 'number') {
	                    return (resolved as any).minimum;
	                }
	                return undefined;
	            })();
            if (constValue !== undefined) {
                return `
                    <input
                        type="number"
                        class="control-input"
                        data-path="${this._escapeAttr(pathPointer)}"
                        data-type="${this._escapeAttr(t)}"
                        data-const="${this._escapeAttr(JSON.stringify(constValue))}"
                        ${exclusiveMinimum !== undefined ? `data-exclusive-minimum="${this._escapeAttr(String(exclusiveMinimum))}"` : ''}
                        value="${this._escapeAttr(String(constValue))}"
                        disabled
                    />
                `;
            }
            return `
                <input
                    type="number"
                    class="control-input"
                    data-path="${this._escapeAttr(pathPointer)}"
                    data-type="${this._escapeAttr(t)}"
                    ${exclusiveMinimum !== undefined ? `data-exclusive-minimum="${this._escapeAttr(String(exclusiveMinimum))}"` : ''}
                    placeholder="${this._escapeAttr(placeholder ?? '')}"
                    ${minimum !== undefined ? `min="${minimum}"` : ''}
                    ${maximum !== undefined ? `max="${maximum}"` : ''}
                    ${t === 'integer' ? 'step="1"' : 'step="any"'}
                />
            `;
        }

        const pattern = typeof resolved?.pattern === 'string' ? resolved.pattern : undefined;
        const minLength = typeof resolved?.minLength === 'number' ? resolved.minLength : undefined;
        const maxLength = typeof resolved?.maxLength === 'number' ? resolved.maxLength : undefined;
        const exampleList =
            resolved?.default !== undefined && resolved?.default !== null
                ? null
                : Array.isArray(resolved?.examples) && resolved.examples.length > 0
                    ? resolved.examples
                    : null;
        const examplesAttr = exampleList ? `data-placeholder-examples="${this._escapeAttr(JSON.stringify(exampleList))}"` : '';

        if (constValue !== undefined) {
            return `
                <input
                    type="text"
                    class="control-input"
                    data-path="${this._escapeAttr(pathPointer)}"
                    data-type="string"
                    data-const="${this._escapeAttr(JSON.stringify(constValue))}"
                    value="${this._escapeAttr(String(constValue))}"
                    disabled
                />
            `;
        }

        return `
            <input
                type="text"
                class="control-input"
                data-path="${this._escapeAttr(pathPointer)}"
                data-type="string"
                placeholder="${this._escapeAttr(exampleList ? '' : (placeholder ?? ''))}"
                ${examplesAttr}
                ${pattern ? `data-pattern="${this._escapeAttr(pattern)}"` : ''}
                ${minLength ? `minlength="${minLength}"` : ''}
                ${maxLength ? `maxlength="${maxLength}"` : ''}
            />
        `;
    }

    private _formatDefaultValue(value: any): string {
        if (typeof value === 'string') {
            return `"${this._escapeHtml(value)}"`;
        }
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        if (Array.isArray(value)) {
            return `[${value.map(v => this._escapeHtml(String(v))).join(', ')}]`;
        }
        if (typeof value === 'object') {
            return this._escapeHtml(JSON.stringify(value));
        }
        return String(value);
    }

    private _generateEmptyState(): string {
        return `
            <div class="settings-empty-state">
                <div class="empty-icon">
                    <span class="codicon codicon-settings-gear"></span>
                </div>
                <div class="empty-title">No settings available</div>
                <div class="empty-description">
                    This configuration file doesn't have any settings defined in its schema.
                </div>
            </div>
        `;
    }

    public getCategories(): ConfigCategory[] {
        return this._categories;
    }

    private _escapeHtml(value: string): string {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private _escapeAttr(value: any): string {
        return this._escapeHtml(String(value));
    }

    private _resolveSchemaNode(node: any): any {
        if (!node || typeof node !== 'object') {
            return node;
        }

        if (typeof node.$ref === 'string' && node.$ref.startsWith('#/') && this._rootSchema) {
            const parts = node.$ref
                .slice(2)
                .split('/')
                .map((p: string) => p.replace(/~1/g, '/').replace(/~0/g, '~'));

            let cur: any = this._rootSchema;
            for (const p of parts) {
                cur = cur?.[p];
            }
            return cur || node;
        }

        return node;
    }

    private _pickSchemaVariant(node: any): any {
        const resolved = this._resolveSchemaNode(node);
        if (!resolved || typeof resolved !== 'object') {
            return resolved;
        }

        const candidates: any[] = []
            .concat(Array.isArray(resolved.anyOf) ? resolved.anyOf : [])
            .concat(Array.isArray(resolved.oneOf) ? resolved.oneOf : [])
            .concat(Array.isArray(resolved.allOf) ? resolved.allOf : []);

        if (candidates.length === 0) {
            return resolved;
        }

        const resolvedCandidates = candidates.map(c => this._resolveSchemaNode(c));
        const isObjectCandidate = (c: any) =>
            !!c &&
            typeof c === 'object' &&
            (c.type === 'object' ||
                !!c.properties ||
                !!c.patternProperties ||
                c.additionalProperties !== undefined ||
                !!c.propertyNames);

	        const scoreObject = (c: any) => {
	            let score = 0;
	            const props = c?.properties && typeof c.properties === 'object' ? Object.keys(c.properties).length : 0;
	            const patternProps = c?.patternProperties && typeof c.patternProperties === 'object' ? Object.keys(c.patternProperties).length : 0;

	            if (props > 0) {
	                score += 200 + props;
	            }
	            if (patternProps > 0) {
	                score += 180 + patternProps;
	            }

	            const ap = c?.additionalProperties;
	            if (ap === true) {
	                score += 120;
	            } else if (ap && typeof ap === 'object') {
	                score += 140;
	            } else if (ap === false) {
	                score -= 50;
	            }

	            if (c?.propertyNames) {
	                score += 30;
	            }
	            if (typeof c?.title === 'string') {
	                score += 5;
	            }
	            if (typeof c?.description === 'string') {
	                score += 3;
	            }

	            return score;
	        };

        const bestObject = resolvedCandidates
            .filter(isObjectCandidate)
            .map(c => ({ c, score: scoreObject(c) }))
            .sort((a, b) => b.score - a.score)[0]?.c;

        const prefer = (t: string) => resolvedCandidates.find(c => c?.type === t);
        const bestArray = prefer('array') || resolvedCandidates.find(c => !!c && typeof c === 'object' && !!c.items);

        return bestObject || bestArray || prefer('string') || prefer('number') || prefer('integer') || resolvedCandidates[0] || resolved;
    }

    private _pickSchemaVariantForScalarValue(node: any): any {
        const resolved = this._resolveSchemaNode(node);
        if (!resolved || typeof resolved !== 'object') {
            return resolved;
        }

        const candidates: any[] = []
            .concat(Array.isArray(resolved.anyOf) ? resolved.anyOf : [])
            .concat(Array.isArray(resolved.oneOf) ? resolved.oneOf : [])
            .concat(Array.isArray(resolved.allOf) ? resolved.allOf : []);

        if (candidates.length === 0) {
            return resolved;
        }

        const resolvedCandidates = candidates.map(c => this._resolveSchemaNode(c));
        const isObjectCandidate = (c: any) =>
            !!c &&
            typeof c === 'object' &&
            (c.type === 'object' ||
                !!c.properties ||
                !!c.patternProperties ||
                c.additionalProperties !== undefined ||
                !!c.propertyNames);

        const prefer = (t: string) => resolvedCandidates.find(c => c?.type === t);
        const bestObject = resolvedCandidates.find(isObjectCandidate);
        const bestArray = prefer('array') || resolvedCandidates.find(c => !!c && typeof c === 'object' && !!c.items);

        // map / scalar value：优先选择 primitive，避免 anyOf (boolean|object) 时默认落到 object 导致无法编辑
        return (
            prefer('boolean') ||
            prefer('string') ||
            prefer('integer') ||
            prefer('number') ||
            bestArray ||
            bestObject ||
            resolvedCandidates[0] ||
            resolved
        );
    }

    private _isObjectSchema(node: any): boolean {
        const resolved = this._pickSchemaVariant(node);
        return !!resolved && typeof resolved === 'object' && (resolved.type === 'object' || !!resolved.properties);
    }

    private _isArraySchema(node: any): boolean {
        const resolved = this._pickSchemaVariant(node);
        return !!resolved && typeof resolved === 'object' && (resolved.type === 'array' || !!resolved.items);
    }

    private _schemaType(node: any): string {
        const resolved = this._pickSchemaVariant(node);
        if (!resolved || typeof resolved !== 'object') {
            return 'string';
        }
        if (resolved.type) {
            return resolved.type;
        }
        if (resolved.properties) {
            return 'object';
        }
        if (resolved.items) {
            return 'array';
        }
        return 'string';
    }

    private _formatPathForSearch(parts: string[]): string {
        let out = '';
        for (const p of parts) {
            if (p === '__INDEX__') {
                out += '[]';
                continue;
            }
            if (!out) {
                out = p;
                continue;
            }
            out += `.${p}`;
        }
        return out;
    }

    private _toJsonPointer(parts: string[]): string {
        const encoded = parts.map(p => String(p).replace(/~/g, '~0').replace(/\//g, '~1'));
        return `/${encoded.join('/')}`;
    }

    private _generateSchemaNode(categoryDomId: string, prop: ConfigProperty, depth: number, isArrayItemTemplate: boolean): string {
        const schemaInput = prop.schema || {};
        const schemaNode = this._pickSchemaVariant(schemaInput);
        const pathParts = prop.pathParts || [prop.key];
        const pathPointer = this._toJsonPointer(pathParts);
        const displayKey = this._formatPathForSearch(pathParts);

        const resolvedType = this._schemaType(schemaNode);

        // 数组项模板内部不要生成会冲突的 id（避免 __INDEX__ 导致重复）
        const domIdKey = isArrayItemTemplate ? `${categoryDomId}:${displayKey}:${depth}` : displayKey;
        const propDomId = this._getPropertyDomId(domIdKey);

        const title = prop.title || pathParts[pathParts.length - 1];
        const description = prop.description;

        const getMapValueLayout = (valueSchemaInput: any): 'inline' | 'block' => {
            const valueResolved = this._pickSchemaVariantForScalarValue(valueSchemaInput || {});
            const valueType = this._schemaType(valueResolved);
            if (valueType === 'array' && this._isArraySchema(valueResolved)) {
                return 'block';
            }
            if (valueType === 'object' && this._isObjectSchema(valueResolved)) {
                return 'block';
            }
            return 'inline';
        };

        const generateMapValueTemplateControl = (valueSchemaInput: any, valuePointerPrefix: string, valuePathPartsPrefix: string[]): string => {
            const valueResolved = this._pickSchemaVariantForScalarValue(valueSchemaInput || {});
            const valueType = this._schemaType(valueResolved);
            const valuePlaceholder = this._placeholderValue(valueResolved, valueResolved?.default);
            const constValue = (valueResolved && typeof valueResolved === 'object' && 'const' in valueResolved) ? (valueResolved as any).const : undefined;

            if (valueType === 'array' && this._isArraySchema(valueResolved)) {
                const arraySchema = this._pickSchemaVariant(valueResolved);
                const itemsSchema = this._pickSchemaVariant(arraySchema.items || {});
                const isItemsObject = this._isObjectSchema(itemsSchema);

                const rawFromResolved = this._randomExample(arraySchema);
                const arrayExamplesAttr = Array.isArray(rawFromResolved)
                    ? `data-array-examples="${this._escapeAttr(JSON.stringify(rawFromResolved))}"`
                    : '';

                if (isItemsObject) {
                    const arrayItemObj = this._pickSchemaVariant(itemsSchema);
                    const itemProps: Record<string, any> = arrayItemObj.properties || {};
                    const itemRequired: string[] = arrayItemObj.required || [];

                    const templateChildren = Object.entries(itemProps).map(([childKey, childSchema]) => {
                        const child: ConfigProperty = {
                            key: childKey,
                            title: childSchema.title || childKey,
                            description: childSchema.description,
                            type: childSchema.type,
                            default: childSchema.default,
                            examples: childSchema.examples,
                            const: childSchema.const,
                            enum: childSchema.enum,
                            minimum: childSchema.minimum,
                            maximum: childSchema.maximum,
                            exclusiveMinimum: childSchema.exclusiveMinimum,
                            pattern: childSchema.pattern,
                            minLength: childSchema.minLength,
                            maxLength: childSchema.maxLength,
                            required: itemRequired.includes(childKey),
                            category: prop.category,
                            schema: childSchema,
                            pathParts: valuePathPartsPrefix.concat('__INDEX__', childKey)
                        };
                        return this._generateSchemaNode(categoryDomId, child, depth + 1, true);
                    }).join('');

                    return `
                        <div class="array-object map-value-array" data-array-path="${this._escapeAttr(valuePointerPrefix)}" ${arrayExamplesAttr}>
                            <div class="array-toolbar">
                                <button type="button" class="array-add-button" data-array-path="${this._escapeAttr(valuePointerPrefix)}">Add</button>
                            </div>
                            <div class="array-items"></div>
                            <template class="array-template">
                                <div class="array-item" data-array-index="__INDEX__">
                                    <div class="array-item-header">
                                        <div class="array-item-title">Item __INDEX__</div>
                                        <button type="button" class="array-remove-button" data-array-path="${this._escapeAttr(valuePointerPrefix)}">Remove</button>
                                    </div>
                                    <div class="array-item-body">
                                        ${templateChildren || '<div class="property-children-empty">No nested properties</div>'}
                                    </div>
                                </div>
                            </template>
                        </div>
                    `;
                }

                const scalarPathPointer = `${valuePointerPrefix}/__INDEX__`;
                const scalarControl = this._generateArrayScalarTemplateControl(scalarPathPointer, itemsSchema);
                return `
                    <div class="array-object map-value-array" data-array-path="${this._escapeAttr(valuePointerPrefix)}" ${arrayExamplesAttr}>
                        <div class="array-toolbar">
                            <button type="button" class="array-add-button" data-array-path="${this._escapeAttr(valuePointerPrefix)}">Add</button>
                        </div>
                        <div class="array-items"></div>
                        <template class="array-template">
                            <div class="array-item" data-array-index="__INDEX__">
                                <div class="array-item-row">
                                    ${scalarControl}
                                    <button type="button" class="array-remove-button" data-array-path="${this._escapeAttr(valuePointerPrefix)}">Remove</button>
                                </div>
                            </div>
                        </template>
                    </div>
                `;
            }

            if (valueType === 'object' && this._isObjectSchema(valueResolved)) {
                const valueObj = this._pickSchemaVariant(valueResolved);
                const objProps: Record<string, any> = valueObj?.properties || {};
                const objRequired: string[] = valueObj?.required || [];

                const body = Object.entries(objProps).map(([childKey, childSchema]) => {
                    const child: ConfigProperty = {
                        key: childKey,
                        title: childSchema.title || childKey,
                        description: childSchema.description,
                        type: childSchema.type,
                        default: childSchema.default,
                        examples: childSchema.examples,
                        const: childSchema.const,
                        enum: childSchema.enum,
                        minimum: childSchema.minimum,
                        maximum: childSchema.maximum,
                        exclusiveMinimum: childSchema.exclusiveMinimum,
                        pattern: childSchema.pattern,
                        minLength: childSchema.minLength,
                        maxLength: childSchema.maxLength,
                        required: objRequired.includes(childKey),
                        category: prop.category,
                        schema: childSchema,
                        pathParts: valuePathPartsPrefix.concat(childKey)
                    };
                    return this._generateSchemaNode(categoryDomId, child, depth + 1, true);
                }).join('');

                return `
                    <div class="map-value-object">
                        ${body || '<div class="property-children-empty">No nested properties</div>'}
                    </div>
                `;
            }

            if (valueType === 'boolean') {
                return `
                    <input
                        type="checkbox"
                        class="map-value-input"
                        data-type="boolean"
                        data-map-role="value"
                        data-path="${this._escapeAttr(valuePointerPrefix)}"
                        ${constValue !== undefined ? `data-const="${this._escapeAttr(JSON.stringify(constValue))}"` : ''}
                        ${constValue ? 'checked' : ''}
                        ${constValue !== undefined ? 'disabled' : ''}
                    />
                `;
            }

            if (valueType === 'number' || valueType === 'integer') {
                const minimum = (valueResolved as any)?.minimum;
                const maximum = (valueResolved as any)?.maximum;
                const exclusiveMinimum = (() => {
                    const raw = (valueResolved as any)?.exclusiveMinimum;
                    if (typeof raw === 'number') {
                        return raw;
                    }
                    if (raw === true && typeof (valueResolved as any)?.minimum === 'number') {
                        return (valueResolved as any).minimum;
                    }
                    return undefined;
                })();

                return `
                    <input
                        type="number"
                        class="control-input map-value-input"
                        data-type="${this._escapeAttr(valueType)}"
                        data-map-role="value"
                        data-path="${this._escapeAttr(valuePointerPrefix)}"
                        ${exclusiveMinimum !== undefined ? `data-exclusive-minimum="${this._escapeAttr(String(exclusiveMinimum))}"` : ''}
                        placeholder="${this._escapeAttr(valuePlaceholder ?? '')}"
                        ${minimum !== undefined ? `min="${minimum}"` : ''}
                        ${maximum !== undefined ? `max="${maximum}"` : ''}
                        ${valueType === 'integer' ? 'step="1"' : 'step="any"'}
                        ${constValue !== undefined ? `data-const="${this._escapeAttr(JSON.stringify(constValue))}"` : ''}
                        ${constValue !== undefined ? `value="${this._escapeAttr(String(constValue))}" disabled` : ''}
                    />
                `;
            }

            if (valueType === 'string' && Array.isArray((valueResolved as any)?.enum) && (valueResolved as any).enum.length > 0) {
                const values = (valueResolved as any).enum as string[];
                return `
                    <select class="control-select map-value-input" data-type="enum" data-map-role="value" data-path="${this._escapeAttr(valuePointerPrefix)}" ${constValue !== undefined ? 'disabled' : ''}>
                        ${values.map(v => `<option value="${this._escapeAttr(v)}"${constValue !== undefined && v === constValue ? ' selected' : ''}>${this._escapeHtml(v)}</option>`).join('')}
                    </select>
                `;
            }

            const pattern = typeof (valueResolved as any)?.pattern === 'string' ? (valueResolved as any).pattern : undefined;
            const minLength = typeof (valueResolved as any)?.minLength === 'number' ? (valueResolved as any).minLength : undefined;
            const maxLength = typeof (valueResolved as any)?.maxLength === 'number' ? (valueResolved as any).maxLength : undefined;

	            return `
	                <input
	                    type="text"
	                    class="control-input map-value-input"
	                    data-type="string"
	                    data-map-role="value"
	                    data-path="${this._escapeAttr(valuePointerPrefix)}"
	                    placeholder="${this._escapeAttr(valuePlaceholder ?? '')}"
	                    ${pattern ? `data-pattern="${this._escapeAttr(pattern)}"` : ''}
	                    ${minLength ? `minlength="${minLength}"` : ''}
	                    ${maxLength ? `maxlength="${maxLength}"` : ''}
	                    ${constValue !== undefined ? `data-const="${this._escapeAttr(JSON.stringify(constValue))}"` : ''}
	                    ${constValue !== undefined ? `value="${this._escapeAttr(String(constValue))}" disabled` : ''}
	                />
	            `;
	        };

        if (resolvedType === 'object' && this._isObjectSchema(schemaNode)) {
            const resolved = this._pickSchemaVariant(schemaNode);
            const childProps: Record<string, any> = resolved.properties || {};
            const required: string[] = resolved.required || [];
            const patternProps: Record<string, any> = resolved.patternProperties || {};

            const anyOfRaw: any[] | null = Array.isArray((schemaInput as any)?.anyOf)
                ? (schemaInput as any).anyOf
                : Array.isArray((schemaInput as any)?.oneOf)
                    ? (schemaInput as any).oneOf
                    : null;

            const anyOfObjectVariants = (() => {
                if (!anyOfRaw || anyOfRaw.length < 2) {
                    return null;
                }
                const variants = anyOfRaw.map(v => this._pickSchemaVariant(v));
                const allObjects = variants.every(v => this._schemaType(v) === 'object' && this._isObjectSchema(v));
                if (!allObjects) {
                    return null;
                }
                return variants;
            })();

            if (anyOfObjectVariants) {
                const findDiscriminator = (objSchema: any): { key: string; value: string } | null => {
                    const props: Record<string, any> = objSchema?.properties || {};
                    for (const [k, s] of Object.entries(props)) {
                        const picked = this._pickSchemaVariant(s);
                        const c = picked && typeof picked === 'object' ? (picked as any).const : undefined;
                        if (typeof c === 'string') {
                            return { key: k, value: c };
                        }
                    }
                    return null;
                };

                const options = anyOfObjectVariants.map((v, idx) => {
                    const d = findDiscriminator(v);
                    const label = d?.value || (typeof (v as any)?.title === 'string' ? (v as any).title : `Option ${idx + 1}`);
                    return `<option value="${idx}">${this._escapeHtml(label)}</option>`;
                }).join('');

                const variantsHtml = anyOfObjectVariants.map((v, idx) => {
                    const vObj = this._pickSchemaVariant(v);
                    const vProps: Record<string, any> = vObj?.properties || {};
                    const vReq: string[] = vObj?.required || [];
                    const d = findDiscriminator(vObj);

                    const vChildren = Object.entries(vProps).map(([childKey, childSchema]) => {
                        const child: ConfigProperty = {
                            key: childKey,
                            title: childSchema.title || childKey,
                            description: childSchema.description,
                            type: childSchema.type,
                            default: childSchema.default,
                            examples: childSchema.examples,
                            const: childSchema.const,
                            enum: childSchema.enum,
                            minimum: childSchema.minimum,
                            maximum: childSchema.maximum,
                            exclusiveMinimum: childSchema.exclusiveMinimum,
                            pattern: childSchema.pattern,
                            minLength: childSchema.minLength,
                            maxLength: childSchema.maxLength,
                            required: vReq.includes(childKey),
                            category: prop.category,
                            schema: childSchema,
                            pathParts: pathParts.concat(childKey)
                        };
                        return this._generateSchemaNode(categoryDomId, child, depth + 1, isArrayItemTemplate);
                    }).join('');

                    return `
                        <div class="anyof-variant ${idx === 0 ? 'active' : 'hidden'}"
                            data-anyof-index="${idx}"
                            data-anyof-active="${idx === 0 ? 'true' : 'false'}"
                            ${d ? `data-anyof-discriminator-key="${this._escapeAttr(d.key)}" data-anyof-discriminator-const="${this._escapeAttr(d.value)}"` : ''}
                        >
                            ${vChildren || '<div class="property-children-empty">No nested properties</div>'}
                        </div>
                    `;
                }).join('');

                return `
                    <div class="property-item property-group depth-${depth}" ${isArrayItemTemplate ? '' : `id="setting-${propDomId}"`} data-property="${this._escapeAttr(displayKey)}" ${isArrayItemTemplate ? '' : `data-property-dom="${propDomId}"`} data-category="${categoryDomId}" data-path="${this._escapeAttr(pathPointer)}">
                        <div class="property-header">
                            <div class="property-info">
                                <div class="property-title">
                                    ${this._escapeHtml(title)}
                                    ${prop.required ? '<span class="property-required">*</span>' : ''}
                                </div>
                                ${description ? `<div class="property-description">${this._escapeHtml(description)}</div>` : ''}
                            </div>
                        </div>
                        <div class="property-children">
                            <div class="anyof-object" data-anyof-path="${this._escapeAttr(pathPointer)}">
                                <div class="anyof-toolbar">
                                    <div class="anyof-label">Variant</div>
                                    <select class="control-select anyof-selector" data-anyof-role="selector">
                                        ${options}
                                    </select>
                                </div>
                                <div class="anyof-variants">
                                    ${variantsHtml}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }

	            const childrenHtml = Object.entries(childProps).map(([childKey, childSchema]) => {
	                const child: ConfigProperty = {
	                    key: childKey,
	                    title: childSchema.title || childKey,
	                    description: childSchema.description,
	                    type: childSchema.type,
	                    default: childSchema.default,
	                    examples: childSchema.examples,
	                    const: childSchema.const,
	                    enum: childSchema.enum,
	                    minimum: childSchema.minimum,
	                    maximum: childSchema.maximum,
	                    exclusiveMinimum: childSchema.exclusiveMinimum,
	                    pattern: childSchema.pattern,
	                    minLength: childSchema.minLength,
	                    maxLength: childSchema.maxLength,
	                    required: required.includes(childKey),
	                    category: prop.category,
                    schema: childSchema,
                    pathParts: pathParts.concat(childKey)
                };
                return this._generateSchemaNode(categoryDomId, child, depth + 1, isArrayItemTemplate);
            }).join('');

            const patternEntries = Object.entries(patternProps);
            const shouldRenderPatternMap = !childrenHtml && patternEntries.length > 0;

            if (shouldRenderPatternMap) {
                const mapDomId = this._getPropertyDomId(`${domIdKey}:map`);
                const [keyPatternRaw, valueSchemaRaw] = patternEntries[0] as any;
                const valueControl = generateMapValueTemplateControl(valueSchemaRaw, `${pathPointer}/__KEY__`, pathParts.concat('__KEY__'));
                const isInline = getMapValueLayout(valueSchemaRaw) === 'inline';

                return `
                    <div class="property-item property-group depth-${depth}" ${isArrayItemTemplate ? '' : `id="setting-${propDomId}"`} data-property="${this._escapeAttr(displayKey)}" ${isArrayItemTemplate ? '' : `data-property-dom="${propDomId}"`} data-category="${categoryDomId}" data-path="${this._escapeAttr(pathPointer)}">
                        <div class="property-header">
                            <div class="property-info">
                                <div class="property-title">
                                    ${this._escapeHtml(title)}
                                    ${prop.required ? '<span class="property-required">*</span>' : ''}
                                </div>
                                ${description ? `<div class="property-description">${this._escapeHtml(description)}</div>` : ''}
                            </div>
                        </div>
                        <div class="map-object"
                            data-map-path="${this._escapeAttr(pathPointer)}"
                            data-map-dom="${mapDomId}"
                            data-map-key-pattern="${this._escapeAttr(String(keyPatternRaw || ''))}"
                        >
                            <div class="map-toolbar">
                                <button type="button" class="map-add-button" data-map-path="${this._escapeAttr(pathPointer)}">Add</button>
                                <div class="map-hint">Key pattern: <code>${this._escapeHtml(String(keyPatternRaw || ''))}</code></div>
                            </div>
                            <div class="map-items" id="map-items-${mapDomId}"></div>
                            <template id="map-template-${mapDomId}">
                                <div class="map-item${isInline ? ' map-item--inline' : ''}">
                                    <div class="map-item-header${isInline ? ' map-item-header--inline' : ''}">
                                        <input
                                            type="text"
                                            class="control-input map-key-input"
                                            placeholder="KEY"
                                            data-path="${this._escapeAttr(pathPointer)}"
                                            data-type="mapKey"
                                        />
                                        ${isInline ? valueControl : ''}
                                        <button type="button" class="map-remove-button" data-map-path="${this._escapeAttr(pathPointer)}">Remove</button>
                                    </div>
                                    ${isInline ? '' : `<div class="map-item-body">${valueControl}</div>`}
                                </div>
                            </template>
                        </div>
                    </div>
                `;
            }

            const additionalProps = resolved.additionalProperties;
            const hasAdditionalMap = !childrenHtml &&
                patternEntries.length === 0 &&
                (additionalProps === true || (additionalProps && typeof additionalProps === 'object'));

            if (hasAdditionalMap) {
                const mapDomId = this._getPropertyDomId(`${domIdKey}:map`);
                const propNames = this._pickSchemaVariant(resolved.propertyNames || {});
                const keyPatternRaw = typeof (propNames as any)?.pattern === 'string' ? (propNames as any).pattern : '';
                const valueSchemaRaw = additionalProps === true ? {} : additionalProps;
                const valueControl = generateMapValueTemplateControl(valueSchemaRaw, `${pathPointer}/__KEY__`, pathParts.concat('__KEY__'));
                const isInline = getMapValueLayout(valueSchemaRaw) === 'inline';

                return `
                    <div class="property-item property-group depth-${depth}" ${isArrayItemTemplate ? '' : `id="setting-${propDomId}"`} data-property="${this._escapeAttr(displayKey)}" ${isArrayItemTemplate ? '' : `data-property-dom="${propDomId}"`} data-category="${categoryDomId}" data-path="${this._escapeAttr(pathPointer)}">
                        <div class="property-header">
                            <div class="property-info">
                                <div class="property-title">
                                    ${this._escapeHtml(title)}
                                    ${prop.required ? '<span class="property-required">*</span>' : ''}
                                </div>
                                ${description ? `<div class="property-description">${this._escapeHtml(description)}</div>` : ''}
                            </div>
                        </div>
                        <div class="map-object"
                            data-map-path="${this._escapeAttr(pathPointer)}"
                            data-map-dom="${mapDomId}"
                            data-map-key-pattern="${this._escapeAttr(String(keyPatternRaw || ''))}"
                        >
                            <div class="map-toolbar">
                                <button type="button" class="map-add-button" data-map-path="${this._escapeAttr(pathPointer)}">Add</button>
                                ${keyPatternRaw ? `<div class="map-hint">Key pattern: <code>${this._escapeHtml(String(keyPatternRaw || ''))}</code></div>` : ''}
                            </div>
                            <div class="map-items" id="map-items-${mapDomId}"></div>
                            <template id="map-template-${mapDomId}">
                                <div class="map-item${isInline ? ' map-item--inline' : ''}">
                                    <div class="map-item-header${isInline ? ' map-item-header--inline' : ''}">
                                        <input
                                            type="text"
                                            class="control-input map-key-input"
                                            placeholder="KEY"
                                            data-path="${this._escapeAttr(pathPointer)}"
                                            data-type="mapKey"
                                        />
                                        ${isInline ? valueControl : ''}
                                        <button type="button" class="map-remove-button" data-map-path="${this._escapeAttr(pathPointer)}">Remove</button>
                                    </div>
                                    ${isInline ? '' : `<div class="map-item-body">${valueControl}</div>`}
                                </div>
                            </template>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="property-item property-group depth-${depth}" ${isArrayItemTemplate ? '' : `id="setting-${propDomId}"`} data-property="${this._escapeAttr(displayKey)}" ${isArrayItemTemplate ? '' : `data-property-dom="${propDomId}"`} data-category="${categoryDomId}" data-path="${this._escapeAttr(pathPointer)}">
                    <div class="property-header">
                        <div class="property-info">
                            <div class="property-title">
                                ${this._escapeHtml(title)}
                                ${prop.required ? '<span class="property-required">*</span>' : ''}
                            </div>
                            ${description ? `<div class="property-description">${this._escapeHtml(description)}</div>` : ''}
                        </div>
                    </div>
                    <div class="property-children">
                        ${childrenHtml || '<div class="property-children-empty">No nested properties</div>'}
                    </div>
                </div>
            `;
        }

	        if (resolvedType === 'array' && this._isArraySchema(schemaNode)) {
	            const resolved = this._pickSchemaVariant(schemaNode);
	            const itemsSchema = this._pickSchemaVariant(resolved.items || {});
	            const isItemsObject = this._isObjectSchema(itemsSchema);
	            const rawFromProp = Array.isArray(prop.examples) ? prop.examples[0] : undefined;
	            const rawFromOriginal = this._randomExample(prop.schema);
	            const rawFromResolved = this._randomExample(resolved);
	            const arrayExample0 =
	                (Array.isArray(rawFromProp) ? rawFromProp : undefined) ||
	                (Array.isArray(rawFromOriginal) ? rawFromOriginal : undefined) ||
	                (Array.isArray(rawFromResolved) ? rawFromResolved : undefined);

	            const arrayExamplesAttr = Array.isArray(arrayExample0)
	                ? `data-array-examples="${this._escapeAttr(JSON.stringify(arrayExample0))}"`
	                : '';

            if (isItemsObject) {
                const arrayDomId = this._getPropertyDomId(`${domIdKey}:array`);
                const itemObject = this._pickSchemaVariant(itemsSchema);
                const itemProps: Record<string, any> = itemObject.properties || {};
                const itemRequired: string[] = itemObject.required || [];

	                const templateChildren = Object.entries(itemProps).map(([childKey, childSchema]) => {
	                    const child: ConfigProperty = {
	                        key: childKey,
	                        title: childSchema.title || childKey,
	                        description: childSchema.description,
	                        type: childSchema.type,
	                        default: childSchema.default,
	                        examples: childSchema.examples,
	                        const: childSchema.const,
	                        enum: childSchema.enum,
	                        minimum: childSchema.minimum,
	                        maximum: childSchema.maximum,
	                        exclusiveMinimum: childSchema.exclusiveMinimum,
	                        pattern: childSchema.pattern,
	                        minLength: childSchema.minLength,
	                        maxLength: childSchema.maxLength,
	                        required: itemRequired.includes(childKey),
	                        category: prop.category,
                        schema: childSchema,
                        pathParts: pathParts.concat('__INDEX__', childKey)
                    };
                    return this._generateSchemaNode(categoryDomId, child, depth + 1, true);
                }).join('');

                return `
                    <div class="property-item property-group depth-${depth}" ${isArrayItemTemplate ? '' : `id="setting-${propDomId}"`} data-property="${this._escapeAttr(displayKey)}" ${isArrayItemTemplate ? '' : `data-property-dom="${propDomId}"`} data-category="${categoryDomId}" data-path="${this._escapeAttr(pathPointer)}">
                        <div class="property-header">
                            <div class="property-info">
                                <div class="property-title">
                                    ${this._escapeHtml(title)}
                                    ${prop.required ? '<span class="property-required">*</span>' : ''}
                                </div>
                                ${description ? `<div class="property-description">${this._escapeHtml(description)}</div>` : ''}
                            </div>
                        </div>
                        <div class="array-object" data-array-path="${this._escapeAttr(pathPointer)}" data-array-dom="${arrayDomId}" ${arrayExamplesAttr}>
                            <div class="array-toolbar">
                                <button type="button" class="array-add-button" data-array-path="${this._escapeAttr(pathPointer)}">Add</button>
                            </div>
                            <div class="array-items" id="array-items-${arrayDomId}"></div>
                            <template id="array-template-${arrayDomId}">
                                <div class="array-item" data-array-index="__INDEX__">
                                    <div class="array-item-header">
                                        <div class="array-item-title">Item __INDEX__</div>
                                        <button type="button" class="array-remove-button" data-array-path="${this._escapeAttr(pathPointer)}">Remove</button>
                                    </div>
                                    <div class="array-item-body">
                                        ${templateChildren || '<div class="property-children-empty">No nested properties</div>'}
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                `;
            }

            // primitive array
            const arrayDomId = this._getPropertyDomId(`${domIdKey}:array`);
            const scalarPathPointer = `${pathPointer}/__INDEX__`;
            const scalarControl = this._generateArrayScalarTemplateControl(scalarPathPointer, itemsSchema);
            return `
                <div class="property-item property-group depth-${depth}" ${isArrayItemTemplate ? '' : `id="setting-${propDomId}"`} data-property="${this._escapeAttr(displayKey)}" ${isArrayItemTemplate ? '' : `data-property-dom="${propDomId}"`} data-category="${categoryDomId}" data-path="${this._escapeAttr(pathPointer)}">
                    <div class="property-header">
                        <div class="property-info">
                            <div class="property-title">
                                ${this._escapeHtml(title)}
                                ${prop.required ? '<span class="property-required">*</span>' : ''}
                            </div>
                            ${description ? `<div class="property-description">${this._escapeHtml(description)}</div>` : ''}
                        </div>
                    </div>
                    <div class="array-object" data-array-path="${this._escapeAttr(pathPointer)}" data-array-dom="${arrayDomId}" ${arrayExamplesAttr}>
                        <div class="array-toolbar">
                            <button type="button" class="array-add-button" data-array-path="${this._escapeAttr(pathPointer)}">Add</button>
                        </div>
                        <div class="array-items" id="array-items-${arrayDomId}"></div>
                        <template id="array-template-${arrayDomId}">
                            <div class="array-item" data-array-index="__INDEX__">
                                <div class="array-item-header">
                                    <div class="array-item-title">Item __INDEX__</div>
                                    <button type="button" class="array-remove-button" data-array-path="${this._escapeAttr(pathPointer)}">Remove</button>
                                </div>
                                <div class="array-item-body">
                                    <div class="array-item-row">
                                        ${scalarControl}
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>
                    ${prop.default !== undefined ? `<div class="property-default">Default: ${this._formatDefaultValue(prop.default)}</div>` : ''}
                </div>
            `;
        }

	        // scalar
	        let controlHtml = '';
	        const constValue = (schemaNode && typeof schemaNode === 'object' && 'const' in schemaNode) ? (schemaNode as any).const : undefined;
	            if (constValue !== undefined) {
	                if (resolvedType === 'boolean') {
	                controlHtml = `
	                    <div class="control-toggle">
	                        <input
	                            type="checkbox"
	                            id="property-${propDomId}"
	                            data-path="${this._escapeAttr(pathPointer)}"
	                            data-type="boolean"
	                            data-const="${this._escapeAttr(JSON.stringify(constValue))}"
	                            ${constValue ? 'checked' : ''}
	                            disabled
	                        />
	                        <label for="property-${propDomId}">
	                            <span class="toggle-slider"></span>
	                        </label>
	                    </div>
	                `;
	            } else if (resolvedType === 'number' || resolvedType === 'integer') {
		                const exclusiveMinimum = (() => {
		                    if (typeof prop.exclusiveMinimum === 'number') {
		                        return prop.exclusiveMinimum;
		                    }
		                    if (prop.exclusiveMinimum === true && typeof prop.minimum === 'number') {
		                        return prop.minimum;
		                    }
		                    const raw = (schemaNode as any)?.exclusiveMinimum;
		                    if (typeof raw === 'number') {
		                        return raw;
		                    }
		                    if (raw === true && typeof (schemaNode as any)?.minimum === 'number') {
		                        return (schemaNode as any).minimum;
		                    }
		                    return undefined;
		                })();
	                controlHtml = `
	                    <input
	                        type="number"
	                        id="property-${propDomId}"
	                        class="control-input"
	                        data-path="${this._escapeAttr(pathPointer)}"
	                        data-type="${this._escapeAttr(resolvedType)}"
	                        data-const="${this._escapeAttr(JSON.stringify(constValue))}"
	                        ${exclusiveMinimum !== undefined ? `data-exclusive-minimum="${this._escapeAttr(String(exclusiveMinimum))}"` : ''}
	                        value="${this._escapeAttr(String(constValue))}"
	                        disabled
	                    />
	                `;
	            } else {
	                controlHtml = `
	                    <input
	                        type="text"
	                        id="property-${propDomId}"
	                        class="control-input"
	                        data-path="${this._escapeAttr(pathPointer)}"
	                        data-type="${this._escapeAttr(resolvedType || 'string')}"
	                        data-const="${this._escapeAttr(JSON.stringify(constValue))}"
	                        value="${this._escapeAttr(String(constValue))}"
	                        disabled
	                    />
	                `;
	            }
	        } else if (resolvedType === 'boolean') {
	            controlHtml = this._generateBooleanControl(pathPointer, propDomId, prop.default);
	        } else if (resolvedType === 'string' && Array.isArray(prop.enum) && prop.enum.length > 0) {
	            controlHtml = this._generateEnumControl(pathPointer, propDomId, prop.enum, prop.default);
	        } else if (resolvedType === 'number' || resolvedType === 'integer') {
		            const exclusiveMinimum = (() => {
		                if (typeof prop.exclusiveMinimum === 'number') {
		                    return prop.exclusiveMinimum;
		                }
		                if (prop.exclusiveMinimum === true && typeof prop.minimum === 'number') {
		                    return prop.minimum;
		                }
		                const raw = (schemaNode as any)?.exclusiveMinimum;
		                if (typeof raw === 'number') {
		                    return raw;
		                }
		                if (raw === true && typeof (schemaNode as any)?.minimum === 'number') {
		                    return (schemaNode as any).minimum;
		                }
		                return undefined;
		            })();
	            controlHtml = this._generateNumberControl(
	                pathPointer,
	                propDomId,
	                this._placeholderForProp(schemaNode, prop),
	                resolvedType as any,
	                prop.minimum,
	                prop.maximum,
	                exclusiveMinimum
	            );
	        } else {
	            controlHtml = this._generateStringControl(
	                pathPointer,
	                propDomId,
	                this._placeholderForProp(schemaNode, prop),
	                prop.pattern,
	                prop.minLength,
	                prop.maxLength
	            );
	        }

        return `
            <div class="property-item depth-${depth}" ${isArrayItemTemplate ? '' : `id="setting-${propDomId}"`} data-property="${this._escapeAttr(displayKey)}" ${isArrayItemTemplate ? '' : `data-property-dom="${propDomId}"`} data-category="${categoryDomId}" data-path="${this._escapeAttr(pathPointer)}">
                <div class="property-header">
                    <div class="property-info">
                        <div class="property-title">
                            ${this._escapeHtml(title)}
                            ${prop.required ? '<span class="property-required">*</span>' : ''}
                        </div>
                        ${description ? `<div class="property-description">${this._escapeHtml(description)}</div>` : ''}
                    </div>
                    <div class="property-control">
                        ${controlHtml}
                    </div>
                </div>
                ${prop.default !== undefined ? `<div class="property-default">Default: ${this._formatDefaultValue(prop.default)}</div>` : ''}
            </div>
        `;
    }

    private _getCategoryDomId(categoryId: string): string {
        const cached = this._categoryDomIdById.get(categoryId);
        if (cached) {
            return cached;
        }
        const domId = this._makeDomId('cat', categoryId);
        this._categoryDomIdById.set(categoryId, domId);
        return domId;
    }

    private _getPropertyDomId(propertyKey: string): string {
        const cached = this._propertyDomIdByKey.get(propertyKey);
        if (cached) {
            return cached;
        }
        const domId = this._makeDomId('prop', propertyKey);
        this._propertyDomIdByKey.set(propertyKey, domId);
        return domId;
    }

    private _makeDomId(prefix: string, raw: string): string {
        const base = String(raw)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'item';

        const idBase = `${prefix}-${base}`;
        let candidate = idBase;
        let i = 2;

        while (this._usedDomIds.has(candidate)) {
            candidate = `${idBase}-${i++}`;
        }

        this._usedDomIds.add(candidate);
        return candidate;
    }
}
