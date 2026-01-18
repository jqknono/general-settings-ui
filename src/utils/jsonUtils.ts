/**
 * JSON处理工具类
 */
export class JsonUtils {
    /**
     * 格式化JSON字符串
     */
    public static formatJson(json: string, indent: number = 2): string {
        try {
            const parsed = JSON.parse(json);
            return JSON.stringify(parsed, null, indent);
        } catch {
            return json;
        }
    }

    /**
     * 压缩JSON字符串
     */
    public static minifyJson(json: string): string {
        try {
            const parsed = JSON.parse(json);
            return JSON.stringify(parsed);
        } catch {
            return json;
        }
    }

    /**
     * 验证JSON字符串是否有效
     */
    public static isValidJson(json: string): boolean {
        try {
            JSON.parse(json);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 深度合并对象
     */
    public static deepMerge(target: any, source: any): any {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        
        return result;
    }

    /**
     * 获取对象中指定路径的值
     */
    public static getValueByPath(obj: any, path: string): any {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    /**
     * 设置对象中指定路径的值
     */
    public static setValueByPath(obj: any, path: string, value: any): void {
        const keys = path.split('.');
        const lastKey = keys.pop();
        
        if (!lastKey) {
            return;
        }

        const target = keys.reduce((current, key) => {
            if (current[key] === undefined || typeof current[key] !== 'object') {
                current[key] = {};
            }
            return current[key];
        }, obj);

        target[lastKey] = value;
    }

    /**
     * 删除对象中指定路径的键
     */
    public static deleteValueByPath(obj: any, path: string): void {
        const keys = path.split('.');
        const lastKey = keys.pop();
        
        if (!lastKey) {
            return;
        }

        const target = keys.reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : null;
        }, obj);

        if (target && target[lastKey] !== undefined) {
            delete target[lastKey];
        }
    }

    /**
     * 将扁平对象转换为嵌套对象
     */
    public static unflatten(obj: { [key: string]: any }): any {
        const result: any = {};
        
        for (const key in obj) {
            this.setValueByPath(result, key, obj[key]);
        }
        
        return result;
    }

    /**
     * 将嵌套对象转换为扁平对象
     */
    public static flatten(obj: any, prefix: string = ''): { [key: string]: any } {
        const result: { [key: string]: any } = {};
        
        for (const key in obj) {
            const newKey = prefix ? `${prefix}.${key}` : key;
            
            if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                Object.assign(result, this.flatten(obj[key], newKey));
            } else {
                result[newKey] = obj[key];
            }
        }
        
        return result;
    }

    /**
     * 生成JSON路径建议
     */
    public static generatePathSuggestions(obj: any, currentPath: string = ''): string[] {
        const suggestions: string[] = [];
        
        for (const key in obj) {
            const fullPath = currentPath ? `${currentPath}.${key}` : key;
            suggestions.push(fullPath);
            
            if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                suggestions.push(...this.generatePathSuggestions(obj[key], fullPath));
            }
        }
        
        return suggestions;
    }

    /**
     * 修复常见的JSON错误
     */
    public static fixJson(json: string): string {
        let fixed = json;
        
        // 修复尾随逗号
        fixed = fixed.replace(/,\s*([}\]])/g, '$1');
        
        // 修复单引号
        fixed = fixed.replace(/'/g, '"');
        
        // 修复未引用的属性名
        fixed = fixed.replace(/(\w+):/g, '"$1":');
        
        // 修复注释
        fixed = fixed.replace(/\/\/.*$/gm, '');
        fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
        
        return fixed;
    }
}