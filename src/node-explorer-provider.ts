/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import { Peer, PeerGroup } from './types';
import { Utils } from 'vscode-uri';
import { Tailscale } from './tailscale/cli';
import { ConfigManager } from './config-manager';
import { Logger } from './logger';
import { createTsUri, parseTsUri } from './utils/uri';
import { getUsername } from './utils/host';
import { FileSystemProvider } from './filesystem-provider';
import { trimSuffix } from './utils';
import { EXTENSION_NS } from './constants';
import { addToSSHConfig, syncSSHConfig } from './utils/sshconfig';

/**
 * Anatomy of the TreeView
 *
 * ├── PeerRoot
 * │   ├── PeerFileExplorer
 */
export class NodeExplorerProvider
  implements
    vscode.TreeDataProvider<PeerBaseTreeItem>,
    vscode.TreeDragAndDropController<FileExplorer>
{
  dropMimeTypes = ['text/uri-list', 'application/vnd.code.tree.tsFileEntry'];
  dragMimeTypes = ['application/vnd.code.tree.tsFileEntry'];

  private _onDidChangeTreeData: vscode.EventEmitter<
    (PeerBaseTreeItem | FileExplorer | undefined)[] | undefined
  > = new vscode.EventEmitter<PeerBaseTreeItem[] | undefined>();
  private showDotFiles: boolean | undefined;
  // We want to use an array as the event type, but the API for this is currently being finalized. Until it's finalized, use any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

  constructor(
    private readonly ts: Tailscale,
    private readonly configManager: ConfigManager,
    private fsProvider: FileSystemProvider,
    private updateNodeExplorerDisplayName: (title: string) => void
  ) {
    this.showDotFiles = vscode.workspace
      .getConfiguration(EXTENSION_NS)
      .get<boolean>('fileExplorer.showDotFiles');
    this.registerCopyDNSNameCommand();
    this.registerCopyIPv4Command();
    this.registerCopyIPv6Command();
    this.registerCreateDirectoryCommand();
    this.registerDeleteCommand();
    this.registerCreateFileCommand();
    this.registerRenameCommand();
    this.registerOpenNodeDetailsCommand();
    this.registerOpenRemoteCodeCommand();
    this.registerAddToSSHConfigCommand();
    this.registerOpenTerminalCommand();
    this.registerRefresh();
    this.registerOpenDocsLink();
    this.registerDownloadCommand();
  }

  getTreeItem(element: PeerBaseTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PeerBaseTreeItem): Promise<PeerBaseTreeItem[]> {
    if (element instanceof PeerErrorItem) {
      return [];
    }

    if (element instanceof PeerGroupItem) {
      return element.peerGroup.Peers.map((p) => {
        return new PeerRoot({ ...p }, element.tailnetName);
      });
    }

    // File Explorer
    if (element instanceof FileExplorer) {
      const dirents = await vscode.workspace.fs.readDirectory(element.uri);
      const filtered = dirents.reduce<FileExplorer[]>((acc, [name, type]) => {
        if (this.showDotFiles == false && name.startsWith('.')) {
          return acc;
        }
        const childUri = element.uri.with({ path: `${element.uri.path}/${name}` });
        acc.push(new FileExplorer(name, childUri, type));
        return acc;
      }, []);
      return filtered;
    }

    // Node root
    if (element instanceof PeerRoot) {
      if (!element.SSHEnabled) {
        return [
          new PeerErrorItem({
            label: 'Enable Tailscale SSH',
            link: 'https://tailscale.com/kb/1193/tailscale-ssh/#prerequisites',
            tooltip: 'You need Tailscale SSH in order to use the File Explorer with this node.',
          }),
        ];
      }
      const { hosts } = this.configManager?.config || {};
      let rootDir = hosts?.[element.Address]?.rootDir;
      let dirDesc = rootDir;
      try {
        const homeDir = await this.fsProvider.getHomeDirectory(element.Address);

        if (rootDir && rootDir !== '~') {
          dirDesc = trimPathPrefix(rootDir, homeDir);
        } else {
          rootDir = homeDir;
          dirDesc = '~';
        }
      } catch (e) {
        // TODO: properly handle expansion error.
        Logger.error(`error expanding PeerTree: ${e}`);
        rootDir = '~';
        dirDesc = '~';
      }

      const uri = createTsUri({
        tailnet: element.tailnetName,
        address: element.Address,
        resourcePath: rootDir,
      });

      return [
        new FileExplorer(
          'File explorer',
          uri,
          vscode.FileType.Directory,
          'root',
          undefined,
          dirDesc
        ),
      ];
    } else {
      // Peer List

      const groups: PeerGroupItem[] = [];
      let hasErr = false;
      try {
        const status = await this.ts.getPeers();
        if (status.Errors && status.Errors.length) {
          for (let index = 0; index < status.Errors.length; index++) {
            const err = status.Errors[index];
            switch (err.Type) {
              case 'NOT_RUNNING':
                return [
                  new PeerErrorItem({
                    label: 'Tailscale may not be installed. Install now',
                    link: 'https://tailscale.com/download',
                  }),
                ];
              case 'OFFLINE':
                return [
                  new PeerErrorItem({
                    label: 'Tailscale offline. Log in and try again',
                    tooltip: 'Make sure that Tailscale is installed and running',
                    link: 'https://tailscale.com/download',
                  }),
                ];
            }
          }
          return [];
        }

        // displayName is the name that shows up at the top of
        // the node explorer. It can either be the Tailent Name
        // or the MagicDNSName
        let displayName = status.CurrentTailnet.Name;

        // If the MagicDNS is enabled, and the tailnet name is an
        // email address (includes an @), use the MagicDNSName as
        // it makes more sense to show the MagicDNS name for multi-user
        // tailnets using a shared domain.
        if (
          status.CurrentTailnet.Name.includes('@') &&
          status.CurrentTailnet.MagicDNSEnabled &&
          status.CurrentTailnet.MagicDNSSuffix
        ) {
          const name = trimSuffix(status.CurrentTailnet.MagicDNSSuffix, '.');

          if (name) {
            displayName = name;
          }
        }

        this.updateNodeExplorerDisplayName(displayName);

        // If we only have a single group, don't indent it.
        // Just directly render all nodes. Trust TSRelay to
        // not send a group with empty peers.
        if (status.PeerGroups?.length == 1) {
          return status.PeerGroups[0].Peers.map((p) => {
            return new PeerRoot({ ...p }, status.CurrentTailnet.Name);
          });
          // Otherwise, go through each group (could be zero) and
          // create each category.
        } else {
          status.PeerGroups?.forEach((pg) => {
            groups.push(new PeerGroupItem(pg, status.CurrentTailnet.Name));
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        hasErr = true;
        vscode.window.showErrorMessage(`unable to fetch status ${e.message}`);
        console.error(`Error fetching status: ${e}`);
      }

      // If there are no groups at all, render an onboarding item.
      if (!hasErr && !groups.length) {
        return [
          new PeerErrorItem({
            label: 'Add your first node',
            tooltip: 'Click to read the docs to learn how to add your first node',
            link: 'https://tailscale.com/kb/1017/install/',
          }),
        ];
      }

      return groups;
    }
  }

  /**
   * Refresh based on what target is provided.
   *
   * If no target is provided, refresh the entire tree
   * If all targets are directories, call refresh on each target.
   *
   * TODO: If a target is a file, refresh the parent directory.
   */
  refresh(target?: FileExplorer | FileExplorer[]) {
    if (Array.isArray(target)) {
      if (target.every((item) => item.type === vscode.FileType.Directory)) {
        for (const item of target) {
          this._onDidChangeTreeData.fire([item]);
        }
      } else {
        this._onDidChangeTreeData.fire(undefined);
      }
    } else if (target && target.type === vscode.FileType.Directory) {
      // If 'target' is a single object
      this._onDidChangeTreeData.fire([target]);
    } else {
      // If 'target' is undefined
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  public async handleDrop(
    target: FileExplorer | undefined,
    sources: vscode.DataTransfer,
    _: vscode.CancellationToken
  ): Promise<void> {
    if (!target) {
      return;
    }

    let transferItem = sources.get('application/vnd.code.tree.tsFileEntry');
    if (transferItem && transferItem.value) {
      const source: FileExplorer = transferItem.value[0];
      return this.moveFile(source.uri, target);
    }

    transferItem = sources.get('text/uri-list');
    if (transferItem && transferItem.value) {
      transferItem.value.split('\r\n').forEach((uri: string) => {
        return this.transferFile(vscode.Uri.parse(uri), target);
      });
    }

    sources.forEach(({ value }, mimeType) => {
      switch (mimeType) {
        case 'application/vnd.code.tree.tsFileEntry':
          return this.transferFile(value.uri, target);

        // From the @types/vscode package: text/uri-list
        //   A string with `toString()`ed Uris separated by `\r\n`.
        case 'text/uri-list':
          value.split('\r\n').forEach((uri: string) => {
            return this.transferFile(vscode.Uri.parse(uri), target);
          });
          return;

        default:
          return;
      }
    });
  }

  /**
   * Move a file from within a node or across nodes.
   */
  async moveFile(source: vscode.Uri, target: FileExplorer) {
    const { address: sourceAddr } = parseTsUri(source);
    const { address: targetAddr, resourcePath: targetResourcePath } = parseTsUri(target.uri);

    const sourceFilename = source.path.split('/').pop();
    let title = `moving ${sourceFilename}`;

    if (sourceAddr !== targetAddr) {
      title += ` from ${sourceAddr} to ${targetAddr}`;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        cancellable: false,
        title,
      },
      async (progress) => {
        progress.report({ increment: 0 });

        try {
          if (sourceAddr !== targetAddr) {
            // move across nodes
            const contents = await vscode.workspace.fs.readFile(source);
            const fileName = path.basename(source.toString());
            const targetFile = target.getDirectory(fileName);

            const sourceStat = await this.fsProvider.stat(source);
            console.log('source', sourceStat);

            await this.fsProvider.writeFile(targetFile, contents, {
              create: true,
              overwrite: false,
            });

            // confirm that the file was written successfully before deleting
            // the source file.
            const targetStat = await this.fsProvider.stat(targetFile);

            if (sourceStat.size === targetStat.size) {
              await this.fsProvider.delete(source, { recursive: false });
            } else {
              this.fsProvider.delete(targetFile, { recursive: false });

              const message = `target removed due to the size differing after upload (${sourceStat.size} and ${targetStat.size})`;
              throw new Error(message);
            }
          } else {
            // move within the same node
            const sourceFilename = source.path.split('/').pop();
            const fileTarget = target.getDirectory(sourceFilename);

            await this.fsProvider.rename(source, fileTarget, { overwrite: true });
          }
        } catch (e) {
          vscode.window.showErrorMessage(`Error moving file, check logs for more information`);
          Logger.error(`error moving file: ${e}`);
        }

        // refresh all, as we don't have the target element in the tree until we index by uri
        this.refresh();

        progress.report({ increment: 100 });
      }
    );
  }

  /**
   * Transfer a file from the local filesystem to a node.
   */
  async transferFile(source: vscode.Uri, target: FileExplorer) {
    const { address, resourcePath } = parseTsUri(target.uri);
    const sourceFilename = source.path.split('/').pop();

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        cancellable: false,
        title: `uploading ${sourceFilename} to ${address}${resourcePath}`,
      },
      async (progress) => {
        progress.report({ increment: 0 });
        try {
          const fileTarget = target.getDirectory(sourceFilename);
          await this.fsProvider.upload(source, fileTarget);

          this.refresh(target);
        } catch (e) {
          vscode.window.showErrorMessage(`Error writing file, check logs for more information`);
          Logger.error(`error writing file: ${e}`);
        }
        progress.report({ increment: 100 });
      }
    );
  }

  public async handleDrag(
    source: FileExplorer[],
    treeDataTransfer: vscode.DataTransfer,
    _: vscode.CancellationToken
  ): Promise<void> {
    treeDataTransfer.set(
      'application/vnd.code.tree.tsFileEntry',
      new vscode.DataTransferItem(source)
    );
  }

  registerDownloadCommand() {
    vscode.commands.registerCommand(
      'tailscale.node.downloadRemoteFile',
      async (file: FileExplorer) => {
        return vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            cancellable: false,
            title: 'Tailscale is downloading your file...',
          },
          async (progress) => {
            progress.report({ increment: 0 });
            try {
              const workspacePath = vscode.workspace.workspaceFolders?.at(0)?.uri.path;
              if (!workspacePath) {
                return;
              }
              const fileContent = await vscode.workspace.fs.readFile(file.uri);
              const fileName = path.basename(file.uri.toString());
              const targetPath = workspacePath + '/' + fileName;
              const localPath = vscode.Uri.file(targetPath);
              await vscode.workspace.fs.writeFile(localPath, fileContent);
            } catch (e) {
              vscode.window.showErrorMessage(`Could not download ${file.label}: ${e}`);
            }
            progress.report({ increment: 100 });
          }
        );
      }
    );
  }

  registerDeleteCommand() {
    vscode.commands.registerCommand('tailscale.node.fs.delete', async (file: FileExplorer) => {
      try {
        const msg = `Are you sure you want to delete ${
          file.type === vscode.FileType.Directory ? 'this directory' : 'this file'
        }? This action cannot be undone.`;

        const answer = await vscode.window.showInformationMessage(msg, { modal: true }, 'Yes');

        if (answer !== 'Yes') {
          return;
        }

        await vscode.workspace.fs.delete(file.uri);
        vscode.window.showInformationMessage(`${file.label} deleted successfully.`);

        this._onDidChangeTreeData.fire([undefined]);
      } catch (e) {
        vscode.window.showErrorMessage(`Could not delete ${file.label}: ${e}`);
      }
    });
  }

  registerCreateFileCommand() {
    vscode.commands.registerCommand('tailscale.node.fs.createFile', async (node: FileExplorer) => {
      const { address, tailnet, resourcePath } = parseTsUri(node.uri);
      if (!address || !resourcePath) {
        return;
      }

      let targetPath = resourcePath;

      const targetName = await vscode.window.showInputBox({
        prompt: 'Enter a name for the new file',
        placeHolder: 'New file.txt',
      });

      if (!targetName) {
        return;
      }

      if (node.type !== vscode.FileType.Directory) {
        targetPath = path.dirname(resourcePath);
      }

      const newUri = createTsUri({
        tailnet,
        address,
        resourcePath: `${targetPath}/${targetName}`,
      });

      try {
        await vscode.workspace.fs.writeFile(newUri, new Uint8Array());
        this._onDidChangeTreeData.fire([
          node.type !== vscode.FileType.Directory ? undefined : node,
        ]);
      } catch (e) {
        vscode.window.showErrorMessage(`Could not create directory: ${e}`);
      }
    });
  }

  registerRenameCommand() {
    vscode.commands.registerCommand('tailscale.node.fs.rename', async (node: FileExplorer) => {
      const source = node.uri;

      const newName = await vscode.window.showInputBox({
        prompt: 'Enter a new name for the file',
        value: source.path.split('/').pop() || '',
      });

      if (!newName) {
        return;
      }

      try {
        const target = Utils.joinPath(source, '..', newName);
        await vscode.workspace.fs.rename(source, target);

        this._onDidChangeTreeData.fire([undefined]);
      } catch (e) {
        vscode.window.showErrorMessage(`Could not rename: ${e}`);
      }
    });
  }

  registerCreateDirectoryCommand() {
    vscode.commands.registerCommand(
      'tailscale.node.fs.createDirectory',
      async (node: FileExplorer) => {
        const { address, tailnet, resourcePath } = parseTsUri(node.uri);
        if (!address || !resourcePath) {
          return;
        }

        let targetPath = resourcePath;

        // TODO: validate input
        const targetName = await vscode.window.showInputBox({
          prompt: 'Enter a name for the new directory',
          placeHolder: 'New directory',
        });

        if (!targetName) {
          return;
        }

        if (node.type !== vscode.FileType.Directory) {
          const lastSlashIndex = resourcePath.lastIndexOf('/');
          targetPath = resourcePath.substring(0, lastSlashIndex);
        }

        const newUri = createTsUri({
          tailnet,
          address,
          resourcePath: `${targetPath}/${targetName}`,
        });

        try {
          await vscode.workspace.fs.createDirectory(newUri);
          this._onDidChangeTreeData.fire([
            node.type !== vscode.FileType.Directory ? undefined : node,
          ]);
        } catch (e) {
          vscode.window.showErrorMessage(`Could not create directory: ${e}`);
        }
      }
    );
  }

  registerCopyIPv4Command() {
    vscode.commands.registerCommand('tailscale.node.copyIPv4', async (node: PeerRoot) => {
      const ip = node.TailscaleIPs[0];

      if (!ip) {
        vscode.window.showErrorMessage(`No IPv4 address found for ${node.HostName}.`);
        return;
      }

      await vscode.env.clipboard.writeText(ip);
      vscode.window.showInformationMessage(`Copied ${ip} to clipboard.`);
    });
  }

  registerCopyIPv6Command() {
    vscode.commands.registerCommand('tailscale.node.copyIPv6', async (node: PeerRoot) => {
      const ip = node.TailscaleIPs[1];
      await vscode.env.clipboard.writeText(ip);
      vscode.window.showInformationMessage(`Copied ${ip} to clipboard.`);
    });
  }

  registerCopyDNSNameCommand() {
    vscode.commands.registerCommand('tailscale.node.copyDNSName', async (node: PeerRoot) => {
      const name = node.DNSName;
      await vscode.env.clipboard.writeText(name);
      vscode.window.showInformationMessage(`Copied ${name} to clipboard.`);
    });
  }

  registerOpenTerminalCommand() {
    vscode.commands.registerCommand(
      'tailscale.node.openTerminal',
      async (node: PeerRoot | FileExplorer) => {
        const { addr, path } = extractAddrAndPath(node);

        if (!addr) {
          return;
        }

        const t = vscode.window.createTerminal(addr);
        t.sendText(`ssh ${getUsername(this.configManager, addr)}@${addr}`);

        if (path) {
          t.sendText(`cd ${path}`);
        }

        t.show();
      }
    );
  }

  registerOpenRemoteCodeCommand() {
    vscode.commands.registerCommand(
      'tailscale.node.openRemoteCode',
      async (node: PeerRoot | FileExplorer) => {
        const { addr, path } = extractAddrAndPath(node);

        if (addr && this.configManager.config.hosts?.[addr].persistToSSHConfig !== false) {
          await syncSSHConfig(addr, this.configManager);
        }

        if (node instanceof PeerRoot && addr) {
          vscode.commands.executeCommand('vscode.newWindow', {
            remoteAuthority: `ssh-remote+${addr}`,
            reuseWindow: false,
          });
        } else if (node instanceof FileExplorer && addr) {
          vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.from({
              scheme: 'vscode-remote',
              authority: `ssh-remote+${addr}`,
              path,
            }),
            { forceNewWindow: true }
          );
        }
      }
    );
  }

  registerAddToSSHConfigCommand() {
    vscode.commands.registerCommand('tailscale.node.addToSSHConfig', async (node: PeerRoot) => {
      addToSSHConfig(
        this.configManager,
        node.Address,
        getUsername(this.configManager, node.Address)
      );
    });
  }

  registerOpenNodeDetailsCommand() {
    vscode.commands.registerCommand('tailscale.node.openDetailsLink', async (node: PeerRoot) => {
      vscode.env.openExternal(
        vscode.Uri.parse(`https://login.tailscale.com/admin/machines/${node.TailscaleIPs[0]}`)
      );
    });
  }

  registerRefresh(): void {
    vscode.commands.registerCommand(
      'tailscale.nodeExplorer.refresh',
      (f: FileExplorer | undefined) => {
        this._onDidChangeTreeData.fire([f]);
      }
    );
  }

  registerOpenDocsLink(): void {
    vscode.commands.registerCommand('tailscale.node.openDocsLink', (e: PeerErrorItem) => {
      Logger.info('called tailscale.openDocsLink', 'command');

      if (!e.link) {
        Logger.error('no link provided to openDocsLink', 'command');
        return;
      }

      vscode.env.openExternal(vscode.Uri.parse(e.link));
    });
  }
}

