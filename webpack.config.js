const path = require('path');

const extensionConfig = {
  mode: 'development',
  target: 'node',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'out'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: 'ts-loader'
      }
    ]
  },
  node: {
    __dirname: false,
    __filename: false
  }
};

const webviewConfig = {
  mode: 'development',
  target: 'web',
  entry: './webview/main.ts',
  output: {
    path: path.resolve(__dirname, 'out/webview'),
    filename: 'main.js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: 'tsconfig.webview.json'
          }
        }
      }
    ]
  }
};

module.exports = [extensionConfig, webviewConfig];