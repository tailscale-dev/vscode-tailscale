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

  const config = SSHConfig.parse(configStr);

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

  return { config, hosts };
}

export async function addToSSHConfig(configManager: ConfigManager, HostName: string, User: string) {
  const { config, hosts } = await readSSHConfig();
  const matchingHosts = hosts.filter((h) => h.HostName === HostName);
  if (matchingHosts.length === 0) {
    config.append({ Host: HostName, User, HostName });
  } else {
    const h = matchingHosts[0];
    const cfgHost = typeof h.Host === 'string' ? h.Host : h.Host[0];
    const section = config.find({ Host: cfgHost });
    if (section && 'config' in section) {
      let added = false;
      for (const line of section.config) {
        if (line.type === SSHConfig.LineType.DIRECTIVE && line.param === 'User') {
          line.value = User;
          added = true;
          break;
        }
      }
      if (!added) {
        section.config.append({ User });
      }
    }
  }
  await vscode.workspace.fs.writeFile(
    sshConfigFilePath(),
    new Uint8Array(Buffer.from(SSHConfig.stringify(config)))
  );
  configManager.setForHost(HostName, 'persistToSSHConfig', true);
  configManager.setForHost(HostName, 'differentUserFromSSHConfig', false);
}

export async function syncSSHConfig(addr: string, configManager: ConfigManager) {
  const { config, hosts } = await readSSHConfig();

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
      configManager.setForHost(addr, 'persistToSSHConfig', false);
    }
  } else if (!configManager.config.hosts?.[addr].differentUserFromSSHConfig) {
    for (const h of matchingHosts) {
      const cfgUsername = typeof h.User === 'string' ? h.User : h.User[0];
      const cfgHost = typeof h.Host === 'string' ? h.Host : h.Host[0];
      if (cfgUsername !== tsUsername) {
        const editHost = await vscode.window.showInformationMessage(
          `The SSH config file specifies a username (${cfgUsername}) for host ${addr} that
          is different from the SSH user configured in the Tailscale extension (${tsUsername}). Would you
          like to update one of them?`,
          'Update extension',
          'Update SSH config',
          'Do nothing'
        );
        if (editHost === 'Update extension') {
          configManager.setForHost(addr, 'user', cfgUsername);
          configManager.setForHost(addr, 'differentUserFromSSHConfig', false);
        } else if (editHost === 'Update SSH config') {
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
              new Uint8Array(Buffer.from(SSHConfig.stringify(config)))
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