export class PeerBaseTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(vscode.Uri.parse(`ts://${label}`));
    this.label = label;
  }
}

export class FileExplorer extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly uri: vscode.Uri,
    public readonly type: vscode.FileType,
    public readonly context?: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = type ===
    vscode.FileType.Directory
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
    public readonly description: string = ''
  ) {
    super(label, collapsibleState);

    if (type === vscode.FileType.File || vscode.FileType.SymbolicLink) {
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [this.uri],
      };
    }

    const typeDesc = type === vscode.FileType.File ? 'file' : 'dir';
    this.contextValue = `peer-file-explorer-${typeDesc}${context ? `-${context}` : ''}`;
  }

  getDirectory(fileName?: string): vscode.Uri {
    let resourcePath = this.uri.toString();
    if (this.type !== vscode.FileType.Directory) {
      const lastSlashIndex = resourcePath.lastIndexOf('/');
      resourcePath = resourcePath.substring(0, lastSlashIndex);
    }
    if (fileName) {
      resourcePath += '/' + fileName;
    }
    return vscode.Uri.parse(resourcePath);
  }
}

export class PeerRoot extends PeerBaseTreeItem {
  public ID: string;
  public HostName: string;
  public TailscaleIPs: string[];
  public DNSName: string;
  public SSHEnabled: boolean;
  public tailnetName: string;
  public Address: string;
  public ServerName: string;

