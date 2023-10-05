import * as vscode from 'vscode';

// FileSystemProvider adds to vscode.FileSystemProvider as different
// implementations grab the home directory differently
export interface FileSystemProvider extends vscode.FileSystemProvider {
  getHomeDirectory(hostname: string): Promise<string>;
  upload(source: vscode.Uri, target: vscode.Uri): Promise<void>;
}

// fileSorter mimicks the Node Explorer file structure in that directories
// are displayed first in alphabetical followed by files in the same fashion.
export function fileSorter(a: [string, vscode.FileType], b: [string, vscode.FileType]): number {
  if (a[1] & vscode.FileType.Directory && !(b[1] & vscode.FileType.Directory)) {
    return -1;
  }
  if (!(a[1] & vscode.FileType.Directory) && b[1] & vscode.FileType.Directory) {
    return 1;
  }

  // If same type, sort by name
  return a[0].localeCompare(b[0]);
}
