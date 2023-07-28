import * as path from 'path';
import * as vscode from 'vscode';

import { ServePanelProvider } from './serve-panel-provider';
import { ADMIN_CONSOLE } from './utils/url';
import { Tailscale } from './tailscale';
import { Logger } from './logger';
import { errorForType } from './tailscale/error';
import { NodeExplorerProvider, PeerTree } from './node-explorer-provider';

import { TSFileSystemProvider } from './ts-file-system-provider';
import { ConfigManager } from './config-manager';
import { SSH } from './utils/ssh';

let tailscaleInstance: Tailscale;

export async function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand('setContext', 'tailscale.env', process.env.NODE_ENV);

  tailscaleInstance = await Tailscale.withInit(vscode);

  const configManager = ConfigManager.withGlobalStorageUri(context.globalStorageUri);
  const ssh = new SSH(configManager);

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

  const tsFileSystemProvider = new TSFileSystemProvider(configManager);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ts', tsFileSystemProvider, {
      isCaseSensitive: true,
    })
  );

  const nodeExplorerProvider = new NodeExplorerProvider(tailscaleInstance, configManager, ssh);
  vscode.window.registerTreeDataProvider('tailscale-node-explorer-view', nodeExplorerProvider);
  const view = vscode.window.createTreeView('tailscale-node-explorer-view', {
    treeDataProvider: nodeExplorerProvider,
    showCollapseAll: true,
    dragAndDropController: nodeExplorerProvider,
  });
  context.subscriptions.push(view);

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
    vscode.commands.registerCommand('tailscale.node.setRootDir', async (node: PeerTree) => {
      const dir = await vscode.window.showInputBox({
        prompt: `Enter the root directory to use for ${node.HostName}`,
        value: configManager.config?.hosts?.[node.HostName]?.rootDir || '~',
      });

      if (!dir) {
        return;
      }

      if (!path.isAbsolute(dir) && dir !== '~') {
        vscode.window.showErrorMessage(`${dir} is an invalid absolute path`);
        return;
      }

      configManager.setForHost(node.HostName, 'rootDir', dir);
      // TODO: trigger refresh to fsFileSystemProvider
    })
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
