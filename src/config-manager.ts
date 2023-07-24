import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface Host {
  user: string;
  rootDir: string;
}

interface Config {
  defaultHost?: Host;
  hosts?: Record<string, Host>;
}

export class ConfigManager {
  private _config: Config;

  constructor(public readonly configPath: string) {
    if (fs.existsSync(this.configPath)) {
      const rawData = fs.readFileSync(this.configPath, 'utf8');
      this._config = JSON.parse(rawData);
    } else {
      this._config = {};
    }
  }

  static withGlobalStorageUri(globalStorageUri: vscode.Uri) {
    const globalStoragePath = globalStorageUri.fsPath;

    if (!fs.existsSync(globalStoragePath)) {
      fs.mkdirSync(globalStoragePath);
    }

    return new ConfigManager(path.join(globalStoragePath, 'config.json'));
  }

  set<K extends keyof Config>(key: K, value: Config[K]) {
    this._config[key] = value;
    this.saveConfig();
  }

  public get config(): Config {
    return this._config;
  }

  setUserForHost(hostname: string, username: string) {
    this._config.hosts = this._config.hosts ?? {};
    this._config.hosts[hostname] = this._config.hosts[hostname] ?? {};
    this._config.hosts[hostname].user = username;

    this.saveConfig();
  }

  private saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this._config, null, 2), 'utf8');
  }
}
