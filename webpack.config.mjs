import path from 'path';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseConfig = {
  mode: process.env.NODE_ENV || 'development',
  resolve: {
    mainFields: ['browser', 'module', 'main'],
    extensions: ['.tsx', '.ts', '.js'],
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log', // enables logging required for VS Code problem matcher
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
            },
          },
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.node$/,
        loader: 'node-loader',
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
    ],
  },
};

export default () => {
  return [
    {
      // server-side
      ...baseConfig,
      entry: './src/extension.ts',
      target: 'node',
      mode: 'none',
      output: {
        filename: 'extension.js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../[resource-path]',
      },
    },
    {
      // client-side
      ...baseConfig,
      entry: './src/webviews/serve-panel/index.tsx',
      target: 'web',
      output: {
        filename: 'serve-panel.js',
        path: path.resolve(__dirname, 'dist'),
      },
      devServer: {
        port: 8000,
        allowedHosts: 'all',
        devMiddleware: {
          writeToDisk: true,
        },
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        },
        hot: true,
      },
      optimization: {
        splitChunks: {
          cacheGroups: {
            default: false,
          },
        },
      },
    },
  ];
};
