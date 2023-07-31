import * as vscode from 'vscode';
import { userInfo } from 'os';
import { ConfigManager } from '../config-manager';

export function getUsername(configManager: ConfigManager, hostname: string) {
  const { hosts } = configManager?.config || {};
  const userForHost = hosts?.[hostname]?.user?.trim();
  const defaultUser = vscode.workspace
    .getConfiguration('tailscale')
    .get<string>('ssh.defaultUser')
    ?.trim();

  return userForHost || defaultUser || userInfo().username;
}
