import * as ssh2 from 'ssh2';
import * as util from 'util';
import * as vscode from 'vscode';

export class Sftp {
  private sftpPromise: Promise<ssh2.SFTPWrapper>;

  constructor(private conn: ssh2.Client) {
    this.sftpPromise = util.promisify(this.conn.sftp).call(this.conn);
  }

  private async getSftp(): Promise<ssh2.SFTPWrapper> {
    return this.sftpPromise;
  }

  async readDirectory(path: string): Promise<[string, vscode.FileType][]> {
    const sftp = await this.getSftp();
    const files = await util.promisify(sftp.readdir).call(sftp, path);
    const result: [string, vscode.FileType][] = [];

    for (const file of files) {
      result.push([file.filename, this.convertFileType(file.attrs as ssh2.Stats)]);
    }

    return result;
  }

  async getHomeDirectory(): Promise<string> {
    const sftp = await this.getSftp();
    return await util.promisify(sftp.realpath).call(sftp, '.');
  }

  async stat(path: string): Promise<vscode.FileStat> {
    const sftp = await this.getSftp();
    const s = await util.promisify(sftp.stat).call(sftp, path);

    return {
      type: this.convertFileType(s),
      ctime: s.atime,
      mtime: s.mtime,
      size: s.size,
    };
  }

  async createDirectory(path: string): Promise<void> {
    const sftp = await this.getSftp();
    return util.promisify(sftp.mkdir).call(sftp, path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const sftp = await this.getSftp();
    const buffer = await util.promisify(sftp.readFile).call(sftp, path);
    return new Uint8Array(buffer);
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const sftp = await this.getSftp();
    const buffer =
      data instanceof Uint8Array
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Buffer.from(data);
    return util.promisify(sftp.writeFile).call(sftp, path, buffer);
  }

  async delete(path: string): Promise<void> {
    const sftp = await this.getSftp();
    return util.promisify(sftp.unlink).call(sftp, path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getSftp();
    return util.promisify(sftp.rename).call(sftp, oldPath, newPath);
  }

  async rmdir(path: string): Promise<void> {
    const sftp = await this.getSftp();
    return util.promisify(sftp.rmdir).call(sftp, path);
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
