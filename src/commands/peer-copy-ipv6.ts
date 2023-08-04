import * as vscode from 'vscode';
import { PeerRoot } from '../node-explorer-provider';

export async function PeerCopyIPv6Command(node: PeerRoot) {
  const ip = node.TailscaleIPs[1];
  await vscode.env.clipboard.writeText(ip);
  vscode.window.showInformationMessage(`Copied ${ip} to clipboard.`);
}
