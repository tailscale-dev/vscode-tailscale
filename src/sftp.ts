import * as ssh2 from 'ssh2';
import * as util from 'util';
import * as vscode from 'vscode';

export class Sftp {
  private sftp: ssh2.SFTPWrapper;

  constructor(sftp: ssh2.SFTPWrapper) {
    this.sftp = sftp;
  }

  async readDirectory(path: string): Promise<[string, vscode.FileType][]> {
    const files = await util.promisify(this.sftp.readdir).call(this.sftp, path);
    const result: [string, vscode.FileType][] = [];

    for (const file of files) {
      result.push([file.filename, this.convertFileType(file.attrs as ssh2.Stats)]);
    }

    return result;
  }

  async getHomeDirectory(): Promise<string> {
    return await util.promisify(this.sftp.realpath).call(this.sftp, '.');
  }

  async stat(path: string): Promise<vscode.FileStat> {
    const s = await util.promisify(this.sftp.stat).call(this.sftp, path);

    return {
      type: this.convertFileType(s),
      ctime: s.atime,
      mtime: s.mtime,
      size: s.size,
    };
  }

  async createDirectory(path: string): Promise<void> {
    return util.promisify(this.sftp.mkdir).call(this.sftp, path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const buffer = await util.promisify(this.sftp.readFile).call(this.sftp, path);
    return new Uint8Array(buffer);
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const buffer =
      data instanceof Uint8Array
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Buffer.from(data);
    return util.promisify(this.sftp.writeFile).call(this.sftp, path, buffer);
  }

  async delete(path: string): Promise<void> {
    return util.promisify(this.sftp.unlink).call(this.sftp, path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    return util.promisify(this.sftp.rename).call(this.sftp, oldPath, newPath);
  }

  async rmdir(path: string): Promise<void> {
    return util.promisify(this.sftp.rmdir).call(this.sftp, path);
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    console.log('uploadFile', localPath, remotePath);
    return util.promisify(this.sftp.fastPut).call(this.sftp, localPath, remotePath);
  }

  convertFileType(stats: ssh2.Stats): vscode.FileType {
    if (stats.isDirectory()) {
      return vscode.FileType.Directory;
    } else if (stats.isFile()) {
      return vscode.FileType.File;
    } else if (stats.isSymbolicLink()) {
      return vscode.FileType.SymbolicLink;
    } else {
      return vscode.FileType.Unknown;
    }
  }
}
