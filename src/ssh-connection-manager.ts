import * as ssh2 from 'ssh2';
import * as vscode from 'vscode';

import { ConfigManager } from './config-manager';
import { getUsername } from './utils/host';
import { Sftp } from './sftp';
import { EXTENSION_NS } from './constants';
import { Logger } from './logger';

export class SshConnectionManager {
  private connections: Map<string, ssh2.Client>;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.connections = new Map();
    this.configManager = configManager;
  }

  async getConnection(host: string, username: string): Promise<ssh2.Client> {
    const key = this.formatKey(host, username);

    if (this.connections.has(key)) {
      return this.connections.get(key) as ssh2.Client;
    }

    const conn = new ssh2.Client();
    const config = { host, username };

    try {
      await Promise.race([
        new Promise<void>((resolve, reject): void => {
          conn.on('ready', resolve);
          conn.on('error', reject);
          conn.on('close', () => {
            this.connections.delete(key);
          });

          // this might require a brower to open and the user to authenticate
          conn.connect(config);
        }),
        new Promise((_, reject) =>
          // TODO: how does Tailscale re-authentication effect this?
          // TODO: can we cancel the connection attempt?
          setTimeout(
            () => reject(new Error('Connection timeout')),
            vscode.workspace.getConfiguration(EXTENSION_NS).get('ssh.connectionTimeout')
          )
        ),
      ]);

      this.connections.set(key, conn);

      return conn;
    } catch (err) {
      let message = 'Unknown error';
      if (err instanceof Error) {
        message = err.message;
      }

      const logmsg = `Failed to connect to ${host} with username ${username}: ${message}`;
      Logger.error(logmsg, `ssh-conn-manager`);
      if (!this.isAuthenticationError(err)) {
        vscode.window.showErrorMessage(logmsg);
      }
      throw err;
    }
  }

  async getSftp(address: string): Promise<Sftp | undefined> {
    const username = getUsername(this.configManager, address);
    try {
      const conn = await this.getConnection(address, username);
      return new Sftp(conn);
    } catch (err) {
      if (this.isAuthenticationError(err)) {
        vscode.window.showWarningMessage(
          `The username '${username}' is not valid on host ${address}`
        );
        if (await this.promptForUsername(address)) {
          return await this.getSftp(address);
        }
        this.showUsernameRequiredError();
      }
      throw err;
    }
  }

  private isAuthenticationError(err: unknown): err is { level: string } {
    return (
      typeof err === 'object' &&
      err !== null &&
      'level' in err &&
      err.level === 'client-authentication'
    );
  }

  private async showUsernameRequiredError(): Promise<never> {
    const msg = 'Username is required to connect to remote host';
    vscode.window.showErrorMessage(msg);
    throw new Error(msg);
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
      connection.end();
      this.connections.delete(key);
    }
  }

  private formatKey(hostname: string, username?: string): string {
    const u = username || getUsername(this.configManager, hostname);
    return `${u}@${hostname}`;
  }
}
