/**
 * JSON处理工具类
 */
export class JsonUtils {
    /**
     * 格式化JSON字符串
     */
    static formatJson(json, indent = 2) {
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
    static minifyJson(json) {
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
    static isValidJson(json) {
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
    static deepMerge(target, source) {
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
    static getValueByPath(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    /**
     * 设置对象中指定路径的值
     */
    static setValueByPath(obj, path, value) {
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
    static deleteValueByPath(obj, path) {
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
    static unflatten(obj) {
        const result = {};
        
        for (const key in obj) {
            this.setValueByPath(result, key, obj[key]);
        }
        
        return result;
    }

    /**
     * 将嵌套对象转换为扁平对象
     */
    static flatten(obj, prefix = '') {
        const result = {};
        
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
    static generatePathSuggestions(obj, currentPath = '') {
        const suggestions = [];
        
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
    static fixJson(json) {
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

    /**
     * 比较两个JSON对象
     */
    static compareJson(obj1, obj2) {
        const changes = {
            added: [],
            removed: [],
            modified: [],
            unchanged: []
        };

        const keys1 = new Set(Object.keys(obj1));
        const keys2 = new Set(Object.keys(obj2));

        // 检查新增的键
        for (const key of keys2) {
            if (!keys1.has(key)) {
                changes.added.push({ key, value: obj2[key] });
            }
        }

        // 检查删除的键
        for (const key of keys1) {
            if (!keys2.has(key)) {
                changes.removed.push({ key, value: obj1[key] });
            }
        }

        // 检查修改的键
        for (const key of keys1) {
            if (keys2.has(key)) {
                const val1 = obj1[key];
                const val2 = obj2[key];
                
                if (JSON.stringify(val1) === JSON.stringify(val2)) {
                    changes.unchanged.push({ key, value: val1 });
                } else {
                    changes.modified.push({ 
                        key, 
                        oldValue: val1, 
                        newValue: val2 
                    });
                }
            }
        }

        return changes;
    }

    /**
     * 获取JSON对象的所有路径
     */
    static getAllPaths(obj, prefix = '', paths = []) {
        for (const key in obj) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            paths.push(fullPath);
            
            if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                this.getAllPaths(obj[key], fullPath, paths);
            }
        }
        
        return paths;
    }

    /**
     * 根据Schema验证JSON
     */
    static validateWithSchema(json, schema) {
        try {
            const data = JSON.parse(json);
            
            // 这里应该使用真正的JSON Schema验证库
            // 暂时使用简单的验证
            const errors = [];
            
            if (schema.type === 'object' && schema.properties) {
                for (const [key, prop] of Object.entries(schema.properties)) {
                    if (schema.required && schema.required.includes(key) && data[key] === undefined) {
                        errors.push(`缺少必需属性: ${key}`);
                    }
                    
                    if (data[key] !== undefined) {
                        if (prop.type === 'string' && typeof data[key] !== 'string') {
                            errors.push(`属性 ${key} 应该是字符串类型`);
                        } else if (prop.type === 'number' && typeof data[key] !== 'number') {
                            errors.push(`属性 ${key} 应该是数字类型`);
                        } else if (prop.type === 'boolean' && typeof data[key] !== 'boolean') {
                            errors.push(`属性 ${key} 应该是布尔类型`);
                        }
                    }
                }
            }
            
            return {
                valid: errors.length === 0,
                errors
            };
        } catch (error) {
            return {
                valid: false,
                errors: ['无效的JSON格式']
            };
        }
    }

    /**
     * 获取JSON对象的深度
     */
    static getDepth(obj, currentDepth = 0) {
        if (typeof obj !== 'object' || obj === null) {
            return currentDepth;
        }
        
        let maxDepth = currentDepth;
        
        for (const key in obj) {
            const depth = this.getDepth(obj[key], currentDepth + 1);
            maxDepth = Math.max(maxDepth, depth);
        }
        
        return maxDepth;
    }

    /**
     * 统计JSON对象的信息
     */
    static getStats(obj) {
        const stats = {
            keys: 0,
            values: 0,
            arrays: 0,
            objects: 0,
            strings: 0,
            numbers: 0,
            booleans: 0,
            nulls: 0,
            depth: this.getDepth(obj)
        };

        this.traverseObject(obj, stats);
        
        return stats;
    }

    /**
     * 遍历对象统计信息
     */
    static traverseObject(obj, stats) {
        for (const key in obj) {
            stats.keys++;
            
            if (Array.isArray(obj[key])) {
                stats.arrays++;
                stats.values++;
                this.traverseArray(obj[key], stats);
            } else if (obj[key] && typeof obj[key] === 'object') {
                stats.objects++;
                stats.values++;
                this.traverseObject(obj[key], stats);
            } else {
                stats.values++;
                
                if (typeof obj[key] === 'string') {
                    stats.strings++;
                } else if (typeof obj[key] === 'number') {
                    stats.numbers++;
                } else if (typeof obj[key] === 'boolean') {
                    stats.booleans++;
                } else if (obj[key] === null) {
                    stats.nulls++;
                }
            }
        }
    }

    /**
     * 遍历数组统计信息
     */
    static traverseArray(arr, stats) {
        arr.forEach(item => {
            if (Array.isArray(item)) {
                stats.arrays++;
                this.traverseArray(item, stats);
            } else if (item && typeof item === 'object') {
                stats.objects++;
                this.traverseObject(item, stats);
            } else if (typeof item === 'string') {
                stats.strings++;
            } else if (typeof item === 'number') {
                stats.numbers++;
            } else if (typeof item === 'boolean') {
                stats.booleans++;
            } else if (item === null) {
                stats.nulls++;
            }
        });
    }
}