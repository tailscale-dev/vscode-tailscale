import * as cp from 'child_process';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as WebSocket from 'ws';
import type { ServeParams, ServeStatus, TSRelayDetails } from '../types';
import { Logger } from '../logger';
import * as path from 'node:path';
import { LogLevel } from 'vscode';
import { trimSuffix } from '../utils';
import sudo = require('sudo-prompt');

const LOG_COMPONENT = 'tsrelay';

export class TailscaleExecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TailscaleExecError';
  }
}

interface vscodeModule {
  window: typeof vscode.window;
  env: typeof vscode.env;
  commands: typeof vscode.commands;
}

export class Tailscale {
  private _vscode: vscodeModule;
  private nonce?: string;
  public url?: string;
  private port?: string;
  public authkey?: string;
  private childProcess?: cp.ChildProcess;
  private notifyExit?: () => void;

  constructor(vscode: vscodeModule) {
    this._vscode = vscode;
  }

  static async withInit(vscode: vscodeModule): Promise<Tailscale> {
    const ts = new Tailscale(vscode);
    await ts.init();
    return ts;
  }

  async init() {
    return new Promise<null>((resolve) => {
      let binPath = this.tsrelayPath();
      let args = [];
      if (this._vscode.env.logLevel === LogLevel.Debug) {
        args.push('-v');
      }
      let cwd = __dirname;
      if (process.env.NODE_ENV === 'development') {
        binPath = 'go';
        args = ['run', '.', ...args];
        cwd = path.join(cwd, '../tsrelay');
      }
      Logger.info(`path: ${binPath}`, LOG_COMPONENT);
      Logger.info(`args: ${args.join(' ')}`, LOG_COMPONENT);

      this.childProcess = cp.spawn(binPath, args, { cwd: cwd });

      this.childProcess.on('exit', (code) => {
        Logger.warn(`child process exited with code ${code}`, LOG_COMPONENT);
        if (this.notifyExit) {
          this.notifyExit();
        }
      });

      this.childProcess.on('error', (err) => {
        Logger.error(`child process error ${err}`, LOG_COMPONENT);
      });

      if (this.childProcess.stdout) {
        this.childProcess.stdout.on('data', (data: Buffer) => {
          const details = JSON.parse(data.toString().trim()) as TSRelayDetails;
          this.url = details.address;
          this.nonce = details.nonce;
          this.port = details.port;
          this.authkey = Buffer.from(`${this.nonce}:`).toString('base64');
          Logger.info(`url: ${this.url}`, LOG_COMPONENT);

          if (process.env.NODE_ENV === 'development') {
            Logger.info(
              `curl "${this.url}/serve" -H "Authorization: Basic ${this.authkey}"`,
              LOG_COMPONENT
            );
          }
          this.runPortDisco();
          resolve(null);
        });
      } else {
        Logger.error('childProcess.stdout is null', LOG_COMPONENT);
        throw new Error('childProcess.stdout is null');
      }

      if (this.childProcess.stderr) {
        let buffer = '';
        this.childProcess.stderr.on('data', (data: Buffer) => {
          buffer += data.toString(); // Append the data to the buffer

          const lines = buffer.split('\n'); // Split the buffer into lines

          // Process all complete lines except the last one
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (line.length > 0) {
              Logger.info(line, LOG_COMPONENT);
            }
          }

          buffer = lines[lines.length - 1];
        });

        this.childProcess.stderr.on('end', () => {
          // Process the remaining data in the buffer after the stream ends
          const line = buffer.trim();
          if (line.length > 0) {
            Logger.info(line, LOG_COMPONENT);
          }
        });
      } else {
        Logger.error('childProcess.stderr is null', LOG_COMPONENT);
        throw new Error('childProcess.stderr is null');
      }
    });
  }

  async initSudo(p: ServeParams) {
    return new Promise<null>((resolve) => {
      const binPath = this.tsrelayPath();
      const args = [`-nonce=${this.nonce}`, `-port=${this.port}`];
      if (this._vscode.env.logLevel === LogLevel.Debug) {
        args.push('-v');
      }
      Logger.info(`path: ${binPath}`, LOG_COMPONENT);
      this.notifyExit = () => {
        Logger.info('starting sudo tsrelay');
        sudo.exec(`${binPath} ${args.join(' ')}`, { name: 'Tailscale' }, (err, stdout, stderr) => {
          if (err) {
            Logger.info(`error running tsrelay in sudo: ${err}`);
            return;
          }
          Logger.info('stdout: ' + stdout);
          Logger.info('stderr: ' + stderr);
        });
      };
      Logger.info('shutting down tsrelay');
      this.childProcess!.kill('SIGINT');
      // TODO(marwan): actually wait for sudo to succeed then serveAdd/Remove.
      resolve(null);
    });
  }

  tsrelayPath(): string {
    let arch = process.arch;
    let platform: string = process.platform;
    // See:
    // https://goreleaser.com/customization/builds/#why-is-there-a-_v1-suffix-on-amd64-builds
    if (process.arch === 'x64') {
      arch = 'amd64_v1';
    }
    if (platform === 'win32') {
      platform = 'windows';
    }
    return path.join(__dirname, `../bin/vscode-tailscale_${platform}_${arch}/vscode-tailscale`);
  }

  dispose() {
    this.childProcess?.kill();
  }

  async serveStatus(): Promise<ServeStatus> {
    if (!this.url) {
      throw new Error('uninitialized client');
    }
    try {
      const resp = await fetch(`${this.url}/serve`, {
        headers: {
          Authorization: 'Basic ' + this.authkey,
        },
      });

      const status = (await resp.json()) as ServeStatus;
      return status;
    } catch (e) {
      Logger.error(`error calling status: ${JSON.stringify(e, null, 2)}`);
      throw e;
    }
  }

  async serveAdd(p: ServeParams) {
    if (!this.url) {
      throw new Error('uninitialized client');
    }
    try {
      const resp = await fetch(`${this.url}/serve`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + this.authkey,
        },
        body: JSON.stringify(p),
      });
      if (!resp.ok) {
        throw new Error('/serve failed');
      }
    } catch (e) {
      Logger.info(`error adding serve: ${e}`);
      throw e;
    }
  }

  async serveDelete(p?: ServeParams) {
    if (!this.url) {
      throw new Error('uninitialized client');
    }
    try {
      const resp = await fetch(`${this.url}/serve`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Basic ' + this.authkey,
        },
        body: JSON.stringify(p),
      });
      if (!resp.ok) {
        throw new Error('/serve failed');
      }
    } catch (e) {
      Logger.info(`error deleting serve: ${e}`);
      throw e;
    }
  }

  async setFunnel(port: number, on: boolean) {
    if (!this.url) {
      throw new Error('uninitialized client');
    }
    try {
      const resp = await fetch(`${this.url}/funnel`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + this.authkey,
        },
        body: JSON.stringify({ port, on }),
      });
      if (!resp.ok) {
        throw new Error('/serve failed');
      }
    } catch (e) {
      Logger.info(`error deleting serve: ${e}`);
      throw e;
    }
  }

  runPortDisco() {
    if (!this.url) {
      throw new Error('uninitialized client');
    }

    const ws = new WebSocket(`ws://${this.url.slice('http://'.length)}/portdisco`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.nonce}:`).toString('base64'),
      },
    });
    ws.on('error', (e) => {
      Logger.info(`got ws error: ${e}`);
    });
    ws.on('open', () => {
      Logger.info('websocket is open');
      this._vscode.window.terminals.forEach(async (t) => {
        const pid = await t.processId;
        if (!pid) {
          return;
        }
        Logger.debug(`adding initial termianl process: ${pid}`);
        ws.send(
          JSON.stringify({
            type: 'addPID',
            pid: pid,
          })
        );
      });
    });
    ws.on('message', async (data) => {
      Logger.info('got message');
      const msg = JSON.parse(data.toString());
      Logger.info(`msg is ${msg.type}`);
      if (msg.type != 'newPort') {
        return;
      }
      const shouldServe = await this._vscode.window.showInformationMessage(
        msg.message,
        { modal: false },
        'Serve'
      );
      if (shouldServe) {
        await this.runFunnel(msg.port);
      }
    });
    this._vscode.window.onDidOpenTerminal(async (e: vscode.Terminal) => {
      Logger.info('terminal opened');
      const pid = await e.processId;
      if (!pid) {
        return;
      }
      Logger.info(`pid is ${pid}`);
      ws.send(
        JSON.stringify({
          type: 'addPID',
          pid: pid,
        })
      );
      Logger.info('pid sent');
    });
    this._vscode.window.onDidCloseTerminal(async (e: vscode.Terminal) => {
      const pid = await e.processId;
      if (!pid) {
        return;
      }
      ws.send(
        JSON.stringify({
          type: 'removePID',
          pid: pid,
        })
      );
    });
  }

  async runFunnel(port: number) {
    await this.serveAdd({
      protocol: 'https',
      port: 443,
      mountPoint: '/',
      source: `http://127.0.0.1:${port}`,
      funnel: true,
    });

    const selection = await this._vscode.window.showInformationMessage(
      `Port ${port} shared over Tailscale`,
      'Copy URL'
    );
    if (selection === 'Copy URL') {
      const status = await this.serveStatus();
      const hostname = trimSuffix(status.Self?.DNSName, '.');
      this._vscode.env.clipboard.writeText(`https://${hostname}`);
    }

    await this._vscode.commands.executeCommand('tailscale-serve-view.refresh');
  }
}
