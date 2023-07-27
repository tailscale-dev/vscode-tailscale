import * as cp from 'child_process';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as WebSocket from 'ws';
import type { ServeParams, ServeStatus, TSRelayDetails, Status } from '../types';
import { Logger } from '../logger';
import * as path from 'node:path';
import { LogLevel } from 'vscode';
import { trimSuffix } from '../utils';
import { EXTENSION_NS } from '../constants';

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
  workspace: typeof vscode.workspace;
}

export class Tailscale {
  private _vscode: vscodeModule;
  private nonce?: string;
  public url?: string;
  private port?: string;
  public authkey?: string;
  private childProcess?: cp.ChildProcess;
  private notifyExit?: () => void;
  private socket?: string;
  private ws?: WebSocket;

  constructor(vscode: vscodeModule) {
    this._vscode = vscode;
  }

  static async withInit(vscode: vscodeModule): Promise<Tailscale> {
    const ts = new Tailscale(vscode);
    await ts.init();
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('tailscale.portDiscovery.enabled')) {
        if (ts.portDiscoOn() && !ts.ws) {
          Logger.debug('running port disco');
          ts.runPortDisco();
        } else if (!ts.portDiscoOn() && ts.ws) {
          Logger.debug('turning off port disco');
          ts.ws.close();
          ts.ws = undefined;
        }
      }
    });
    return ts;
  }

  defaultArgs() {
    const args = [];
    if (this._vscode.env.logLevel === LogLevel.Debug) {
      args.push('-v');
    }
    if (this.port) {
      args.push(`-port=${this.port}`);
    }
    if (this.nonce) {
      args.push(`-nonce=${this.nonce}`);
    }
    if (this.socket) {
      args.push(`-socket=${this.socket}`);
    }
    return args;
  }

  async init() {
    return new Promise<null>((resolve) => {
      this.socket = vscode.workspace.getConfiguration(EXTENSION_NS).get<string>('socketPath');
      let binPath = this.tsrelayPath();
      let args = this.defaultArgs();
      let cwd = __dirname;
      if (process.env.NODE_ENV === 'development') {
        binPath = '../tool/go';
        args = ['run', '.', ...args];
        cwd = path.join(cwd, '../tsrelay');
      }
      Logger.debug(`path: ${binPath}`, LOG_COMPONENT);
      Logger.debug(`args: ${args.join(' ')}`, LOG_COMPONENT);

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
              `curl -H "Authorization: Basic ${this.authkey}" "${this.url}/serve"`,
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

      this.processStderr(this.childProcess);
    });
  }
  async initSudo() {
    return new Promise<null>((resolve, err) => {
      const binPath = this.tsrelayPath();
      const args = this.defaultArgs();

      Logger.info(`path: ${binPath}`, LOG_COMPONENT);
      this.notifyExit = () => {
        Logger.info('starting sudo tsrelay');
        let authCmd = `/usr/bin/pkexec`;
        let authArgs = ['--disable-internal-agent', binPath, ...args];
        if (
          process.env['container'] === 'flatpak' &&
          process.env['FLATPAK_ID'] &&
          process.env['FLATPAK_ID'].startsWith('com.visualstudio.code')
        ) {
          authCmd = 'flatpak-spawn';
          authArgs = ['--host', 'pkexec', '--disable-internal-agent', binPath, ...args];
        }
        const childProcess = cp.spawn(authCmd, authArgs);
        childProcess.on('exit', async (code) => {
          Logger.warn(`sudo child process exited with code ${code}`, LOG_COMPONENT);
          if (code === 0) {
            return;
          } else if (code === 126) {
            // authentication not successful
            this._vscode.window.showErrorMessage(
              'Creating a Funnel must be done by an administrator'
            );
          } else {
            this._vscode.window.showErrorMessage('Could not run authenticator, please check logs');
          }
          await this.init();
          err('unauthenticated');
        });
        childProcess.on('error', (err) => {
          Logger.error(`sudo child process error ${err}`, LOG_COMPONENT);
        });
        childProcess.stdout.on('data', (data: Buffer) => {
          Logger.debug('received data from sudo');
          const details = JSON.parse(data.toString().trim()) as TSRelayDetails;
          if (this.url !== details.address) {
            Logger.error(`expected url to be ${this.url} but got ${details.address}`);
            return;
          }
          this.runPortDisco();
          Logger.debug('resolving');
          resolve(null);
        });
        this.processStderr(childProcess);
      };
      this.dispose();
    });
  }

  portDiscoOn() {
    return vscode.workspace.getConfiguration(EXTENSION_NS).get<boolean>('portDiscovery.enabled');
  }

  processStderr(childProcess: cp.ChildProcess) {
    if (!childProcess.stderr) {
      Logger.error('childProcess.stderr is null', LOG_COMPONENT);
      throw new Error('childProcess.stderr is null');
    }
    let buffer = '';
    childProcess.stderr.on('data', (data: Buffer) => {
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

    childProcess.stderr.on('end', () => {
      // Process the remaining data in the buffer after the stream ends
      const line = buffer.trim();
      if (line.length > 0) {
        Logger.info(line, LOG_COMPONENT);
      }
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
    if (this.childProcess) {
      Logger.info('shutting down tsrelay');
      this.childProcess.kill();
    }
  }

  async status() {
    if (!this.url) {
      throw new Error('uninitialized client');
    }
    try {
      const resp = await fetch(`${this.url}/localapi/v0/status`, {
        headers: {
          Authorization: 'Basic ' + this.authkey,
        },
      });

      const status = (await resp.json()) as Status;
      return status;
    } catch (e) {
      Logger.error(`error calling status: ${e}`);
      throw e;
    }
  }

  async serveStatus(withPeers?: boolean): Promise<ServeStatus> {
    if (!this.url) {
      throw new Error('uninitialized client');
    }
    try {
      const u = new URL(`${this.url}/serve`);
      if (withPeers) {
        u.searchParams.append('with-peers', '1');
      }
      const resp = await fetch(u, {
        headers: {
          Authorization: 'Basic ' + this.authkey,
        },
      });

      const status = (await resp.json()) as ServeStatus;
      return status;
    } catch (e) {
      Logger.error(`error calling serve: ${JSON.stringify(e, null, 2)}`);
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
    if (!this.portDiscoOn()) {
      Logger.info('port discovery is off');
      return;
    }

    this.ws = new WebSocket(`ws://${this.url.slice('http://'.length)}/portdisco`, {
      headers: {
        Authorization: 'Basic ' + this.authkey,
      },
    });
    this.ws.on('error', (e) => {
      Logger.info(`got ws error: ${e}`);
    });
    this.ws.on('open', () => {
      Logger.info('websocket is open');
      this._vscode.window.terminals.forEach(async (t) => {
        const pid = await t.processId;
        if (!pid) {
          return;
        }
        Logger.debug(`adding initial termianl process: ${pid}`);
        this.ws?.send(
          JSON.stringify({
            type: 'addPID',
            pid: pid,
          })
        );
      });
    });
    this.ws.on('close', () => {
      Logger.info('websocket is closed');
    });
    this.ws.on('message', async (data) => {
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
      this.ws?.send(
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
      this.ws?.send(
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
