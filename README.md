# JSON Schema Store GUI

A powerful VSCode extension that converts JSON Schema into a visual settings editor.

## Features

### 🎯 Core Features
- **Schema Management**: Fetch, cache, and manage JSON schemas from SchemaStore.org
- **Visual Editor**: Dynamically generate form interfaces based on schemas
- **Dual-Pane View**: JSON source code on the left, visual editor on the right
- **Real-time Sync**: Bidirectional synchronization between JSON editor and visual editor
- **Smart Validation**: Real-time validation and error hints based on JSON Schema

### 🌟 Advanced Features
- **Multi-language Support**: Switch between Chinese and English interfaces
- **Theme Adaptation**: Automatically adapts to VSCode light/dark themes
- **Schema Search**: Quickly search and select the desired JSON schema
- **File Association**: Automatically match schemas based on filename
- **Live Preview**: Display validation results and error messages in real-time during editing

### 🎨 UI Features
- **VSCode Native Style**: Uses VSCode Elements component library for a consistent native look
- **Responsive Layout**: Adaptive layout for different screen sizes
- **Adjustable Split**: Drag to resize left and right panels
- **Status Bar Info**: Displays current schema info, validation status, and more

## Installation & Usage

### Installation
1. Search for "JSON Schema Store GUI" in the VSCode Marketplace and install
2. Or download and install the .vsix file manually

### How to Use
1. Open the Command Palette (Ctrl+Shift+P)
2. Type "JSON Schema Store GUI" to select related commands:
   - **Open Settings Editor**: Open the visual JSON settings editor
   - **Search Schema**: Search and select the JSON schema to use
   - **Refresh Schema Cache**: Update local schema cache

### Auto-load Schema
- If the current JSON file contains a `"$schema"` field, clicking **Open Visual Editor** in the top-right corner of the editor (or using the context menu) will automatically fetch that schema and generate the UI.
- Example file: `test-workspace/claude.settings.json` (contains `"$schema": "https://www.schemastore.org/claude-code-settings.json"`).
- The UI top bar provides a settings search box: supports entering keywords (key/title/description), using arrow keys to select results, and pressing Enter to jump to and highlight the corresponding setting.
- Auto-save: Enabled by default (`jsonSchemaStoreGUI.autoSaveOnEdit`), changes are automatically saved to the source file after the debounce time (`jsonSchemaStoreGUI.autoSaveDebounceMs`) expires.

### Keyboard Shortcuts
- `Ctrl/Cmd + S`: Save file
- `Ctrl/Cmd + F`: Format JSON
- `Tab`: Insert indentation
- `Shift + Tab`: Decrease indentation

## Supported Schema Types

This extension supports all JSON schemas provided by SchemaStore.org, including but not limited to:

- **Configuration Files**: package.json, tsconfig.json, webpack.config.js, etc.
- **Build Tools**: gulpfile.js, Gruntfile.js, .babelrc, etc.
- **CI/CD**: .travis.yml, .gitlab-ci.yml, azure-pipelines.yml, etc.
- **Containerization**: Dockerfile, docker-compose.yml, etc.
- **Cloud Services**: aws.json, azure.json, gcloud.json, etc.
- **Development Tools**: .eslintrc, .prettierrc, jest.config.js, etc.

## Project Structure

```
json-schema-store-gui/
├── src/                          # Extension source code
│   ├── extension.ts               # Extension entry point
│   ├── schema/                   # Schema management
│   │   ├── schemaManager.ts       # Schema manager
│   │   └── index.ts
│   ├── ui/                       # User interface
│   │   ├── webviewProvider.ts     # Webview provider
│   │   ├── schemaExplorerProvider.ts # Schema explorer
│   │   └── index.ts
│   └── utils/                    # Utility functions
│       ├── jsonUtils.ts           # JSON processing utilities
│       └── index.ts
├── webview/                      # Webview frontend code
│   ├── main.ts                   # Frontend main entry
│   ├── styles.css                # Styles
│   ├── components/               # UI components
│   │   ├── formGenerator.js     # Form generator
│   │   ├── jsonEditor.js        # JSON editor
│   │   ├── schemaDialog.js      # Schema selection dialog
│   │   └── statusBar.js        # Status bar component
│   └── utils/                   # Frontend utilities
│       └── jsonUtils.js         # JSON utility functions
├── package.json                 # Project configuration
├── tsconfig.json               # TypeScript configuration
├── webpack.config.js           # Webpack configuration
└── README.md                  # Project documentation
```

## Development Guide

### Requirements
- Node.js 16+
- VSCode 1.85.0+
- TypeScript 5.0+

### Development Setup
1. Clone the project
2. Install dependencies: `npm install`
3. Compile TypeScript: `npm run compile`
4. Start debugging: Press F5 or click Run & Debug

### Build & Release
1. Compile: `npm run compile`
2. Package: `vsce package`
3. Publish: `vsce publish`

## Tech Stack

### Backend (Extension Host)
- **TypeScript**: Primary development language
- **VSCode Extension API**: Extension core APIs
- **AJV**: JSON Schema validation
- **Node.js HTTP/HTTPS**: Network requests

### Frontend (Webview)
- **TypeScript**: Frontend logic
- **VSCode Elements**: Native UI component library
- **Web Components**: Component-based development
- **CSS3**: Modern CSS features

### Build Tools
- **Webpack**: Module bundling
- **ESLint**: Code quality checking
- **TypeScript Compiler**: TypeScript compilation

## Contributing

Issues and Pull Requests are welcome!

### Submitting Issues
- Use a clear title and description
- Provide reproduction steps
- Include relevant environment information

### Submitting PRs
- Fork the project to your personal repository
- Create a feature branch
- Follow code conventions
- Add necessary tests
- Submit a Pull Request

## License

MIT License - See [LICENSE](LICENSE) file for details

## Changelog

### v0.1.0 (2024-01-11)
- ✨ Initial release
- 🎯 Basic features implemented
- 🎨 VSCode native UI style
- 📱 Responsive layout support
- 🌍 Chinese and English interface support

## Contact

- Project Home: [GitHub Repository](https://github.com/your-username/json-schema-store-gui)
- Bug Reports: [Issues](https://github.com/your-username/json-schema-store-gui/issues)
- Feature Requests: [Discussions](https://github.com/your-username/json-schema-store-gui/discussions)

---

Thanks for using JSON Schema Store GUI! If you find it useful, please give it a ⭐️!
