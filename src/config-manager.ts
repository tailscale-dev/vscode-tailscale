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
  private config: Config;

  constructor(public readonly configPath: string) {
    if (fs.existsSync(this.configPath)) {
      const rawData = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(rawData);
    } else {
      this.config = {};
    }
  }

  static withContext(context: vscode.ExtensionContext) {
    const globalStoragePath = context.globalStoragePath;

    if (!fs.existsSync(globalStoragePath)) {
      fs.mkdirSync(globalStoragePath);
    }

    return new ConfigManager(path.join(globalStoragePath, 'config.json'));
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  set<K extends keyof Config>(key: K, value: Config[K]) {
    this.config[key] = value;
    this.saveConfig();
  }

  setUserForHost(hostname: string, username: string) {
    this.config.hosts = this.config.hosts || {};
    this.config.hosts[hostname] = this.config.hosts[hostname] || {};
    this.config.hosts[hostname].user = username;

    this.saveConfig();
  }

  private saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }
}
