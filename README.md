# JSON Schema Store GUI

A powerful VSCode extension that converts JSON Schema into a visual settings editor.

![demo](https://i.imgur.com/xjTR6l8.gif)

**Download from the following marketplaces:**

- [![VSCode Marketplace](https://img.shields.io/visual-studio-marketplace/v/techfetch-dev.general-settings-ui?style=flat-square&label=VSCode%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=techfetch-dev.general-settings-ui)
- [![OpenVSX](https://img.shields.io/badge/OpenVSX-download-42b883?style=flat-square&logo=eclipseide)](https://open-vsx.org/extension/techfetch-dev/general-settings-ui)

## Features

### 🎯 Core Features
- **Schema Management**: Fetch, cache, and manage JSON schemas from SchemaStore.org
- **Visual Editor**: Dynamically generate a visual form based on the selected schema
- **Two-way Sync**: Synchronize between the source JSON file and the visual editor (webview)
- **Validation Hints**: Show input validation feedback based on JSON Schema (e.g. `pattern`, ranges, map key checks)

### 🌟 Advanced Features
- **Theme Adaptation**: Automatically adapts to VSCode light/dark themes
- **Schema Explorer**: Browse & search schemas (Explorer view)
- **Quick Pick Search**: Search and select a schema via Command Palette
- **Auto-save**: Persist changes back to the source file (configurable)

### 🎨 UI Features
- **VSCode Native Look**: Uses VS Code theme variables for a consistent look
- **Settings Search**: Search by key/title/description and jump to the matched setting
- **Status Bar Entry**: Shows "Open Visual Editor" when the active JSON file has `"$schema"`

## Installation & Usage

### Installation
1. **[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=techfetch-dev.general-settings-ui)**: Search for "JSON Schema Store GUI" and install
2. **[OpenVSX](https://open-vsx.org/extension/techfetch-dev/general-settings-ui)**: Alternative marketplace for VSCode extensions
3. Or download and install the .vsix file manually

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
- `Ctrl/Cmd + F`: Focus the settings search box (in the visual editor)
- `↑/↓`: Navigate search results
- `Enter`: Jump to the selected setting
- `Esc`: Close the results popup (or clear the query if already closed)


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
2. Package: `npm run package`
3. Publish to both marketplaces: `npm run publish`
4. Publish to VS Code Marketplace only: `npm run publish:vscode`
5. Publish to Open VSX only: `npm run publish:openvsx`

Before publishing, set tokens in your environment:
- `VSCE_PAT` for VS Code Marketplace
- `OVSX_PAT` for Open VSX

## Tech Stack

### Backend (Extension Host)
- **TypeScript**: Primary development language
- **VSCode Extension API**: Extension core APIs
- **AJV**: JSON Schema validation
- **Node.js HTTP/HTTPS**: Network requests

### Frontend (Webview)
- **TypeScript**: Frontend logic
- **DOM + Template HTML**: Render settings form and handle interactions
- **CSS**: Uses VS Code theme variables for consistent styling

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

- Project Home: [GitHub Repository](https://github.com/jqknono/general-settings-ui)
- Bug Reports: [Issues](https://github.com/jqknono/general-settings-ui/issues)
- Feature Requests: [Discussions](https://github.com/jqknono/general-settings-ui/discussions)

---

Thanks for using JSON Schema Store GUI! If you find it useful, please give it a ⭐️!
