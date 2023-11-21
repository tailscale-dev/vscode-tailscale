import { Uri } from 'vscode';

export interface TsUri {
  address: string;
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

export function parseTsUri(uri: Uri): TsUri {
  switch (uri.scheme) {
    case 'ts': {
      let hostPath = uri.path;
      if (hostPath.startsWith('/')) {
        // Remove leading slash
        hostPath = hostPath.slice(1);
      }

      const segments = hostPath.split('/');
      const [address, ...pathSegments] = segments;

      if (pathSegments[0] === '~') {
        pathSegments[0] = '.';
      }

      let resourcePath = decodeURIComponent(pathSegments.join('/'));

      if (!resourcePath.startsWith('.')) {
        resourcePath = `/${resourcePath}`;
      }

      return { address, tailnet: uri.authority, resourcePath };
    }
    default:
      throw new Error(`Unsupported scheme: ${uri.scheme}`);
  }
}

interface TsUriParams {
  tailnet: string;
  address: string;
  resourcePath: string;
}

export function createTsUri({ tailnet, address, resourcePath }: TsUriParams): Uri {
  return Uri.joinPath(
    Uri.from({ scheme: 'ts', authority: tailnet, path: '/' }),
    address,
    ...resourcePath.split('/')
  );
}
