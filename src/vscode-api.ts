import { WebviewApi } from 'vscode-webview';
import type { Message } from './types';

class VSCodeWrapper {
  readonly vscodeApi: WebviewApi<string> = acquireVsCodeApi();

  public postMessage(message: Message): void {
    this.vscodeApi.postMessage(message);
  }

  public writeToClipboard(text: string): void {
    this.postMessage({
      type: 'writeToClipboard',
      params: {
        text,
      },
    });
  }

  public openLink(url: string): void {
    this.postMessage({
      type: 'openLink',
      params: {
        url,
      },
    });
  }
}

// Singleton to prevent multiple fetches of VsCodeAPI.
export const vsCodeAPI: VSCodeWrapper = new VSCodeWrapper();