  public constructor(p: Peer, tailnetName: string) {
    super(p.ServerName);

    this.ID = p.ID;
    this.ServerName = p.ServerName;
    this.Address = p.Address;
    this.HostName = p.HostName;
    this.TailscaleIPs = p.TailscaleIPs;
    this.DNSName = p.DNSName;
    this.SSHEnabled = p.SSHEnabled;
    this.tailnetName = tailnetName;

    if (p.IsExternal) {
      // localapi currently does not return the tailnet name for a node,
      // so this is what we have to do to determine it.
      const re = new RegExp('^' + p.ServerName + '\\.');
      this.description = trimSuffix(this.DNSName.replace(re, ''), '.');
    }

    this.iconPath = {
      light: path.join(
        __filename,
        '..',
        '..',
        'resources',
        'light',
        p.Online === true ? 'online.svg' : 'offline.svg'
      ),
      dark: path.join(
        __filename,
        '..',
        '..',
        'resources',
        'dark',
        p.Online === true ? 'online.svg' : 'offline.svg'
      ),
    };

    const displayDNSName = trimSuffix(this.DNSName, '.');

    if (p.Online) {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      this.tooltip = `${displayDNSName} is online`;
    } else {
      this.tooltip = `${displayDNSName} is offline`;
    }
  }

