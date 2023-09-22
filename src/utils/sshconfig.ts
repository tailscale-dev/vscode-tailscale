import * as vscode from 'vscode';
import * as SSHConfig from 'ssh-config';
import * as os from 'os';
import { ConfigManager } from '../config-manager';
import { getUsername } from './host';

function sshConfigFilePath() {
  const filePath = vscode.workspace.getConfiguration('remote').get<string>('SSH.configFile');
  return filePath
    ? vscode.Uri.file(filePath)
    : vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), './.ssh/config');
}

async function readSSHConfig() {
  const configStr = await vscode.workspace.fs
    .readFile(sshConfigFilePath())
    .then((a) => Buffer.from(a).toString('utf-8'));

  return SSHConfig.parse(configStr);
}

export async function addToSSHConfig(configManager: ConfigManager, Host: string, User: string) {
  const config = await readSSHConfig();
  config.append({ Host, User, HostName: Host });
  await vscode.workspace.fs.writeFile(
    sshConfigFilePath(),
    Buffer.from(SSHConfig.stringify(config))
  );
  configManager.setForHost(Host, 'savedInSSHConfig', true);
  configManager.setForHost(Host, 'differentUserFromSSHConfig', false);
}

export async function syncSSHConfig(addr: string, configManager: ConfigManager) {
  const config = await readSSHConfig();
  const hosts = config
    // find all the hosts
    .filter((line): line is SSHConfig.Directive => {
      return (line as SSHConfig.Directive).param === 'Host';
    })
    // get all the host names
    .flatMap((hostDirective) => hostDirective.value)
    // get their effective computed option values
    // (this is necessary because a host might have multiple matching Host blocks,
    // and the effective options are computed by combining all of them)
    .map((h) => config.compute(h));

  const matchingHosts = hosts.filter((h) => h.HostName === addr);
  const tsUsername = getUsername(configManager, addr);
  if (matchingHosts.length === 0) {
    const add = await vscode.window.showInformationMessage(
      `Host ${addr} not found in SSH config file, would you like to add it?`,
      'Yes',
      'No'
    );
    if (add === 'Yes') {
      await addToSSHConfig(configManager, addr, tsUsername);
    } else {
      configManager.setForHost(addr, 'savedInSSHConfig', false);
    }
  } else if (!configManager.config.hosts?.[addr].differentUserFromSSHConfig) {
    for (const h of matchingHosts) {
      const cfgUsername = typeof h.User === 'string' ? h.User : h.User[0];
      const cfgHost = typeof h.Host === 'string' ? h.Host : h.Host[0];
      if (cfgUsername !== tsUsername) {
        const editHost = await vscode.window.showInformationMessage(
          `The SSH config file specifies a username (${cfgUsername}) for host ${addr} that
          is different from the SSH user configured in your Tailscale settings (${tsUsername}). Would you
          like to update one of them?`,
          'Update Tailscale settings',
          'Update SSH config file',
          'Do not update'
        );
        if (editHost === 'Update Tailscale settings') {
          configManager.setForHost(addr, 'user', cfgUsername);
          configManager.setForHost(addr, 'differentUserFromSSHConfig', false);
        } else if (editHost === 'Update SSH config file') {
          const section = config.find({ Host: cfgHost });
          if (section && 'config' in section) {
            for (const line of section.config) {
              if (line.type === SSHConfig.LineType.DIRECTIVE && line.param === 'User') {
                line.value = tsUsername;
                break;
              }
            }
            await vscode.workspace.fs.writeFile(
              sshConfigFilePath(),
              Buffer.from(SSHConfig.stringify(config))
            );
            configManager.setForHost(addr, 'differentUserFromSSHConfig', false);
          }
        } else {
          configManager.setForHost(addr, 'differentUserFromSSHConfig', true);
        }
      }
      // according to man ssh_config, ssh uses the first matching entry, so we can break here
      break;
    }
  }
}
