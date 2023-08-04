import * as path from 'path';
import * as vscode from 'vscode';

import { ServePanelProvider } from './serve-panel-provider';
import { ADMIN_CONSOLE } from './utils/url';
import { Tailscale } from './tailscale';
import { Logger } from './logger';
import { errorForType } from './tailscale/error';
import {
  FileExplorer,
  NodeExplorerProvider,
  PeerRoot,
  PeerErrorItem,
} from './node-explorer-provider';

import { FileSystemProviderSFTP } from './filesystem-provider-sftp';
import { ConfigManager } from './config-manager';
import { parseTsUri } from './utils/uri';
import { WithFSTiming } from './filesystem-provider-timing';
import { FileSystemProvider } from './filesystem-provider';

let tailscaleInstance: Tailscale;

export async function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand('setContext', 'tailscale.env', process.env.NODE_ENV);

  tailscaleInstance = await Tailscale.withInit(vscode);

  const configManager = ConfigManager.withGlobalStorageUri(context.globalStorageUri);

  // walkthrough completion
  tailscaleInstance.serveStatus().then((status) => {
    // assume if we have any BackendState we are installed
    const isInstalled = status.BackendState !== '';
    vscode.commands.executeCommand('setContext', 'tailscale.walkthroughs.installed', isInstalled);

    // Funnel check
    const isFunnelOn = !status?.Errors?.some((e) => e.Type === 'FUNNEL_OFF');
    Logger.info(`Funnel is ${isFunnelOn ? 'on' : 'off'}`, 'serve-status');
    vscode.commands.executeCommand('setContext', 'tailscale.walkthroughs.funnelOn', isFunnelOn);

    // HTTPS check
    const isHTTPSOn = !status?.Errors?.some((e) => e.Type === 'HTTPS_OFF');
    Logger.info(`HTTPS is ${isFunnelOn && isHTTPSOn ? 'on' : 'off'}`, 'serve-status');
    vscode.commands.executeCommand(
      'setContext',
      'tailscale.walkthroughs.httpsOn',
      isFunnelOn && isHTTPSOn
    );

    if (status?.ServeConfig && Object.keys(status.ServeConfig).length === 0) {
      vscode.commands.executeCommand('setContext', 'tailscale.walkthroughs.sharedPort', true);
    }
  });

  const servePanelProvider = new ServePanelProvider(
    process.env.NODE_ENV === 'development'
      ? vscode.Uri.parse('http://127.0.0.1:8000')
      : vscode.Uri.joinPath(context.extensionUri, 'dist'),
    tailscaleInstance
  );

  let fileSystemProvider: FileSystemProvider = new FileSystemProviderSFTP(configManager);
  fileSystemProvider = new WithFSTiming(fileSystemProvider);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ts', fileSystemProvider, {
      isCaseSensitive: true,
    })
  );

  // eslint-disable-next-line prefer-const
  let nodeExplorerView: vscode.TreeView<PeerRoot | FileExplorer | PeerErrorItem>;

  function updateNodeExplorerDisplayName(name: string) {
    nodeExplorerView.title = name;
  }

  const createNodeExplorerView = (): vscode.TreeView<PeerRoot | FileExplorer | PeerErrorItem> => {
    return vscode.window.createTreeView('node-explorer-view', {
      treeDataProvider: nodeExplorerProvider,
      showCollapseAll: true,
      dragAndDropController: nodeExplorerProvider,
    });
  };

  const nodeExplorerProvider = new NodeExplorerProvider(
    tailscaleInstance,
    configManager,
    fileSystemProvider,
    updateNodeExplorerDisplayName,
    context
  );

  nodeExplorerView = createNodeExplorerView();
  vscode.window.registerTreeDataProvider('node-explorer-view', nodeExplorerProvider);
  context.subscriptions.push(nodeExplorerView);

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.refreshServe', () => {
      Logger.info('called tailscale.refreshServe', 'command');
      servePanelProvider.refreshState();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.resetServe', async () => {
      Logger.info('called tailscale.resetServe', 'command');
      await tailscaleInstance.serveDelete();
      servePanelProvider.refreshState();

      vscode.window.showInformationMessage('Serve configuration reset');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.openFunnelPanel', () => {
      vscode.commands.executeCommand('serve-view.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.openAdminConsole', () => {
      vscode.env.openExternal(vscode.Uri.parse(ADMIN_CONSOLE));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.peer.setUsername', async (node: PeerRoot) => {
      const username = await vscode.window.showInputBox({
        prompt: `Enter the username to use for ${node.ServerName}`,
        value: configManager.config?.hosts?.[node.Address]?.user,
      });

      if (!username) {
        return;
      }

      configManager.setForHost(node.Address, 'user', username);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'tailscale.node.setRootDir',
      async (node: PeerRoot | FileExplorer | PeerErrorItem) => {
        let address: string;

        if (node instanceof FileExplorer) {
          address = parseTsUri(node.uri).address;
        } else if (node instanceof PeerRoot) {
          address = node.Address;
        } else {
          throw new Error(`invalid node type: ${typeof node}`);
        }

        const dir = await vscode.window.showInputBox({
          prompt: `Enter the root directory to use for ${address}`,
          value: configManager.config?.hosts?.[address]?.rootDir || '~',
        });

        if (!dir) {
          return;
        }

        if (!path.isAbsolute(dir) && dir !== '~') {
          vscode.window.showErrorMessage(`${dir} is an invalid absolute path`);
          return;
        }

        configManager.setForHost(address, 'rootDir', dir);
        nodeExplorerProvider.refreshAll();
      }
    )
  );

  vscode.window.registerWebviewViewProvider('serve-view', servePanelProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.sharePortOverTunnel', async () => {
      Logger.info('called tailscale.sharePortOverTunnel', 'command');
      const port = await vscode.window.showInputBox({
        prompt: 'Port to share',
        validateInput: (value) => {
          // TODO(all): handle serve already being configured
          if (!value) {
            return 'Please enter a port';
          }

          if (!Number.isInteger(Number(value))) {
            return 'Please enter an integer';
          }

          return null;
        },
      });

      if (!port) {
        return;
      }

      const status = await tailscaleInstance.serveStatus();
      if (status?.Errors?.length) {
        status.Errors.map((err) => {
          const e = errorForType(err.Type);

          vscode.window
            .showErrorMessage(
              `${e.title}. ${e.message}`,
              ...(e.links ? e.links.map((l) => l.title) : [])
            )
            .then((selection) => {
              if (selection) {
                if (!e.links) return;

                const link = e.links.find((l) => l.title === selection);
                if (link) {
                  vscode.env.openExternal(vscode.Uri.parse(link.url));
                }
              }
            });
        });
      } else {
        tailscaleInstance.runFunnel(parseInt(port));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.reloadServePanel', async () => {
      await vscode.commands.executeCommand('workbench.action.closePanel');
      await vscode.commands.executeCommand('serve-view.focus');
      setTimeout(() => {
        vscode.commands.executeCommand('workbench.action.toggleDevTools');
      }, 500);
    })
  );
}

export function deactivate() {
  if (tailscaleInstance) {
    tailscaleInstance.dispose();
  }
}
