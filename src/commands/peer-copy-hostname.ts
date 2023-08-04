import * as vscode from 'vscode';
import { PeerRoot } from '../node-explorer-provider';

export async function PeerCopyHostnameCommand(node: PeerRoot) {
  const name = node.HostName;
  await vscode.env.clipboard.writeText(name);
  vscode.window.showInformationMessage(`Copied ${name} to clipboard.`);
}
