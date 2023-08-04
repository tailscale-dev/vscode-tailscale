import * as vscode from 'vscode';
import { FileExplorer } from '../node-explorer-provider';
import { createTsUri, parseTsUri } from '../utils/uri';

export async function PeerFsCreateDirectoryCommand(
  node: FileExplorer,
  onDidChangeTreeData: vscode.EventEmitter<FileExplorer[]>
) {
  const { address, tailnet, resourcePath } = parseTsUri(node.uri);
  if (!address || !resourcePath) {
    return;
  }

  // TODO: validate input
  const dirName = await vscode.window.showInputBox({
    prompt: 'Enter a name for the new directory',
    placeHolder: 'New directory',
  });

  if (!dirName) {
    return;
  }

  const newUri = createTsUri({
    tailnet,
    address,
    resourcePath: `${resourcePath}/${dirName}`,
  });

  try {
    await vscode.workspace.fs.createDirectory(newUri);
    onDidChangeTreeData.fire([node]);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not create directory: ${e}`);
  }
}
