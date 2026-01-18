import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as zlib from 'zlib';

export interface SchemaInfo {
    name: string;
    description?: string;
    url: string;
    fileMatch?: string[];
    versions?: Record<string, string>;
}

export interface SchemaCatalog {
    $schema: string;
    version: number;
    schemas: SchemaInfo[];
}

export class SchemaManager {
    private readonly _catalogUrl = 'https://www.schemastore.org/api/json/catalog.json';
    private readonly _cacheFileName = 'schema-catalog.json';
    private readonly _cacheDirName = 'schema-cache';
    private _catalog: SchemaCatalog | null = null;
    private _schemaCache = new Map<string, any>();

    constructor(private readonly _context: vscode.ExtensionContext) {}

    public async needsInitialization(): Promise<boolean> {
        const cachePath = this._getCachePath();
        try {
            const stats = await fs.promises.stat(cachePath);
            // 缓存超过24小时则需要重新初始化
            const now = Date.now();
            const cacheAge = now - stats.mtime.getTime();
            return cacheAge > 24 * 60 * 60 * 1000;
        } catch {
            return true;
        }
    }

    public async initializeCache(): Promise<void> {
        try {
            await this._downloadCatalog();
            await this._saveCatalog();
        } catch (error) {
            throw new Error(`Failed to initialize schema cache: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async refreshCache(): Promise<void> {
        try {
            await this._downloadCatalog();
            await this._saveCatalog();
            this._schemaCache.clear();
        } catch (error) {
            throw new Error(`Failed to refresh schema cache: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async getAllSchemas(): Promise<SchemaInfo[]> {
        if (!this._catalog) {
            await this._loadCatalog();
        }
        return this._catalog?.schemas || [];
    }

    public async searchSchemas(query: string): Promise<SchemaInfo[]> {
        const allSchemas = await this.getAllSchemas();
        if (!query.trim()) {
            return allSchemas;
        }

        const lowerQuery = query.toLowerCase();
        return allSchemas.filter(schema => 
            schema.name.toLowerCase().includes(lowerQuery) ||
            (schema.description && schema.description.toLowerCase().includes(lowerQuery)) ||
            (schema.fileMatch && schema.fileMatch.some(match => match.toLowerCase().includes(lowerQuery)))
        );
    }

    public async getSchema(url: string, baseFilePath?: string): Promise<any> {
        // 检查内存缓存
        const cacheKey = `${url}-${baseFilePath || ''}`;
        if (this._schemaCache.has(cacheKey)) {
            return this._schemaCache.get(cacheKey);
        }

        try {
            let schema: any;
            const normalizedUrl = this._normalizeSchemaUrl(url);

            // 内置 schema（避免关键 meta-schema 拉取失败导致编辑器不可用）
            schema = await this._tryGetBuiltinSchema(normalizedUrl);

            // 尝试从本地文件加载
            if (!schema && this._isLocalPath(url)) {
                const filePath = this._resolveLocalPath(url, baseFilePath);
                if (fs.existsSync(filePath)) {
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    schema = JSON.parse(content);
                }
            }

            // 如果本地没有，从网络获取
            if (!schema) {
                schema = await this._downloadSchema(normalizedUrl);
            }

            // 缓存到内存
            this._schemaCache.set(cacheKey, schema);
            return schema;
        } catch (error) {
            throw new Error(`Failed to get schema: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _loadCatalog(): Promise<void> {
        try {
            const cachePath = this._getCachePath();
            if (fs.existsSync(cachePath)) {
                const content = await fs.promises.readFile(cachePath, 'utf8');
                this._catalog = JSON.parse(content);
            } else {
                await this._downloadCatalog();
            }
        } catch (error) {
            console.error('Failed to load schema catalog:', error);
            throw error;
        }
    }

    private async _downloadCatalog(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL(this._catalogUrl);
            const client = url.protocol === 'https:' ? https : http;

            const req = client.get(this._catalogUrl, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        this._catalog = JSON.parse(data);
                        resolve();
                    } catch (error) {
                        reject(new Error(`Failed to parse catalog: ${error}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Failed to download catalog: ${error}`));
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Download timed out'));
            });
        });
    }

    private async _downloadSchema(url: string): Promise<any> {
        const fetchOnce = (targetUrl: string, redirectsLeft: number): Promise<any> => {
            return new Promise((resolve, reject) => {
                let urlObj: URL;
                try {
                    urlObj = new URL(targetUrl);
                } catch (error) {
                    reject(new Error(`Invalid schema URL: ${targetUrl} (${error instanceof Error ? error.message : String(error)})`));
                    return;
                }

                const client = urlObj.protocol === 'https:' ? https : http;
                const req = client.get(
                    targetUrl,
                    {
                        headers: {
                            'User-Agent': 'general-settings-ui',
                            'Accept': 'application/schema+json, application/json;q=0.9, */*;q=0.8',
                            'Accept-Encoding': 'br, gzip, deflate'
                        }
                    },
                    (res) => {
                        const status = res.statusCode || 0;
                        const location = res.headers.location;

                        // follow redirects
                        if ([301, 302, 303, 307, 308].includes(status) && location) {
                            if (redirectsLeft <= 0) {
                                reject(new Error(`Too many redirects: ${targetUrl}`));
                                return;
                            }
                            const nextUrl = new URL(location, urlObj).toString();
                            res.resume();
                            resolve(fetchOnce(nextUrl, redirectsLeft - 1));
                            return;
                        }

                        if (status < 200 || status >= 300) {
                            let preview = '';
                            res.setEncoding('utf8');
                            res.on('data', (chunk) => {
                                if (preview.length < 2000) {
                                    preview += String(chunk);
                                }
                            });
                            res.on('end', () => {
                                reject(new Error(`Failed to download schema: HTTP ${status} ${preview ? `| ${preview.slice(0, 200).trim()}` : ''}`.trim()));
                            });
                            return;
                        }

                        const chunks: Buffer[] = [];
                        res.on('data', (chunk) => {
                            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                        });

                        res.on('end', () => {
                            try {
	                                const buf = Buffer.concat(chunks);
	                                const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
	                                const decoded = (() => {
	                                    if (!enc) {
	                                        return buf;
	                                    }
	                                    if (enc === 'gzip') {
	                                        return zlib.gunzipSync(buf);
	                                    }
	                                    if (enc === 'deflate') {
	                                        return zlib.inflateSync(buf);
	                                    }
	                                    if (enc === 'br') {
	                                        return zlib.brotliDecompressSync(buf);
	                                    }
	                                    return buf;
	                                })();
                                const text = decoded.toString('utf8');
                                const schema = JSON.parse(text);
                                resolve(schema);
                            } catch (error) {
                                reject(new Error(`Failed to parse schema: ${error instanceof Error ? error.message : String(error)}`));
                            }
                        });
                    }
                );

                req.on('error', (error) => {
                    reject(new Error(`Failed to download schema: ${error}`));
                });

                req.setTimeout(15000, () => {
                    req.destroy();
                    reject(new Error('Download timed out'));
                });
            });
        };

        return fetchOnce(url, 5);
    }

    private _normalizeSchemaUrl(url: string): string {
        // 1) json-schema.org 旧的 http 链接统一升级到 https（更稳定，且部分环境会拦截明文 http）
        if (url.startsWith('http://json-schema.org/')) {
            return `https://json-schema.org/${url.slice('http://json-schema.org/'.length)}`;
        }
        return url;
    }

    private async _tryGetBuiltinSchema(url: string): Promise<any | null> {
        const normalized = url.replace(/#$/, '');
        const builtins: Record<string, string> = {
            'https://json-schema.org/draft-07/schema': path.join(
                this._context.extensionPath,
                'assets',
                'schemas',
                'json-schema-draft-07.json'
            )
        };

        const filePath = builtins[normalized];
        if (!filePath) {
            return null;
        }

        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.warn('Failed to read built-in schema:', { url: normalized, filePath, error });
            return null;
        }
    }

    private async _saveCatalog(): Promise<void> {
        if (!this._catalog) {
            return;
        }

        try {
            const cacheDir = this._getCacheDir();
            await fs.promises.mkdir(cacheDir, { recursive: true });
            
            const cachePath = this._getCachePath();
            const content = JSON.stringify(this._catalog, null, 2);
            await fs.promises.writeFile(cachePath, content, 'utf8');
        } catch (error) {
            console.error('Failed to save catalog:', error);
        }
    }

    private _getCacheDir(): string {
        return path.join(this._context.globalStorageUri.fsPath, this._cacheDirName);
    }

    private _getCachePath(): string {
        return path.join(this._getCacheDir(), this._cacheFileName);
    }

    private _getLocalSchemaPath(url: string): string {
        // 将URL转换为本地文件路径
        const filename = url.replace(/[^a-zA-Z0-9.-]/g, '_');
        return path.join(this._getCacheDir(), filename);
    }

    private _isLocalPath(url: string): boolean {
        // 判断是否为本地路径（绝对路径或相对路径）
        return (
            url.startsWith('./') ||
            url.startsWith('../') ||
            url.startsWith('/') ||
            /^[A-Za-z]:\\/.test(url) ||
            /^[A-Za-z]:\//.test(url) ||
            !url.startsWith('http://') && !url.startsWith('https://')
        );
    }

    private _resolveLocalPath(url: string, baseFilePath?: string): string {
        // 如果是绝对路径
        if (path.isAbsolute(url)) {
            return url;
        }

        // 如果有baseFilePath（当前JSON文件的路径），相对于它解析
        if (baseFilePath) {
            const baseDir = path.dirname(baseFilePath);
            return path.resolve(baseDir, url);
        }

        // 如果没有baseFilePath，使用工作区根目录
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            return path.resolve(workspaceRoot, url);
        }

        // 最后尝试直接解析
        return path.resolve(url);
    }

    public async getSchemaForFile(fileName: string): Promise<SchemaInfo | null> {
        const allSchemas = await this.getAllSchemas();
        
        return allSchemas.find(schema => 
            schema.fileMatch && schema.fileMatch.some(pattern => 
                this._matchPattern(fileName, pattern)
            )
        ) || null;
    }

    private _matchPattern(fileName: string, pattern: string): boolean {
        // 简单的文件名匹配，支持通配符
        if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(fileName);
        }
        
        return fileName === pattern || fileName.endsWith(pattern);
    }

    public async validateJson(json: string, schemaUrl?: string): Promise<{ valid: boolean; errors?: string[] }> {
        try {
            const data = JSON.parse(json);
            
            if (!schemaUrl) {
                return { valid: true };
            }

            const schema = await this.getSchema(schemaUrl);
            const Ajv = require('ajv');
            const ajv = new Ajv();
            
            const validate = ajv.compile(schema);
            const valid = validate(data);
            
            return {
                valid,
                errors: valid ? undefined : this._formatAjvErrors(validate.errors)
            };
        } catch (error) {
            return {
                valid: false,
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
    }

    private _formatAjvErrors(errors: any[]): string[] {
        if (!errors) {
            return [];
        }
        
        return errors.map(error => {
            const path = error.instancePath || error.dataPath || '';
            const message = error.message || 'Validation failed';
            return path ? `${path}: ${message}` : message;
        });
    }
}
