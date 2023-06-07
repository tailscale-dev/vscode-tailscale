import * as vscode from 'vscode';

import { ServePanelProvider } from './serve-panel-provider';
import { getTailscaleCommandPath } from './tailscale';
import { downloadLinkForPlatform, ADMIN_CONSOLE } from './utils/url';
import { Tailscale } from './tailscale';
import { fileExists } from './utils';
import { EXTENSION_ID } from './constants';
import { Logger } from './logger';
import { errorForType } from './tailscale/error';

let tailscaleInstance: Tailscale;

export async function activate(context: vscode.ExtensionContext) {
  const commandPath = await getTailscaleCommandPath();

  Logger.info(`CLI path: ${commandPath}`);
  vscode.commands.executeCommand('setContext', 'tailscale.env', process.env.NODE_ENV);

  if (commandPath && !(await fileExists(commandPath))) {
    vscode.window
      .showErrorMessage(
        `Tailscale CLI not found at ${commandPath}. Set tailscale.path`,
        'Open Settings'
      )
      .then(() => {
        vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${EXTENSION_ID}`);
      });
  }

  if (!commandPath) {
    vscode.window
      .showErrorMessage(
        'Tailscale CLI not found. Install Tailscale or set tailscale.path',
        'Install Tailscale',
        'Open Settings'
      )
      .then((selection) => {
        if (selection === 'Install Tailscale') {
          vscode.env.openExternal(vscode.Uri.parse(downloadLinkForPlatform(process.platform)));
        } else if (selection === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${EXTENSION_ID}`);
        }
      });
  }

  tailscaleInstance = await Tailscale.withInit(vscode);

  // walkthrough completion
  tailscaleInstance.serveStatus().then((status) => {
    // assume if we have any BackendState we are installed
    vscode.commands.executeCommand('setContext', 'tailscale.walkthroughs.installed', !!commandPath);

    if (status?.FunnelOff === false) {
      vscode.commands.executeCommand('setContext', 'tailscale.walkthroughs.funnelOn', true);
    }

    // we only get an NeedsHTTPs value if Funnel is enabled
    if (status?.FunnelOff === false && status?.NeedsHTTPs === false) {
      vscode.commands.executeCommand('setContext', 'tailscale.walkthroughs.httpsOn', true);
    }

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