  contextValue = 'peer-root';
}

export class PeerGroupItem extends PeerBaseTreeItem {
  public constructor(
    public readonly peerGroup: PeerGroup,
    public readonly tailnetName: string
  ) {
    super(peerGroup.Name);
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  }
  contextValue = 'peer-group-item';
}

export class PeerDetailTreeItem extends PeerBaseTreeItem {
  constructor(label: string, description: string, contextValue?: string) {
    super(label);
    this.description = description;
    this.label = label;
    if (contextValue) {
      this.contextValue = contextValue;
    }
  }
}

export class PeerErrorItem extends vscode.TreeItem {
  public link?: string;

  constructor(opts: { label: string; iconPath?: string; link?: string; tooltip?: string }) {
    super(opts.label);

    this.link = opts.link;

    this.iconPath = new vscode.ThemeIcon(opts?.iconPath || 'alert');

    this.tooltip = opts.tooltip;

    this.contextValue = `peer-error${opts.link && '-link'}`;
  }
}

// trimPathPrefix is the same as a string trim prefix, but
// prepends ~ to trimmed paths.
function trimPathPrefix(s: string, prefix: string): string {
  if (s.startsWith(prefix)) {
    return `~${s.slice(prefix.length)}`;
  }
  return s;
}

function extractAddrAndPath(node: PeerRoot | FileExplorer): { addr?: string; path?: string } {
  if (node instanceof FileExplorer) {
    const { address, resourcePath } = parseTsUri(node.uri);
    return { addr: address, path: resourcePath };
  } else if (node instanceof PeerRoot) {
    return { addr: node.Address };
  }
  return {};
}
