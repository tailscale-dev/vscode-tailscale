import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

import { fileExists } from '../utils';

import { EXTENSION_NS } from '../constants';

/**
 * Returns the absolute path to an existing tailscale command.
 */
export async function getTailscaleCommandPath(): Promise<string | undefined> {
  const command = getWorkspaceConfigTailscalePath();

  // TODO(all): inform user that path must be absolute
  if (command && path.isAbsolute(command)) {
    return command;
  }

  return await getDefaultTailscaleCommand();
}

async function getDefaultTailscaleCommand() {
  const tsCmd = 'tailscale';
  const pathValue = process.env.PATH || '';
  const pathFolderPaths = splitEnvValue(pathValue);
  const installDir = getDefaultInstallDirForPlatform();

  // resolve the default install location in case it's not on the PATH
  if (installDir) {
    pathFolderPaths.push(installDir);
  }

  const pathExts = getPathExts();

  const cmdFileNames = pathExts == null ? [tsCmd] : pathExts.map((ext) => tsCmd + ext);

  for (const pathFolderPath of pathFolderPaths) {
    for (const cmdFileName of cmdFileNames) {
      const cmdFilePath = path.join(pathFolderPath, cmdFileName);
      if (await fileExists(cmdFilePath)) {
        return cmdFilePath;
      }
    }
  }

  // nothing found
  return undefined;

  function getPathExts() {
    if (os.platform() === 'win32') {
      const pathExtValue = process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
      return splitEnvValue(pathExtValue);
    } else {
      return undefined;
    }
  }

  function splitEnvValue(value: string) {
    const pathSplitChar = os.platform() === 'win32' ? ';' : ':';
    return value
      .split(pathSplitChar)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  function getDefaultInstallDirForPlatform() {
    switch (os.platform()) {
      case 'win32':
        return 'C:\\Program Files\\Tailscale';
      case 'darwin':
        return '/Applications/Tailscale.app/Contents/MacOS';
      default:
        return undefined;
    }
  }
}

function getWorkspaceConfigTailscalePath() {
  const p = vscode.workspace.getConfiguration(EXTENSION_NS).get<string>('path');

  if (typeof p === 'string' && p.trim().length === 0) {
    return undefined;
  } else {
    return p;
  }
}
