import * as vscode from 'vscode';
import { EventEmitterType, FileExplorer } from '../node-explorer-provider';

export function PeerFsDeleteCommand(
  onDidChangeTreeData: EventEmitterType
) {
  return async function(file: FileExplorer) {
    const fileType = file.type === vscode.FileType.Directory ? 'directory' : 'file';
    const msg = `Are you sure you want to delete this ${fileType}? This action cannot be undone.`;
    const answer = await vscode.window.showInformationMessage(msg, { modal: true }, 'Yes');

    if (answer !== 'Yes') return;

    try {
      await vscode.workspace.fs.delete(file.uri);
      vscode.window.showInformationMessage(`${file.label} deleted successfully.`);
      onDidChangeTreeData.fire([undefined]);
    } catch (e) {
      vscode.window.showErrorMessage(`Could not delete ${file.label}: ${e}`);
    }
  };
}