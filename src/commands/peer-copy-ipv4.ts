import * as vscode from 'vscode';
import { PeerRoot } from '../node-explorer-provider';

export async function PeerCopyIPv4Command(node: PeerRoot) {
  const ip = node.TailscaleIPs[0];

  if (!ip) {
    vscode.window.showErrorMessage(`No IPv4 address found for ${node.HostName}.`);
    return;
  }

  await vscode.env.clipboard.writeText(ip);
  vscode.window.showInformationMessage(`Copied ${ip} to clipboard.`);
}
