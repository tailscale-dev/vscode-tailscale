import * as vscode from 'vscode';
import { escapeSpace } from './string';

export interface TsUri {
  hostname: string;
  tailnet: string;
  resourcePath: string;
}

/**
 *
 * ts://tails-scales/foo/home/amalie
 * |> tailnet: tails-scales
 * |> hostname: foo
 * |> resourcePath: /home/amalie
 */

export function parseTsUri(uri: vscode.Uri): TsUri {
  switch (uri.scheme) {
    case 'ts': {
      let hostPath = uri.path;
      if (hostPath.startsWith('/')) {
        // Remove leading slash
        hostPath = hostPath.slice(1);
      }

      const segments = hostPath.split('/');
      const [hostname, ...pathSegments] = segments;

      let resourcePath = decodeURIComponent(pathSegments.join('/'));
      if (resourcePath !== '~') {
        resourcePath = `/${escapeSpace(resourcePath)}`;
      }

      return { hostname, tailnet: uri.authority, resourcePath };
    }
    default:
      throw new Error(`Unsupported scheme: ${uri.scheme}`);
  }
}
