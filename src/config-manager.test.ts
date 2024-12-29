import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { test, expect, beforeEach, vi } from 'vitest';
import { ConfigManager } from './config-manager';

const fsPath = '/tmp/vscode-tailscale';
const globalStorageUri = { fsPath } as vscode.Uri;
const configPath = path.join(fsPath, 'config.json');

beforeEach(() => {
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
});

test('withContext will create directory if it does not exist', () => {
  fs.rmSync(fsPath, { recursive: true, force: true });
  expect(fs.existsSync(fsPath)).toBe(false);

  ConfigManager.withGlobalStorageUri(globalStorageUri);
  expect(fs.existsSync(fsPath)).toBe(true);
});

test('withContext returns an initialized ConfigManager', () => {
  const cm = ConfigManager.withGlobalStorageUri(globalStorageUri);
  expect(cm.configPath).toBe(configPath);
});

test('set persists config to disk', () => {
  const cm = new ConfigManager(configPath);
  const hosts = {
    'host-1': {
      user: 'foo',
      rootDir: '/',
    },
  };

  cm.set('hosts', hosts);
  expect(cm.config.hosts).toEqual(hosts);

  const f = fs.readFileSync(configPath, 'utf8');
  expect(JSON.parse(f)).toEqual({ hosts });
});

test('withContext initializes remote-specific configurations if running in a remote context', () => {
  vi.spyOn(vscode.env, 'remoteName', 'get').mockReturnValue('ssh-remote');
  const cm = ConfigManager.withGlobalStorageUri(globalStorageUri);
  expect(cm.config.remoteHost).toBe('ssh-remote');
});

test('setForHost handles remote-specific configurations', () => {
  const cm = new ConfigManager(configPath);
  const hostname = 'remote-host';
  const remoteConfig = {
    remoteHost: 'remote-host',
    remotePort: 22,
    remoteUser: 'remote-user',
  };

  cm.setForHost(hostname, 'remoteHost', remoteConfig.remoteHost);
  cm.setForHost(hostname, 'remotePort', remoteConfig.remotePort);
  cm.setForHost(hostname, 'remoteUser', remoteConfig.remoteUser);

  expect(cm.config.hosts?.[hostname]?.remoteHost).toBe(remoteConfig.remoteHost);
  expect(cm.config.hosts?.[hostname]?.remotePort).toBe(remoteConfig.remotePort);
  expect(cm.config.hosts?.[hostname]?.remoteUser).toBe(remoteConfig.remoteUser);

  const f = fs.readFileSync(configPath, 'utf8');
  expect(JSON.parse(f)).toEqual({
    hosts: {
      [hostname]: remoteConfig,
    },
  });
});
