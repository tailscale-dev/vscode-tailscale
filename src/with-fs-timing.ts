import * as vscode from 'vscode';
import { Logger } from './logger';

export class WithFSTiming implements vscode.FileSystemProvider {
  constructor(private readonly fsp: vscode.FileSystemProvider) {}
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
    Logger.info(`fs timing: ${endTime - startTime}ms for stat`);
    return res;
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const startTime = new Date().getTime();
    const res = await this.fsp.readDirectory(uri);
    const endTime = new Date().getTime();
    Logger.info(`fs timing: ${endTime - startTime}ms for readDirectory`);
    return res;
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const startTime = new Date().getTime();
    const res = await this.fsp.createDirectory(uri);
    const endTime = new Date().getTime();
    Logger.info(`fs timing: ${endTime - startTime}ms for createDirectory`);
    return res;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const startTime = new Date().getTime();
    const res = await this.fsp.readFile(uri);
    const endTime = new Date().getTime();
    Logger.info(`fs timing: ${endTime - startTime}ms for readFile`);
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
    Logger.info(`fs timing: ${endTime - startTime}ms for writeFile`);
    return res;
  }

  async delete(uri: vscode.Uri, options: { readonly recursive: boolean }): Promise<void> {
    const startTime = new Date().getTime();
    const res = await this.fsp.delete(uri, options);
    const endTime = new Date().getTime();
    Logger.info(`fs timing: ${endTime - startTime}ms for delete`);
    return res;
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { readonly overwrite: boolean }
  ): Promise<void> {
    const startTime = new Date().getTime();
    const res = await this.fsp.rename(oldUri, newUri, options);
    const endTime = new Date().getTime();
    Logger.info(`fs timing: ${endTime - startTime}ms for rename`);
    return res;
  }
}
