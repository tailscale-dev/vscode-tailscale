import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { Logger } from './logger';
import { ConfigManager } from './config-manager';

export class SSH {
  constructor(private readonly configManager?: ConfigManager) {}

  executeCommand(
    hostname: string,
    command: string,
    args: string[],
    options?: { stdin?: string; sudoPassword?: string }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const sshArgs: string[] = [];

      if (options?.sudoPassword) {
        sshArgs.push('sudo', '-S', command, ...args);
      } else {
        sshArgs.push(command, ...args);
      }

      const cmdForPrint = `ssh ${this.sshHostnameWithUser(hostname)} "${sshArgs.join(' ')}"`;

      Logger.info(`Running command: ${sshArgs.join(' ')}`, 'ssh');
      const childProcess = spawn(
        'ssh',
        [this.sshHostnameWithUser(hostname), `"${sshArgs.join(' ')}"`],
        { shell: true }
      );

      childProcess.on('error', (err) => {
        reject(err);
      });

      if (options?.sudoPassword) {
        childProcess.stdin.write(options.sudoPassword + '\n');
      }

      if (options?.stdin) {
        childProcess.stdin.write(options.stdin);
        childProcess.stdin.end();
      }

      let stdoutData = '';
      childProcess.stdout.on('data', (data) => {
        stdoutData += data;
      });

      let stderrData = '';
      childProcess.stderr.on('data', (data) => {
        stderrData += data;
      });

      childProcess.on('exit', (code) => {
        if (code === 0) {
          resolve(stdoutData);
        } else if (stderrData) {
          reject(new Error(stderrData));
        } else {
          reject(new Error(`Command (${cmdForPrint}): ${code}`));
        }
      });
    });
  }

  async promptForUsername(hostname: string): Promise<string | undefined> {
    const username = await vscode.window.showInputBox({
      prompt: `Please enter the username for host "${hostname}"`,
    });

    if (username && this.configManager) {
      this.configManager.setForHost(hostname, 'user', username);
    }

    return username;
  }

  async runCommandAndPromptForUsername(
    hostname: string,
    command: string,
    args: string[],
    options?: { stdin?: string; sudoPassword?: string }
  ): Promise<string> {
    try {
      const output = await this.executeCommand(hostname, command, args, options);
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
          const output = await this.executeCommand(hostname, command, args, options);
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

  public sshHostnameWithUser(hostname: string) {
    const { hosts } = this.configManager?.config || {};
    const userForHost = hosts?.[hostname]?.user?.trim();
    const defaultUser = vscode.workspace.getConfiguration('ssh').get<string>('defaultUser')?.trim();

    const user = userForHost || defaultUser;
    return user ? `${user}@${hostname}` : hostname;
  }
}
