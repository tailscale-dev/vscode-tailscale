import { Client, SFTPWrapper } from 'ssh2';
import * as vscode from 'vscode';

import { ConfigManager } from './config-manager';
import { getUsername } from './utils/host';
import { Sftp } from './sftp';
import { EXTENSION_NS } from './constants';
import { Logger } from './logger';

export class SFTPConnectionManager {
  private static instance: SFTPConnectionManager;
  private connections: Map<string, Sftp>;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.connections = new Map();
    this.configManager = configManager;
  }

  static getInstance(configManager: ConfigManager): SFTPConnectionManager {
    if (!SFTPConnectionManager.instance) {
      SFTPConnectionManager.instance = new SFTPConnectionManager(configManager);
    }
    return SFTPConnectionManager.instance;
  }

  async getConnection(host: string): Promise<Sftp> {
    const username = getUsername(this.configManager, host);
    const key = this.formatKey(host, username);

    let connection = this.connections.get(key);

    if (connection) {
      return connection;
    }

    const client = new Client();
    connection = await new Promise<Sftp>((resolve, reject) => {
      client.connect({ host, username });
      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) reject(err);
          resolve(new Sftp(sftp));
        });
      });
      client.on('error', (err) => {
        reject(err);
      });
    });

    this.connections.set(key, connection);
    return connection;
  }

  async displayAuthenticationError(level: string, username: string, address: string) {
    if (level === 'wrong-user') {
      vscode.window.showWarningMessage(
        `The username '${username}' is not valid on host ${address}`
      );
    } else {
      const msg = `We couldn't connect to the node. Ensure Tailscale SSH is permitted in ACLs, and the username is correct.`;
      const action = await vscode.window.showWarningMessage(msg, 'Learn more');
      if (action) {
        vscode.env.openExternal(
          vscode.Uri.parse(
            'https://tailscale.com/kb/1193/tailscale-ssh/#ensure-tailscale-ssh-is-permitted-in-acls'
          )
        );
      }
    }
  }

  private isAuthenticationError(err: unknown): err is { level: string } {
    return (
      typeof err === 'object' &&
      err !== null &&
      'level' in err &&
      (err.level === 'client-authentication' || err.level === 'wrong-user')
    );
  }

  async promptForUsername(address: string): Promise<string | undefined> {
    const username = await vscode.window.showInputBox({
      prompt: `Please enter a valid username for host "${address}"`,
    });

    if (username && this.configManager) {
      this.configManager.setForHost(address, 'user', username);
    }

    return username;
  }

  closeConnection(hostname: string): void {
    const key = this.formatKey(hostname);
    const connection = this.connections.get(key);

    if (connection) {
      // connection.end();
      this.connections.delete(key);
    }
  }

  private formatKey(hostname: string, username?: string): string {
    const u = username || getUsername(this.configManager, hostname);
    return `${u}@${hostname}`;
  }
}
