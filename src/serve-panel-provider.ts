import * as vscode from 'vscode';
import { getNonce } from './get-nonce';
import type { Tailscale } from './tailscale';
import type { Message, WebviewData } from './types';
import { Logger } from './logger';

export class ServePanelProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri, private readonly ts: Tailscale) {}

  postMessage(message: WebviewData) {
    if (!this._view) {
      Logger.warn('No view to update');
      return;
    }

    this._view.webview.postMessage(message);
  }

  public async refreshState() {
    this.postMessage({
      type: 'refreshState',
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (m: Message) => {
      switch (m.type) {
        case 'refreshState': {
          Logger.info('Called refreshState', 'serve-panel');
          await this.refreshState();
          break;
        }

        case 'deleteServe': {
          Logger.info('Called deleteServe', 'serve-panel');
          try {
            await this.ts.serveDelete(m.params);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            vscode.window.showErrorMessage('Unable to delete serve', e.message);
          }

          await this.refreshState();
          break;
        }

        case 'addServe': {
          Logger.info('Called addServe', 'serve-panel');
          await this.ts.serveAdd(m.params);
          await this.refreshState();
          break;
        }

        case 'setFunnel': {
          Logger.info('Called setFunnel', 'serve-panel');
          try {
            await this.ts.setFunnel(parseInt(m.params.port), m.params.allow);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            vscode.window.showErrorMessage('Unable to toggle funnel', e.message);
          }

          await this.refreshState();
          break;
        }

        case 'resetServe': {
          Logger.info('Called resetServe', 'serve-panel');
          try {
            await this.ts.serveDelete();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            vscode.window.showErrorMessage('Unable to delete serve', e.message);
          }

          await this.refreshState();
          break;
        }

        case 'writeToClipboard': {
          Logger.info('Called writeToClipboard', 'serve-panel');
          vscode.env.clipboard.writeText(m.params.text);
          vscode.window.showInformationMessage('Copied to clipboard');
          break;
        }

        case 'openLink': {
          Logger.info(`Called openLink: ${m.params.url}`, 'serve-panel');
          vscode.env.openExternal(vscode.Uri.parse(m.params.url));
          break;
        }

        case 'sudoPrompt': {
          Logger.info('running tsrelay in sudo');
          await this.ts.initSudo(m.params);
          break;
        }

        default: {
          console.log('Unknown type for message', m);
        }
      }
    });
  }

  public revive(panel: vscode.WebviewView) {
    this._view = panel;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'serve-panel.js')
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'serve-panel.css')
    );

    const nonce = getNonce();

    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link rel="stylesheet" nonce="${nonce}" src="${scriptUri}">
          <script type="text/javascript">
            window.tailscale = {
              url: '${this.ts.url}',
              authkey: '${this.ts.authkey}',
              platform: '${process.platform}',
            };
          </script>
        <body>
          <div id="root"></div>
          
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }
}
