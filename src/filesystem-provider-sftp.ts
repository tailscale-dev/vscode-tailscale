import * as vscode from 'vscode';
import * as util from 'util';

import { Logger } from './logger';
import { ConfigManager } from './config-manager';
import { parseTsUri } from './utils/uri';
import { SFTPConnectionManager } from './sftp-connection-manager';
import { fileSorter } from './filesystem-provider';
import { getErrorMessage } from './utils/error';

export class FileSystemProviderSFTP implements vscode.FileSystemProvider {
  public manager: SFTPConnectionManager;

  constructor(configManager: ConfigManager) {
    this.manager = SFTPConnectionManager.getInstance(configManager);
  }

  // Implementation of the `onDidChangeFile` event
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >().event;

  watch(): vscode.Disposable {
    throw new Error('Watch not supported');
  }

  readDirectory = withFileSystemErrorHandling(
    'readDirectory',
    async (uri: vscode.Uri): Promise<[string, vscode.FileType][]> => {
      const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
      const files = await sftp.readDirectory(resourcePath);
      return files.sort(fileSorter);
    }
  );

  stat = withFileSystemErrorHandling('stat', async (uri: vscode.Uri): Promise<vscode.FileStat> => {
    const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
    return await sftp.stat(resourcePath);
  });

  createDirectory = withFileSystemErrorHandling(
    'createDirectory',
    async (uri: vscode.Uri): Promise<void> => {
      const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
      return await sftp.createDirectory(resourcePath);
    }
  );

  readFile = withFileSystemErrorHandling(
    'readFile',
    async (uri: vscode.Uri): Promise<Uint8Array> => {
      const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
      return await sftp.readFile(resourcePath);
    }
  );

  writeFile = withFileSystemErrorHandling(
    'writeFile',
    async (uri: vscode.Uri, content: Uint8Array) => {
      const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);
      return await sftp.writeFile(resourcePath, content);
    }
  );

  delete = withFileSystemErrorHandling('delete', async (uri: vscode.Uri): Promise<void> => {
    const { resourcePath, sftp } = await this.getParsedUriAndSftp(uri);

    const deleteRecursively = async (path: string) => {
      const st = await sftp.stat(path);

      // short circuit for files
      if (st.type === vscode.FileType.File) {
        await sftp.delete(path);
        return;
      }

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

  rename = withFileSystemErrorHandling('rename', async (source: vscode.Uri, target: vscode.Uri) => {
    const { resourcePath: sourcePath, sftp } = await this.getParsedUriAndSftp(source);
    const { resourcePath: targetPath } = parseTsUri(target);

    return await sftp.rename(sourcePath, targetPath);
  });

  upload = withFileSystemErrorHandling('upload', async (source: vscode.Uri, target: vscode.Uri) => {
    const sourcePath = source.path;
    const { resourcePath: targetPath, sftp } = await this.getParsedUriAndSftp(target);

    Logger.info(`Uploading ${sourcePath} to ${targetPath}`, 'tsFs-sftp');

    return await sftp.uploadFile(sourcePath, targetPath);
  });

  async getHomeDirectory(address: string): Promise<string> {
    const sftp = await this.manager.getConnection(address);
    if (!sftp) throw new Error('Failed to establish SFTP connection');

    return await sftp.getHomeDirectory();
  }

  async getParsedUriAndSftp(uri: vscode.Uri) {
    const { address, resourcePath } = parseTsUri(uri);
    const sftp = await this.manager.getConnection(address);

    if (!sftp) {
      throw new Error('Unable to establish SFTP connection');
    }

    return { address, resourcePath, sftp };
  }
}

type FileSystemMethod<TArgs extends unknown[], TResult> = (
  uri: vscode.Uri,
  ...args: TArgs
) => Promise<TResult>;

function withFileSystemErrorHandling<TArgs extends unknown[], TResult>(
  actionName: string,
  fn: FileSystemMethod<TArgs, TResult>
): FileSystemMethod<TArgs, TResult> {
  return async (uri: vscode.Uri, ...args: TArgs): Promise<TResult> => {
    Logger.info(`${actionName}: ${uri}`, 'tsFs-sftp');

    try {
      return await fn(uri, ...args);
    } catch (error) {
      const message = getErrorMessage(error);

      if (error instanceof vscode.FileSystemError) {
        throw error;
      }

      if (message.includes('no such file or directory')) {
        throw vscode.FileSystemError.FileNotFound();
      }

      if (message.includes('permission denied')) {
        throw vscode.FileSystemError.NoPermissions();
      }

      if (message.includes('file already exists')) {
        const message = `Unable to move/copy`;
        throw vscode.FileSystemError.FileExists(message);
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

      Logger.error(`${actionName}: ${error}`, 'tsFs-sftp');

      throw error;
    }
  };
}
