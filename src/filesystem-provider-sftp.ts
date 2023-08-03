import * as vscode from 'vscode';
import { Logger } from './logger';
import { ConfigManager } from './config-manager';
import { parseTsUri } from './utils/uri';
import { SshConnectionManager } from './ssh-connection-manager';
import { fileSorter } from './filesystem-provider';
import { getErrorMessage } from './utils/error';

export class FileSystemProviderSFTP implements vscode.FileSystemProvider {
  public manager: SshConnectionManager;

  constructor(configManager: ConfigManager) {
    this.manager = new SshConnectionManager(configManager);
  }

  // Implementation of the `onDidChangeFile` event
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >().event;

  watch(): vscode.Disposable {
    throw new Error('Watch not supported');
  }

  readDirectory = withFileSystemErrorHandling(
    async (uri: vscode.Uri): Promise<[string, vscode.FileType][]> => {
      const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
      const files = await sftp.readDirectory(resourcePath);
      return files.sort(fileSorter);
    }
  );

  stat = withFileSystemErrorHandling(async (uri: vscode.Uri): Promise<vscode.FileStat> => {
    const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
    return await sftp.stat(resourcePath);
  });

  createDirectory = withFileSystemErrorHandling(async (uri: vscode.Uri): Promise<void> => {
    const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
    return await sftp.createDirectory(resourcePath);
  });

  readFile = withFileSystemErrorHandling(async (uri: vscode.Uri): Promise<Uint8Array> => {
    const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
    return await sftp.readFile(resourcePath);
  });

  writeFile = withFileSystemErrorHandling(async (uri: vscode.Uri, content: Uint8Array) => {
    const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
    return await sftp.writeFile(resourcePath, content);
  });

  delete = withFileSystemErrorHandling(async (uri: vscode.Uri): Promise<void> => {
    const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);

    const deleteRecursively = async (path: string) => {
      const files = await sftp.readDirectory(path);

      for (const [file, fileType] of files) {
        const filePath = `${path}/${file}`;

        if (fileType === vscode.FileType.Directory) {
          await deleteRecursively(filePath);
        } else {
          await sftp.delete(filePath);
        }
      }

      await sftp.rmdir(path);
    };

    return await deleteRecursively(resourcePath);
  });

  async rename(): Promise<void> {}

  async getHomeDirectory(hostname: string): Promise<string> {
    const sftp = await this.manager.getSftp(hostname);
    if (!sftp) throw new Error('Failed to establish SFTP connection');

    return await sftp.getHomeDirectory();
  }

  async getParsedUriAndSftp(uri: vscode.Uri) {
    const { hostname, resourcePath } = parseTsUri(uri);
    const sftp = await this.manager.getSftp(hostname);

    if (!sftp) {
      throw new Error('Unable to establish SFTP connection');
    }

    return { hostname, resourcePath, sftp };
  }
}

type FileSystemMethod<TArgs extends unknown[], TResult> = (
  uri: vscode.Uri,
  ...args: TArgs
) => Promise<TResult>;

function withFileSystemErrorHandling<TArgs extends unknown[], TResult>(
  fn: FileSystemMethod<TArgs, TResult>
): FileSystemMethod<TArgs, TResult> {
  return async (uri: vscode.Uri, ...args: TArgs): Promise<TResult> => {
    Logger.info(`${fn.name}: ${uri}`, 'tsFs-sftp');

    try {
      return await fn(uri, ...args);
    } catch (error) {
      const message = getErrorMessage(error);
      Logger.error(`${fn.name}: ${error}`, 'tsFs-sftp');

      if (message.includes('no such file or directory')) {
        throw vscode.FileSystemError.FileNotFound();
      }

      if (message.includes('permission denied')) {
        throw vscode.FileSystemError.NoPermissions();
      }

      if (message.includes('file already exists')) {
        throw vscode.FileSystemError.FileExists();
      }

      if (message.includes('EISDIR')) {
        throw vscode.FileSystemError.FileIsADirectory();
      }

      if (message.includes('ENOTDIR')) {
        throw vscode.FileSystemError.FileNotADirectory();
      }

      if (
        message.includes('no connection') ||
        message.includes('connection lost') ||
        message.includes('Unable to establish SFTP connection')
      ) {
        throw vscode.FileSystemError.Unavailable();
      }

      throw error;
    }
  };
}
