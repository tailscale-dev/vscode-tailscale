import * as vscode from 'vscode';
import { exec } from 'child_process';
import { Logger } from './logger';
import { SSH } from './ssh';
import { ConfigManager } from './config-manager';
import { escapeSpace } from './utils/string';
import { parseTsUri } from './utils/uri';
import { fileSorter } from './filesystem-provider';

export class FileSystemProviderSSH implements vscode.FileSystemProvider {
  private ssh: SSH;

  constructor(configManager?: ConfigManager) {
    this.ssh = new SSH(configManager);
  }

  // Implementation of the `onDidChangeFile` event
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >().event;

  watch(): vscode.Disposable {
    throw new Error('Watch not supported');
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    Logger.info(`stat: ${uri.toString()}`, 'tsFs-ssh');
    const { hostname, resourcePath } = parseTsUri(uri);

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    const s = await this.ssh.runCommandAndPromptForUsername(hostname, 'stat', [
      '-L',
      '-c',
      `'{\\"type\\": \\"%F\\", \\"size\\": %s, \\"ctime\\": %Z, \\"mtime\\": %Y}'`,
      resourcePath,
    ]);

    const result = JSON.parse(s.trim());
    const type = result.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File;
    const size = result.size || 0;
    const ctime = result.ctime * 1000;
    const mtime = result.mtime * 1000;

    return { type, size, ctime, mtime };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    Logger.info(`readDirectory: ${uri.toString()}`, 'tsFs-ssh');

    const { hostname, resourcePath } = parseTsUri(uri);
    Logger.info(`hostname: ${hostname}`, 'tsFs-ssh');
    Logger.info(`remotePath: ${resourcePath}`, 'tsFs-ssh');

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    const s = await this.ssh.runCommandAndPromptForUsername(hostname, 'ls', ['-Ap', resourcePath]);

    const lines = s.trim();
    const files: [string, vscode.FileType][] = [];
    for (const line of lines.split('\n')) {
      if (line === '') {
        continue;
      }
      const isDirectory = line.endsWith('/');
      const type = isDirectory ? vscode.FileType.Directory : vscode.FileType.File;
      const name = isDirectory ? line.slice(0, -1) : line; // Remove trailing slash if it's a directory
      files.push([name, type]);
    }

    return files.sort(fileSorter);
  }

  async getHomeDirectory(hostname: string): Promise<string> {
    return (await this.ssh.executeCommand(hostname, 'echo', ['~'])).trim();
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    Logger.info(`readFile: ${uri.toString()}`, 'tsFs-ssh');
    const { hostname, resourcePath } = parseTsUri(uri);

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    const s = await this.ssh.runCommandAndPromptForUsername(hostname, 'cat', [resourcePath]);
    const buffer = Buffer.from(s, 'binary');
    return new Uint8Array(buffer);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    Logger.info(`writeFile: ${uri.toString()}`, 'tsFs-ssh');

    const { hostname, resourcePath } = parseTsUri(uri);

    if (!options.create && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    await this.ssh.runCommandAndPromptForUsername(hostname, 'tee', [resourcePath], {
      stdin: content.toString(),
    });
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    Logger.info(`delete: ${uri.toString()}`, 'tsFs-ssh');

    const { hostname, resourcePath } = parseTsUri(uri);

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    await this.ssh.runCommandAndPromptForUsername(hostname, 'rm', [
      `${options.recursive ? '-r' : ''}`,
      resourcePath,
    ]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    Logger.info(`createDirectory: ${uri.toString()}`, 'tsFs-ssh');

    const { hostname, resourcePath } = parseTsUri(uri);

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    await this.ssh.runCommandAndPromptForUsername(hostname, 'mkdir', ['-p', resourcePath]);
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    Logger.info('rename', 'tsFs-ssh');

    const { hostname: oldHost, resourcePath: oldPath } = parseTsUri(oldUri);
    const { hostname: newHost, resourcePath: newPath } = parseTsUri(newUri);

    if (!oldHost) {
      throw new Error('hostname is undefined');
    }

    if (oldHost !== newHost) {
      throw new Error('Cannot rename files across different hosts.');
    }

    await this.ssh.runCommandAndPromptForUsername(oldHost, 'mv', [
      `${options.overwrite ? '-f' : ''}`,
      oldPath,
      newPath,
    ]);
  }

  // scp pi@haas:/home/pi/foo.txt ubuntu@backup:/home/ubuntu/
  // scp /Users/Tyler/foo.txt ubuntu@backup:/home/ubuntu/
  // scp ubuntu@backup:/home/ubuntu/ /Users/Tyler/foo.txt

  scp(src: vscode.Uri, dest: vscode.Uri): Promise<void> {
    Logger.info('scp', 'tsFs-ssh');

    const { resourcePath: srcPath } = parseTsUri(src);
    const { hostname: destHostName, resourcePath: destPath } = parseTsUri(dest);

    const command = `scp ${srcPath} ${destHostName}:${destPath}`;

    return new Promise((resolve, reject) => {
      exec(command, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}
