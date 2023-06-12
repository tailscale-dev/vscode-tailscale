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

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (m: Message) => {
      const { type } = m;
      Logger.info(`called ${type}`, 'serve-panel');

      let response;

      switch (type) {
        case 'relayRequest': {
          const { id, endpoint, method } = m;
          Logger.info(`${id}, ${endpoint}, ${method}`, 'serve-panel');
          try {
            response = await this.ts.performFetch(endpoint, method, m.data);
            Logger.info(`response: ${JSON.stringify(response)}`, 'serve-panel');
            this.postMessage({
              id,
              endpoint,
              method,
              type: 'relayResponse',
              data: response,
            });
          } catch (e) {
            vscode.window.showErrorMessage(`${e}`);
          }

          break;
        }

        case 'writeToClipboard': {
          vscode.env.clipboard.writeText(m.data.text);
          vscode.window.showInformationMessage('Copied to clipboard');
          break;
        }

        case 'openLink': {
          vscode.env.openExternal(vscode.Uri.parse(m.data.url));
          break;
        }

        case 'sudoPrompt': {
          Logger.info('running tsrelay in sudo');
          try {
            await this.ts.initSudo();
            Logger.info(`re-applying ${m.operation}`);
            if (m.operation == 'add') {
              if (!m.params) {
                Logger.error('params cannot be null for an add operation');
                return;
              }
              await this.ts.serveAdd(m.params);
            } else if (m.operation == 'delete') {
              await this.ts.serveDelete();
            }
          } catch (e) {
            Logger.error(`error running sudo prompt: ${e}`);
          }
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
