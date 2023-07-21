import { exec } from 'child_process';

import * as vscode from 'vscode';
import { Logger } from '../logger';
import { ConfigManager } from '../config-manager';

export class SSH {
  constructor(private readonly configManager?: ConfigManager) {}

  executeCommand(command: string): Promise<string> {
    Logger.info(command, 'ssh');

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  async promptForUsername(hostname: string): Promise<string | undefined> {
    const username = await vscode.window.showInputBox({
      prompt: `Please enter the username for host "${hostname}"`,
    });

    if (username && this.configManager) {
      this.configManager.setUserForHost(hostname, username);
    }

    return username;
  }

  async runCommandAndPromptForUsername(hostname: string, command: string) {
    const cmd = `ssh ${this.sshHostnameWithUser(hostname)} ${command}`;

    try {
      const output = await this.executeCommand(cmd);
      return output;
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }

      if (error.message.includes('Permission denied')) {
        const username = await this.promptForUsername(hostname);

        if (!username) {
          const msg = 'Username is required to connect to remote host';
          vscode.window.showErrorMessage(msg);
          throw new Error(msg);
        }

        const cmdWithUser = `ssh ${username}@${hostname} ${command}`;

        try {
          const output = await this.executeCommand(cmdWithUser);
          return output;
        } catch (error: unknown) {
          if (!(error instanceof Error)) {
            throw error;
          }

          const message = `Authentication to ${hostname} with ${username} failed: ${error.message}`;
          vscode.window.showErrorMessage(message);
          Logger.error(message, 'ssh');
          throw new Error(message);
        }
      } else {
        const message = `Error running command: ${error.message}`;
        vscode.window.showErrorMessage(message);
        Logger.error(message, 'ssh');
        throw new Error(message);
      }
    }
  }

  sshHostnameWithUser(hostname: string) {
    const user = this.configManager?.get('hosts')?.[hostname]?.user;

    return user ? `${user}@${hostname}` : hostname;
  }
}
