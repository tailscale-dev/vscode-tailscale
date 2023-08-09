import * as vscode from 'vscode';
import { Logger } from './logger';
import { FileSystemProvider } from './filesystem-provider';

// WithFSTiming is a FileSystemProvider implementation
// that just wraps each call and logs the timing it took
// for performance comparisons.
export class WithFSTiming implements FileSystemProvider {
  constructor(private readonly fsp: FileSystemProvider) {}

  // Implementation of the `onDidChangeFile` event
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >().event;

  watch(
    uri: vscode.Uri,
    options: { readonly recursive: boolean; readonly excludes: readonly string[] }
  ): vscode.Disposable {
    return this.fsp.watch(uri, options);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const startTime = new Date().getTime();
    const res = await this.fsp.stat(uri);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for stat`, `tsFs-timing`);
    return res;
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const startTime = new Date().getTime();
    const res = await this.fsp.readDirectory(uri);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for readDirectory`, `tsFs-timing`);
    return res;
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const startTime = new Date().getTime();
    const res = await this.fsp.createDirectory(uri);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for createDirectory`, `tsFs-timing`);
    return res;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const startTime = new Date().getTime();
    const res = await this.fsp.readFile(uri);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for readFile`, `tsFs-timing`);
    return res;
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean }
  ): Promise<void> {
    const startTime = new Date().getTime();
    const res = await this.fsp.writeFile(uri, content, options);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for writeFile`, `tsFs-timing`);
    return res;
  }

  async delete(uri: vscode.Uri, options: { readonly recursive: boolean }): Promise<void> {
    const startTime = new Date().getTime();
    const res = await this.fsp.delete(uri, options);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for delete`, `tsFs-timing`);
    return res;
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { readonly overwrite: boolean } = { overwrite: false }
  ): Promise<void> {
    const startTime = new Date().getTime();
    const res = await this.fsp.rename(oldUri, newUri, options);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for rename`, `tsFs-timing`);
    return res;
  }

  async upload(source: vscode.Uri, target: vscode.Uri): Promise<void> {
    const startTime = new Date().getTime();
    const res = await this.fsp.upload(source, target);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for upload`, `tsFs-timing`);
    return res;
  }

  async getHomeDirectory(hostname: string): Promise<string> {
    const startTime = new Date().getTime();
    const res = await this.fsp.getHomeDirectory(hostname);
    const endTime = new Date().getTime();
    Logger.info(`${endTime - startTime}ms for getHomeDirectory`, `tsFs-timing`);
    return res;
  }
}
