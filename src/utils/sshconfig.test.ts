import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as SSHConfig from 'ssh-config';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ConfigManager } from '../config-manager';
import { syncSSHConfig } from './sshconfig';

const mocks = vi.hoisted(() => ({
  homeDir: '',
  configFile: undefined as string | undefined,
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
  showInformationMessage: vi.fn(),
}));

vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  homedir: () => mocks.homeDir,
}));

vi.mock('vscode', async () => {
  const { URI, Utils } = await import('vscode-uri');
  class FileSystemError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }

    static FileNotFound() {
      return new FileSystemError('FileNotFound');
    }

    static NoPermissions() {
      return new FileSystemError('NoPermissions');
    }
  }

  return {
    Uri: {
      file: URI.file,
      joinPath: Utils.joinPath,
    },
    FileSystemError,
    workspace: {
      fs: {
        readFile: mocks.readFile,
        writeFile: mocks.writeFile,
        createDirectory: mocks.createDirectory,
      },
      getConfiguration: (section: string) => ({
        get: () => (section === 'remote' ? mocks.configFile : 'testuser'),
      }),
    },
    window: {
      showInformationMessage: mocks.showInformationMessage,
    },
  };
});

let configManager: ConfigManager;

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tailscale-sshconfig-'));
  mocks.configFile = undefined;
  configManager = new ConfigManager(path.join(mocks.homeDir, 'extension-config.json'));
  mocks.readFile.mockImplementation(async (uri: vscode.Uri) => {
    try {
      return await fs.readFile(uri.fsPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw error;
    }
  });
  mocks.createDirectory.mockImplementation((uri: vscode.Uri) =>
    fs.mkdir(uri.fsPath, { recursive: true })
  );
  mocks.writeFile.mockImplementation((uri: vscode.Uri, contents: Uint8Array) =>
    fs.writeFile(uri.fsPath, contents)
  );
});

afterEach(async () => {
  await fs.rm(mocks.homeDir, { recursive: true, force: true });
});

test('declining to save a missing SSH config leaves SSH files unchanged', async () => {
  mocks.showInformationMessage.mockResolvedValue('No');

  await syncSSHConfig('host.example.ts.net', configManager);

  expect(mocks.showInformationMessage).toHaveBeenCalledOnce();
  expect(mocks.createDirectory).not.toHaveBeenCalled();
  expect(mocks.writeFile).not.toHaveBeenCalled();
  expect(configManager.config.hosts?.['host.example.ts.net'].persistToSSHConfig).toBe(false);
});

test.each(['default', 'custom'])(
  'creates a missing %s SSH config after consent',
  async (location) => {
    const configPath =
      location === 'default'
        ? path.join(mocks.homeDir, '.ssh', 'config')
        : path.join(mocks.homeDir, 'custom', 'ssh', 'config');
    if (location === 'custom') {
      mocks.configFile = configPath;
    }
    mocks.showInformationMessage.mockResolvedValue('Yes');

    await syncSSHConfig('host.example.ts.net', configManager);

    const saved = SSHConfig.parse(await fs.readFile(configPath, 'utf8'));
    expect(saved.compute('host.example.ts.net')).toMatchObject({
      HostName: 'host.example.ts.net',
      User: 'testuser',
    });
    expect(configManager.config.hosts?.['host.example.ts.net'].persistToSSHConfig).toBe(true);
  }
);

test('preserves existing SSH config entries when adding a host', async () => {
  const configPath = path.join(mocks.homeDir, '.ssh', 'config');
  await fs.mkdir(path.dirname(configPath));
  await fs.writeFile(
    configPath,
    '# Keep this comment\nHost existing\n  HostName existing.example\n'
  );
  mocks.showInformationMessage.mockResolvedValue('Yes');

  await syncSSHConfig('host.example.ts.net', configManager);

  const contents = await fs.readFile(configPath, 'utf8');
  expect(contents).toContain('# Keep this comment');
  expect(SSHConfig.parse(contents).compute('existing').HostName).toBe('existing.example');
  expect(SSHConfig.parse(contents).compute('host.example.ts.net').User).toBe('testuser');
});

test('propagates read errors other than a missing file without prompting or writing', async () => {
  const error = vscode.FileSystemError.NoPermissions();
  mocks.readFile.mockRejectedValue(error);

  await expect(syncSSHConfig('host.example.ts.net', configManager)).rejects.toBe(error);

  expect(mocks.showInformationMessage).not.toHaveBeenCalled();
  expect(mocks.createDirectory).not.toHaveBeenCalled();
  expect(mocks.writeFile).not.toHaveBeenCalled();
});
