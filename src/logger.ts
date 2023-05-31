import * as vscode from 'vscode';

class Log {
  private _outputChannel: vscode.LogOutputChannel;

  constructor() {
    this._outputChannel = vscode.window.createOutputChannel('Tailscale', { log: true });
  }

  private logString(message: string, component?: string) {
    return component ? `[${component}] ${message}` : message;
  }

  public trace(message: string, component: string) {
    this._outputChannel.trace(this.logString(message, component));
  }

  public debug(message: string, component?: string) {
    this._outputChannel.debug(this.logString(message, component));
  }

  public info(message: string, component?: string) {
    this._outputChannel.info(this.logString(message, component));
  }

  public warn(message: string, component?: string) {
    this._outputChannel.warn(this.logString(message, component));
  }

  public error(message: string, component?: string) {
    this._outputChannel.error(this.logString(message, component));
  }
}

export const Logger = new Log();
