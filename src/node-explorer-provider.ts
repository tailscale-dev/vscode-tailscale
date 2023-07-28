/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import { Peer } from './types';
import { Tailscale } from './tailscale/cli';
import { TSFileSystemProvider } from './ts-file-system-provider';
import { SSH } from './utils/ssh';
import { ConfigManager } from './config-manager';

export class NodeExplorerProvider
  implements
    vscode.TreeDataProvider<PeerBaseTreeItem>,
    vscode.TreeDragAndDropController<PeerBaseTreeItem>
{
  dropMimeTypes = ['text/uri-list']; // add 'application/vnd.code.tree.testViewDragAndDrop' when we have file explorer
  dragMimeTypes = [];

  private _onDidChangeTreeData: vscode.EventEmitter<(PeerBaseTreeItem | undefined)[] | undefined> =
    new vscode.EventEmitter<PeerBaseTreeItem[] | undefined>();

  // We want to use an array as the event type, but the API for this is currently being finalized. Until it's finalized, use any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

  private peers: { [hostName: string]: Peer } = {};
  private fsProvider: TSFileSystemProvider;

  constructor(
    private readonly ts: Tailscale,
    private readonly configManager: ConfigManager,
    private ssh: SSH
  ) {
    this.fsProvider = new TSFileSystemProvider();

    this.registerDeleteCommand();
    this.registerCopyIPv4Command();
    this.registerCopyIPv6Command();
    this.registerCopyHostnameCommand();
    this.registerOpenTerminalCommand();
    this.registerOpenRemoteCodeCommand();
    this.registerOpenRemoteCodeLocationCommand();
    this.registerOpenNodeDetailsCommand();
    this.registerRefresh();
  }

  onDidChangeFileDecorations?: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> | undefined;

  getTreeItem(element: PeerBaseTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PeerBaseTreeItem): Promise<PeerBaseTreeItem[]> {
    // File Explorer
    if (element instanceof FileExplorer) {
      const dirents = await vscode.workspace.fs.readDirectory(element.uri);
      return dirents.map(([name, type]) => {
        const childUri = element.uri.with({ path: `${element.uri.path}/${name}` });
        return new FileExplorer(name, childUri, type, 'child');
      });
    }

    // Node root
    if (element instanceof PeerTree) {
      const { hosts } = this.configManager?.config || {};
      let rootDir = hosts?.[element.HostName]?.rootDir;
      let dirDesc = rootDir;
      const homeDir = (await this.ssh.executeCommand(element.HostName, 'echo', ['~'])).trim();
      if (rootDir && rootDir !== '~') {
        dirDesc = trimPathPrefix(rootDir, homeDir);
      } else {
        rootDir = homeDir;
        dirDesc = '~';
      }
      const uri = vscode.Uri.parse(`ts://${element.TailnetName}/${element.HostName}/${rootDir}`);
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

      const peers: PeerTree[] = [];
      try {
        const status = await this.ts.serveStatus(true);
        if (status.Errors && status.Errors.length) {
          // TODO: return a proper error
          return [];
        }
        status.Peers?.forEach((p) => {
          this.peers[p.HostName] = p;
          peers.push(new PeerTree({ ...p }));
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        vscode.window.showErrorMessage(`unable to fetch status ${e.message}`);
        console.error(`Error fetching status: ${e}`);
      }

      return peers;
    }
  }

  public async handleDrop(target: FileExplorer, dataTransfer: vscode.DataTransfer): Promise<void> {
    // TODO: figure out why the progress bar doesn't show up
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        cancellable: false,
        title: 'Tailscale',
      },
      async (progress) => {
        dataTransfer.forEach(async ({ value }) => {
          const uri = vscode.Uri.parse(value);

          try {
            await this.fsProvider.scp(uri, target?.uri);
          } catch (e) {
            vscode.window.showErrorMessage(`unable to copy ${uri} to ${target?.uri}`);
            console.error(`Error copying ${uri} to ${target?.uri}: ${e}`);
          }

          progress.report({ increment: 100 });
          this._onDidChangeTreeData.fire([target]);
        });
      }
    );

    if (!target) {
      return;
    }
  }

  public async handleDrag(
    source: PeerTree[],
    treeDataTransfer: vscode.DataTransfer,
    _: vscode.CancellationToken
  ): Promise<void> {
    treeDataTransfer.set(
      'application/vnd.code.tree.testViewDragAndDrop',
      new vscode.DataTransferItem(source)
    );
  }

  registerDeleteCommand() {
    vscode.commands.registerCommand('tailscale.node.fs.delete', this.delete.bind(this));
  }

  registerOpenRemoteCodeLocationCommand() {
    vscode.commands.registerCommand(
      'tailscale.node.openRemoteCodeAtLocation',
      async (file: FileExplorer) => {
        const { hostname, resourcePath } = this.fsProvider.extractHostAndPath(file.uri);
        if (!hostname || !resourcePath) {
          return;
        }

        // TODO: handle non-absolute paths
        this.openRemoteCodeLocationWindow(hostname, resourcePath, false);
      }
    );
  }

  registerCopyIPv4Command() {
    vscode.commands.registerCommand('tailscale.node.copyIPv4', async (node: PeerTree) => {
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
    vscode.commands.registerCommand('tailscale.node.copyIPv6', async (node: PeerTree) => {
      const ip = node.TailscaleIPs[1];
      await vscode.env.clipboard.writeText(ip);
      vscode.window.showInformationMessage(`Copied ${ip} to clipboard.`);
    });
  }

  registerCopyHostnameCommand() {
    vscode.commands.registerCommand('tailscale.node.copyHostname', async (node: PeerTree) => {
      const name = node.HostName;
      await vscode.env.clipboard.writeText(name);
      vscode.window.showInformationMessage(`Copied ${name} to clipboard.`);
    });
  }

  registerOpenTerminalCommand() {
    vscode.commands.registerCommand('tailscale.node.openTerminal', async (node: PeerTree) => {
      const t = vscode.window.createTerminal(node.HostName);
      t.sendText(`ssh ${this.ssh.sshHostnameWithUser(node.HostName)}`);
      t.show();
    });
  }

  registerOpenRemoteCodeCommand() {
    vscode.commands.registerCommand('tailscale.node.openRemoteCode', async (node: PeerTree) => {
      this.openRemoteCodeWindow(node.HostName, false);
    });
  }

  registerOpenNodeDetailsCommand() {
    vscode.commands.registerCommand('tailscale.node.openDetailsLink', async (node: PeerTree) => {
      vscode.env.openExternal(
        vscode.Uri.parse(`https://login.tailscale.com/admin/machines/${node.TailscaleIPs[0]}`)
      );
    });
  }

  registerRefresh(): void {
    vscode.commands.registerCommand('tailscale.nodeExplorer.refresh', () => {
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  openRemoteCodeWindow(host: string, reuseWindow: boolean) {
    vscode.commands.executeCommand('vscode.newWindow', {
      remoteAuthority: `ssh-remote+${host}`,
      reuseWindow,
    });
  }

  openRemoteCodeLocationWindow(host: string, path: string, reuseWindow: boolean) {
    vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.from({ scheme: 'vscode-remote', authority: `ssh-remote+${host}`, path }),
      { forceNewWindow: !reuseWindow }
    );
  }

  async delete(file: FileExplorer) {
    try {
      await vscode.workspace.fs.delete(file.uri);
      vscode.window.showInformationMessage(`${file.label} deleted successfully.`);

      const normalizedPath = path.normalize(file.uri.toString());
      const parentDir = path.dirname(normalizedPath);
      const dirName = path.basename(parentDir);

      const parentFileExplorerItem = new FileExplorer(
        dirName,
        vscode.Uri.parse(parentDir),
        vscode.FileType.Directory
      );

      this._onDidChangeTreeData.fire([parentFileExplorerItem]);
    } catch (e) {
      vscode.window.showErrorMessage(`Could not delete ${file.label}: ${e}`);
    }
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

    if (type === vscode.FileType.File) {
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [this.uri],
      };
    }

    this.contextValue = `file-explorer-item${context ? '-' : ''}${context}`;
  }
}

export class PeerTree extends PeerBaseTreeItem {
  public ID: string;
  public HostName: string;
  public TailscaleIPs: string[];
  public TailnetName: string;

  public constructor(obj: Peer) {
    super(obj.HostName);

    this.ID = obj.ID;
    this.HostName = obj.HostName;
    this.TailscaleIPs = obj.TailscaleIPs;
    this.TailnetName = obj.TailnetName;

    this.iconPath = {
      light: path.join(
        __filename,
        '..',
        '..',
        'resources',
        'light',
        obj.Online === true ? 'online.svg' : 'offline.svg'
      ),
      dark: path.join(
        __filename,
        '..',
        '..',
        'resources',
        'dark',
        obj.Online === true ? 'online.svg' : 'offline.svg'
      ),
    };

    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }

  contextValue = 'tailscale-peer-item';
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

// trimPathPrefix acts the same as a string trim prefix, but
// prepends ~ to trimmed paths.
function trimPathPrefix(s: string, prefix: string): string {
  if (s.startsWith(prefix)) {
    return `~${s.slice(prefix.length)}`;
  }
  return s;
}
