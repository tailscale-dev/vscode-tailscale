import * as path from 'path';
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

  async readSymbolicLink(linkPath: string): Promise<string> {
    const sftp = await this.getSftp();
    let result = await util.promisify(sftp.readlink).call(sftp, linkPath);

    // if link is relative, not absolute
    if (!result.startsWith('/')) {
      // note: this needs to be / even on Windows, so don't use path.join()
      result = `${path.dirname(linkPath)}/${result}`;
    }

    return result;
  }

  async readDirectory(path: string): Promise<[string, vscode.FileType][]> {
    const sftp = await this.getSftp();
    const files = await util.promisify(sftp.readdir).call(sftp, path);
    const result: [string, vscode.FileType][] = [];

    for (const file of files) {
      result.push([
        file.filename,
        await this.convertFileType(file.attrs as ssh2.Stats, `${path}/${file.filename}`),
      ]);
    }

    return result;
  }

  async getHomeDirectory(): Promise<string> {
    const sftp = await this.getSftp();
    return await util.promisify(sftp.realpath).call(sftp, '.');
  }

  async stat(path: string): Promise<vscode.FileStat> {
    const sftp = await this.getSftp();
    // sftp.lstat, when stat-ing symlinks, will stat the links themselves
    // instead of following them. it's necessary to do this and then follow
    // the symlinks manually in convertFileType since file.attrs from sftp.readdir
    // returns a Stats object that claims to be a symbolic link, but neither a
    // file nor a directory. so convertFileType needs to follow symlinks manually
    // to figure out whether they point to a file or directory and correctly
    // populate the vscode.FileType bitfield. this also allows symlinks to directories
    // to not accidentally be treated as directories themselves, so deleting a symlink
    // doesn't delete the contents of the directory it points to.
    const s = await util.promisify(sftp.lstat).call(sftp, path);

    return {
      type: await this.convertFileType(s, path),
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

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    console.log('uploadFile', localPath, remotePath);
    const sftp = await this.getSftp();
    return util.promisify(sftp.fastPut).call(sftp, localPath, remotePath);
  }

  async convertFileType(stats: ssh2.Stats, filename: string): Promise<vscode.FileType> {
    if (stats.isDirectory()) {
      return vscode.FileType.Directory;
    } else if (stats.isFile()) {
      return vscode.FileType.File;
    } else if (stats.isSymbolicLink()) {
      const sftp = await this.getSftp();
      const target = await this.readSymbolicLink(filename);
      const tStat = await util.promisify(sftp.stat).call(sftp, target);
      return vscode.FileType.SymbolicLink | (await this.convertFileType(tStat, target));
    } else {
      return vscode.FileType.Unknown;
    }
  }
}
