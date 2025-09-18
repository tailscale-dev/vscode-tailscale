import { Uri } from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface Host {
  user: string;
  rootDir: string;
  persistToSSHConfig?: boolean;
  differentUserFromSSHConfig?: boolean;
  remoteHost?: string;
  remotePort?: number;
  remoteUser?: string;
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

  static withGlobalStorageUri(globalStorageUri: Uri) {
    const globalStoragePath = globalStorageUri.fsPath;

    if (!fs.existsSync(globalStoragePath)) {
      fs.mkdirSync(globalStoragePath);
    }

    const configManager = new ConfigManager(path.join(globalStoragePath, 'config.json'));

    // Detect if the extension is running in a remote context
    const isRemote = !!vscode.env.remoteName;
    if (isRemote) {
      configManager.set('remoteHost', vscode.env.remoteName);
    }

    return configManager;
  }

  set<K extends keyof Config>(key: K, value: Config[K]) {
    this._config[key] = value;
    this.saveConfig();
  }

  public get config(): Config {
    return this._config;
  }

  setForHost<TKey extends keyof Host, TValue extends Host[TKey]>(
    hostname: string,
    key: TKey,
    value: TValue
  ) {
    this._config.hosts = this._config.hosts ?? {};
    this._config.hosts[hostname] = this._config.hosts[hostname] ?? {};
    this._config.hosts[hostname][key] = value;

    this.saveConfig();
  }

  private saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this._config, null, 2), 'utf8');
  }
}
