import * as vscode from 'vscode';
import { Logger } from './logger';
import { ConfigManager } from './config-manager';
import { parseTsUri } from './utils/uri';

import { SshConnectionManager } from './ssh-connection-manager';

export class TSFileSystemProvider implements vscode.FileSystemProvider {
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

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    Logger.info(`readDirectory: ${uri}`, `tsFs`);
    const { hostname, resourcePath } = parseTsUri(uri);

    const sftp = await this.manager.getSftp(hostname);
    if (!sftp) {
      throw new Error('Unable to establish SFTP connection');
    }

    return await sftp.readDirectory(resourcePath);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    Logger.info(`stat: ${uri}`, 'tsFs');
    const { hostname, resourcePath } = parseTsUri(uri);

    const sftp = await this.manager.getSftp(hostname);
    if (!sftp) {
      throw new Error('Unable to establish SFTP connection');
    }

    return await sftp.stat(resourcePath);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    try {
      Logger.info(`createDirectory: ${uri}`, 'tsFs');
      const { hostname, resourcePath } = parseTsUri(uri);

      const sftp = await this.manager.getSftp(hostname);
      if (!sftp) throw new Error('Failed to establish SFTP connection');

      return await sftp.createDirectory(resourcePath);
    } catch (err) {
      Logger.error(`createDirectory: ${err}`, 'tsFs');
      throw err;
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    Logger.info(`readFile: ${uri}`, 'tsFs');
    const { hostname, resourcePath } = parseTsUri(uri);

    const sftp = await this.manager.getSftp(hostname);
    if (!sftp) {
      throw new Error('Unable to establish SFTP connection');
    }

    return await sftp.readFile(resourcePath);
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    Logger.info(`readFile: ${uri}`, 'tsFs');
    const { hostname, resourcePath } = parseTsUri(uri);

    const sftp = await this.manager.getSftp(hostname);
    if (!sftp) {
      throw new Error('Unable to establish SFTP connection');
    }

    return await sftp.writeFile(resourcePath, content);
  }

  async delete(uri: vscode.Uri): Promise<void> {
    Logger.info(`delete: ${uri}`, 'tsFs');
    const { hostname, resourcePath } = parseTsUri(uri);

    const sftp = await this.manager.getSftp(hostname);
    if (!sftp) {
      throw new Error('Unable to establish SFTP connection');
    }

    return await sftp.delete(resourcePath);
  }

  async rename(): Promise<void> {}
}
