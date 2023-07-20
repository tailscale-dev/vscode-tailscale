import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { test, expect, beforeEach } from 'vitest';
import { ConfigManager } from './config-manager';

const extensionContext = {
  globalStoragePath: '/tmp/vscode-tailscale',
} as vscode.ExtensionContext;

const configPath = path.join(extensionContext.globalStoragePath, 'config.json');

beforeEach(() => {
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
});

test('withContext will create directory if it does not exist', () => {
  fs.rmSync(extensionContext.globalStoragePath, { recursive: true, force: true });
  expect(fs.existsSync(extensionContext.globalStoragePath)).toBe(false);

  ConfigManager.withContext(extensionContext);
  expect(fs.existsSync(extensionContext.globalStoragePath)).toBe(true);
});

test('withContext returns an initialized ConfigManager', () => {
  const cm = ConfigManager.withContext(extensionContext);
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
  expect(cm.get('hosts')).toEqual(hosts);

  const f = fs.readFileSync(configPath, 'utf8');
  expect(JSON.parse(f)).toEqual({ hosts });
});
