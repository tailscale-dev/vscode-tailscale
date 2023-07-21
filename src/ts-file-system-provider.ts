import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { Logger } from './logger';
import { SSH } from './utils/ssh';
import { ConfigManager } from './config-manager';

export class File implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  data?: Uint8Array;

  constructor(name: string) {
    this.type = vscode.FileType.File;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
  }
}

export class Directory implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  entries: Map<string, File | Directory>;

  constructor(name: string) {
    this.type = vscode.FileType.Directory;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
    this.entries = new Map();
  }
}

export type Entry = File | Directory;

export class TSFileSystemProvider implements vscode.FileSystemProvider {
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
    Logger.info(`stat: ${uri.toString()}`, 'tsobj-fsp');
    const { hostname, resourcePath } = this.extractHostAndPath(uri);

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    const command = `stat -L -c '{\\"type\\": \\"%F\\", \\"size\\": %s, \\"ctime\\": %Z, \\"mtime\\": %Y}'`;
    const s = (await this.ssh.runCommandAndPromptForUsername(
      hostname,
      `"${command}" "${resourcePath}"`
    )) as string;

    const result = JSON.parse(s.trim());
    const type = result.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File;
    const size = result.size || 0;
    const ctime = result.ctime * 1000;
    const mtime = result.mtime * 1000;

    return { type, size, ctime, mtime };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    Logger.info(`readDirectory: ${uri.toString()}`, 'tsobj-fsp');

    const { hostname, resourcePath } = this.extractHostAndPath(uri);
    Logger.info(`hostname: ${hostname}`, 'tsobj-fsp');
    Logger.info(`remotePath: ${resourcePath}`, 'tsobj-fsp');

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    const s = (await this.ssh.runCommandAndPromptForUsername(
      hostname,
      `ls -Ap "${resourcePath}"`
    )) as string;

    const lines = s.trim().split('\n');
    const files: [string, vscode.FileType][] = [];
    for (const line of lines) {
      const isDirectory = line.endsWith('/');
      const type = isDirectory ? vscode.FileType.Directory : vscode.FileType.File;
      const name = isDirectory ? line.slice(0, -1) : line; // Remove trailing slash if it's a directory
      files.push([name, type]);
    }

    return files.sort((a, b) => {
      if (a[1] === vscode.FileType.Directory && b[1] !== vscode.FileType.Directory) {
        return -1;
      }
      if (a[1] !== vscode.FileType.Directory && b[1] === vscode.FileType.Directory) {
        return 1;
      }

      // If same type, sort by name
      return a[0].localeCompare(b[0]);
    });
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    Logger.info(`readFile: ${uri.toString()}`, 'tsobj-readFile');
    const { hostname, resourcePath } = this.extractHostAndPath(uri);

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    const s = (await this.ssh.runCommandAndPromptForUsername(
      hostname,
      `cat "${resourcePath}"`
    )) as string;

    const buffer = Buffer.from(s, 'binary');
    return new Uint8Array(buffer);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    Logger.info(`writeFile: ${uri.toString()}`, 'tsobj-fsp');

    const { hostname, resourcePath } = this.extractHostAndPath(uri);

    if (!options.create && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    // TODO: update runCommandAndPromptForUsername to accept stdin
    const command = `ssh ${hostname} "tee ${resourcePath}"`;
    // TODO: handle write protected file and prompt for sudo password
    return new Promise((resolve, reject) => {
      const process = exec(command, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });

      process.stdin?.end(content);
    });
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    Logger.info(`delete: ${uri.toString()}`, 'tsobj-fsp');

    const { hostname, resourcePath } = this.extractHostAndPath(uri);

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    await this.ssh.runCommandAndPromptForUsername(
      hostname,
      `"rm ${options.recursive ? '-r' : ''} ${resourcePath}"`
    );
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    Logger.info(`createDirectory: ${uri.toString()}`, 'tsobj-fsp');

    const { hostname, resourcePath } = this.extractHostAndPath(uri);

    if (!hostname) {
      throw new Error('hostname is undefined');
    }

    await this.ssh.runCommandAndPromptForUsername(hostname, `mkdir -p "${resourcePath}"`);
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    Logger.info('rename', 'tsobj-fsp');

    const { hostname: oldHost, resourcePath: oldPath } = this.extractHostAndPath(oldUri);
    const { hostname: newHost, resourcePath: newPath } = this.extractHostAndPath(newUri);

    if (!oldHost) {
      throw new Error('hostname is undefined');
    }

    if (oldHost !== newHost) {
      throw new Error('Cannot rename files across different hosts.');
    }

    await this.ssh.runCommandAndPromptForUsername(
      oldHost,
      `${oldHost} mv ${options.overwrite ? '-f' : ''} ${oldPath} ${newPath}`
    );
  }

  // scp pi@haas:/home/pi/foo.txt ubuntu@backup:/home/ubuntu/
  // scp /Users/Tyler/foo.txt ubuntu@backup:/home/ubuntu/
  // scp ubuntu@backup:/home/ubuntu/ /Users/Tyler/foo.txt

  scp(src: vscode.Uri, dest: vscode.Uri): Promise<void> {
    Logger.info('scp', 'tsobj-fsp');

    const { resourcePath: srcPath } = this.extractHostAndPath(src);
    const { hostname: destHostName, resourcePath: destPath } = this.extractHostAndPath(dest);

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

  public extractHostAndPath(uri: vscode.Uri): { hostname: string | null; resourcePath: string } {
    switch (uri.scheme) {
      case 'ts': {
        const hostPath = uri.path.slice(1); // removes leading slash

        const segments = path.normalize(hostPath).split('/');
        const [hostname, ...pathSegments] = segments;
        const resourcePath = decodeURIComponent(pathSegments.join(path.sep));

        return { hostname, resourcePath: escapeSpace(resourcePath) };
      }
      case 'file':
        return { hostname: null, resourcePath: escapeSpace(uri.path) };
      default:
        throw new Error(`Unsupported scheme: ${uri.scheme}`);
    }
  }
}

function escapeSpace(str: string): string {
  return str.replace(/\s/g, '\\ ');
}
