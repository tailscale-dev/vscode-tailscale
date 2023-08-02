/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import { Peer } from './types';
import { Tailscale } from './tailscale/cli';
import { ConfigManager } from './config-manager';
import { Logger } from './logger';
import { createTsUri, parseTsUri } from './utils/uri';
import { getUsername } from './utils/host';
import { FileSystemProvider } from './filesystem-provider';

export class NodeExplorerProvider implements vscode.TreeDataProvider<PeerBaseTreeItem> {
  dropMimeTypes = ['text/uri-list']; // add 'application/vnd.code.tree.testViewDragAndDrop' when we have file explorer
  dragMimeTypes = [];

  private _onDidChangeTreeData: vscode.EventEmitter<(PeerBaseTreeItem | undefined)[] | undefined> =
    new vscode.EventEmitter<PeerBaseTreeItem[] | undefined>();

  // We want to use an array as the event type, but the API for this is currently being finalized. Until it's finalized, use any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

  refreshAll() {
    this._onDidChangeTreeData.fire(undefined);
  }

  private peers: { [hostName: string]: Peer } = {};

  constructor(
    private readonly ts: Tailscale,
    private readonly configManager: ConfigManager,
    private fsProvider: FileSystemProvider,
    private updateNodeExplorerTailnetName: (title: string) => void
  ) {
    this.registerCopyHostnameCommand();
    this.registerCopyIPv4Command();
    this.registerCopyIPv6Command();
    this.registerCreateDirectoryCommand();
    this.registerDeleteCommand();
    this.registerOpenNodeDetailsCommand();
    this.registerOpenRemoteCodeCommand();
    this.registerOpenRemoteCodeLocationCommand();
    this.registerOpenTerminalCommand();
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
      try {
        const homeDir = await this.fsProvider.getHomeDirectory(element.HostName);

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
        tailnet: element.TailnetName,
        hostname: element.HostName,
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

      const peers: PeerTree[] = [];
      try {
        const status = await this.ts.serveStatus(true);
        // TODO: return a proper error
        // Commented out because of funnel related errors
        // TODO: make two separate endpoints or we'd have
        // to filter out any funnel related errors here.
        // if (status.Errors && status.Errors.length) {
        //   return [];
        // }

        this.updateNodeExplorerTailnetName(status.Self.TailnetName);

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

  registerDeleteCommand() {
    vscode.commands.registerCommand('tailscale.node.fs.delete', this.delete.bind(this));
  }

  registerCreateDirectoryCommand() {
    vscode.commands.registerCommand(
      'tailscale.node.fs.createDirectory',
      async (node: FileExplorer) => {
        const { hostname, tailnet, resourcePath } = parseTsUri(node.uri);
        if (!hostname || !resourcePath) {
          return;
        }

        // TODO: validate input
        const dirName = await vscode.window.showInputBox({
          prompt: 'Enter a name for the new directory',
          placeHolder: 'New directory',
        });

        if (!dirName) {
          return;
        }

        const newUri = createTsUri({
          tailnet,
          hostname,
          resourcePath: `${resourcePath}/${dirName}`,
        });

        try {
          await vscode.workspace.fs.createDirectory(newUri);
          this._onDidChangeTreeData.fire([node]);
        } catch (e) {
          vscode.window.showErrorMessage(`Could not create directory: ${e}`);
        }
      }
    );
  }

  registerOpenRemoteCodeLocationCommand() {
    vscode.commands.registerCommand(
      'tailscale.node.openRemoteCodeAtLocation',
      async (file: FileExplorer) => {
        const { hostname, resourcePath } = parseTsUri(file.uri);
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
      t.sendText(`ssh ${getUsername(this.configManager, node.HostName)}@${node.HostName}`);
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
  public DNSName: string;

  public constructor(p: Peer) {
    super(p.HostName);

    this.ID = p.ID;
    this.HostName = p.HostName;
    this.TailscaleIPs = p.TailscaleIPs;
    this.TailnetName = p.TailnetName;
    this.DNSName = p.DNSName;

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

    const displayDNSName = this.DNSName.replace(/\.$/, '');

    if (p.Online) {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      this.tooltip = displayDNSName;
    } else {
      this.tooltip = `${displayDNSName} is offline`;
    }
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

// trimPathPrefix is the same as a string trim prefix, but
// prepends ~ to trimmed paths.
function trimPathPrefix(s: string, prefix: string): string {
  if (s.startsWith(prefix)) {
    return `~${s.slice(prefix.length)}`;
  }
  return s;
}
