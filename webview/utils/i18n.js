export class I18n {
    private static instance: I18n;
    private translations: any = {};
    private currentLanguage: string = 'en-us';

    private constructor() {
        this.init();
    }

    public static getInstance(): I18n {
        if (!I18n.instance) {
            I18n.instance = new I18n();
        }
        return I18n.instance;
    }

    private async init() {
        const config = (window as any).vscode;
        if (config) {
            config.postMessage({ command: 'getLanguage' });
        }
        await this.loadLanguage(this.currentLanguage);
    }

    public async setLanguage(language: string) {
        this.currentLanguage = language;
        await this.loadLanguage(language);
        this.updateUI();
    }

    private async loadLanguage(language: string) {
        try {
            const response = await fetch(`/i18n/${language}.json`);
            if (response.ok) {
                this.translations = await response.json();
            } else {
                console.error(`Failed to load language file: ${language}`);
            }
        } catch (error) {
            console.error('Failed to load language file:', error);
        }
    }

    public t(key: string, params?: Record<string, string>): string {
        const keys = key.split('.');
        let value = this.translations;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return key;
            }
        }

        if (typeof value !== 'string') {
            return key;
        }

        if (params) {
            return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
                return params[paramKey] || match;
            });
        }

        return value;
    }

    public updateUI() {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (key) {
                const translation = this.t(key);
                element.textContent = translation;
            }
        });

        const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
        placeholders.forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            if (key) {
                const translation = this.t(key);
                (element as HTMLInputElement | HTMLTextAreaElement).placeholder = translation;
            }
        });

        const titles = document.querySelectorAll('[data-i18n-title]');
        titles.forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            if (key) {
                const translation = this.t(key);
                element.setAttribute('title', translation);
            }
        });
    }

    public getCurrentLanguage(): string {
        return this.currentLanguage;
    }
}

export const i18n = I18n.getInstance();
