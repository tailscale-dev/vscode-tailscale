import * as path from 'path';
import * as vscode from 'vscode';

import { ServePanelProvider } from './serve-panel-provider';
import { ADMIN_CONSOLE } from './utils/url';
import { Tailscale } from './tailscale';
import { Logger } from './logger';
import { errorForType } from './tailscale/error';
import { FileExplorer, NodeExplorerProvider, PeerTree } from './node-explorer-provider';

import { SFTPFileSystemProvider } from './sftp-file-system-provider';
import { ConfigManager } from './config-manager';
import { parseTsUri } from './utils/uri';
import { EXTENSION_NS } from './constants';
import { SSHFileSystemProvider } from './ssh-file-system-provider';

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

  const connMethod = vscode.workspace
    .getConfiguration(EXTENSION_NS)
    .get('nodeExplorer.connectionMethod');

  const FileSystemProvider = connMethod === 'ssh' ? SSHFileSystemProvider : SFTPFileSystemProvider;
  const fileSystemProvider = new FileSystemProvider(configManager);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ts', fileSystemProvider, {
      isCaseSensitive: true,
    })
  );

  // eslint-disable-next-line prefer-const
  let nodeExplorerView: vscode.TreeView<PeerTree | FileExplorer>;

  function updateNodeExplorerTailnetName(name: string) {
    nodeExplorerView.title = name;
  }

  const createNodeExplorerView = (): vscode.TreeView<PeerTree | FileExplorer> => {
    return vscode.window.createTreeView('tailscale-node-explorer-view', {
      treeDataProvider: nodeExplorerProvider,
      showCollapseAll: true,
      dragAndDropController: nodeExplorerProvider,
    });
  };

  const nodeExplorerProvider = new NodeExplorerProvider(
    tailscaleInstance,
    configManager,
    fileSystemProvider,
    updateNodeExplorerTailnetName
  );

  nodeExplorerView = createNodeExplorerView();
  vscode.window.registerTreeDataProvider('tailscale-node-explorer-view', nodeExplorerProvider);
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
      vscode.commands.executeCommand('tailscale-serve-view.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.openAdminConsole', () => {
      vscode.env.openExternal(vscode.Uri.parse(ADMIN_CONSOLE));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tailscale.node.setUsername', async (node: PeerTree) => {
      const username = await vscode.window.showInputBox({
        prompt: `Enter the username to use for ${node.HostName}`,
        value: configManager.config?.hosts?.[node.HostName]?.user,
      });

      if (!username) {
        return;
      }

      configManager.setForHost(node.HostName, 'user', username);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'tailscale.node.setRootDir',
      async (node: PeerTree | FileExplorer) => {
        let hostname: string;

        if (node instanceof FileExplorer) {
          hostname = parseTsUri(node.uri).hostname;
        } else if (node instanceof PeerTree) {
          hostname = node.HostName;
        } else {
          throw new Error(`invalid node type: ${typeof node}`);
        }

        const dir = await vscode.window.showInputBox({
          prompt: `Enter the root directory to use for ${hostname}`,
          value: configManager.config?.hosts?.[hostname]?.rootDir || '~',
        });

        if (!dir) {
          return;
        }

        if (!path.isAbsolute(dir) && dir !== '~') {
          vscode.window.showErrorMessage(`${dir} is an invalid absolute path`);
          return;
        }

        configManager.setForHost(hostname, 'rootDir', dir);
        nodeExplorerProvider.refreshAll();
      }
    )
  );

  vscode.window.registerWebviewViewProvider('tailscale-serve-view', servePanelProvider);

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
      await vscode.commands.executeCommand('tailscale-serve-view.focus');
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
