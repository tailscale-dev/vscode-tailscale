/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import { FileInfo, Peer, Status } from './types';
import { Tailscale } from './tailscale/cli';
import { Logger } from './logger';

// NodeExplorerProvider serves as a TreeDataProvider for PeerTree items.
export class NodeExplorerProvider
  implements
    vscode.TreeDataProvider<PeerBaseTreeItem>,
    vscode.TreeDragAndDropController<PeerBaseTreeItem>,
    vscode.FileDecorationProvider
{
  dropMimeTypes = ['text/uri-list']; // add 'application/vnd.code.tree.testViewDragAndDrop' when we have file explorer
  dragMimeTypes = [];

  private _onDidChangeTreeData: vscode.EventEmitter<(PeerBaseTreeItem | undefined)[] | undefined> =
    new vscode.EventEmitter<PeerBaseTreeItem[] | undefined>();
  // We want to use an array as the event type, but the API for this is currently being finalized. Until it's finalized, use any.
  public onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
  disposable: vscode.Disposable;
  private peers: { [hostName: string]: Peer } = {};

  constructor(private readonly ts: Tailscale) {
    this.disposable = vscode.window.registerFileDecorationProvider(this);
  }

  dispoe() {
    this.disposable.dispose();
  }

  onDidChangeFileDecorations?: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> | undefined;
  provideFileDecoration(
    uri: vscode.Uri,
    _: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === 'tsobj') {
      const p = this.peers[uri.authority];
      if (p?.sshHostKeys?.length) {
        return {
          badge: '>_',
          tooltip: 'You can drag and drop files to this node',
        };
      }
    }
    return {};
  }

  getTreeItem(element: PeerBaseTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PeerBaseTreeItem): Promise<PeerBaseTreeItem[]> {
    if (element instanceof FileExplorer) {
      const files = await this.ts.exploreFiles(element.HostName, '$HOME');
      return files.map((f) => new FileEntry(f, element.HostName));
    }
    if (element instanceof FileEntry) {
      const files = await this.ts.exploreFiles(element.HostName, element.path);
      return files.map((f) => new FileEntry(f, element.HostName));
    }
    if (element instanceof PeerTree) {
      return [
        new PeerDetailTreeItem('Hostname', element.HostName, 'tailscale-peer-item-hostname'),
        new PeerDetailTreeItem('IPv6', element.TailscaleIPs[0], 'tailscale-peer-item-ip'),
        ...(element.TailscaleIPs[1]
          ? [new PeerDetailTreeItem('IPv4', element.TailscaleIPs[1], 'tailscale-peer-item-ip')]
          : []),
        new FileExplorer({ ...element }),
      ];
    } else {
      // Otherwise, return the top-level nodes (peers)
      const peers: PeerTree[] = [];

      try {
        const status = await this.ts.status();
        if (status.Errors && status.Errors.length) {
          // TODO: return a proper error
          return [];
        }
        for (const key in status.Peer) {
          const p = status.Peer[key];
          this.peers[p.HostName] = p;
          peers.push(new PeerTree({ ...p }));
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`unable to fetch status ${e.message}`);
        console.error(`Error fetching status: ${e}`);
      }

      return peers;
    }
  }

  public async handleDrop(
    target: PeerBaseTreeItem | undefined,
    sources: vscode.DataTransfer,
    _: vscode.CancellationToken
  ): Promise<void> {
    // sources.forEach(async (item) => {
    //   Logger.info(await item.asString());
    // });
    if (!target) {
      return;
    }
    const transferItem = sources.get('text/uri-list');
    if (!transferItem || !transferItem.value) {
      return;
    }

    if (target instanceof PeerTree) {
      // TODO: error handling
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          cancellable: false,
          title: 'Taildropping file...',
        },
        async (progress) => {
          progress.report({ increment: 0 });

          await this.ts.sendFile(transferItem.value, target.ID, '');

          progress.report({ increment: 100 });
        }
      );
      return;
    }
    if (target instanceof FileEntry && target.isDir) {
      // TODO: error handling
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          cancellable: false,
          title: 'Taildropping file...',
        },
        async (progress) => {
          progress.report({ increment: 0 });

          // TODO: if dropped on a file, copy to parent dir.
          await this.ts.sendFile(transferItem.value, target.HostName, target.path);

          progress.report({ increment: 100 });
          this._onDidChangeTreeData.fire([target]);
        }
      );
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
}

export class PeerBaseTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(vscode.Uri.parse(`tsobj://${label}`));
    this.label = label;
  }
}

// FileEntry represents a TreeItem for a file or directory
export class FileEntry extends PeerBaseTreeItem {
  public ID: string;
  public HostName: string;
  public path: string;
  public isDir: boolean;

  public constructor(obj: FileInfo, hostName: string) {
    super(obj.name);

    this.ID = obj.name;
    this.HostName = hostName;
    this.path = obj.path;
    this.isDir = obj.isDir;
    if (obj.isDir) {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    }
  }

  contextValue = 'tailscale-file-entry';
}

// FileExplorer represents a TreeItem for files
export class FileExplorer extends PeerBaseTreeItem {
  public ID: string;
  public HostName: string;

  public constructor(obj: Peer) {
    super('File Explorer');

    this.ID = obj.ID;
    this.HostName = obj.HostName;
    // Setting the collapsible state to Collapsed will make the node expandable
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }

  contextValue = 'tailscale-file-explorer';
}

// PeerTree represents a TreeItem for a Peer, containing data for display and navigation.
export class PeerTree extends PeerBaseTreeItem {
  public ID: string;
  public HostName: string;
  public TailscaleIPs: string[];

  public constructor(obj: Peer) {
    super(obj.HostName);

    this.ID = obj.ID;
    this.HostName = obj.HostName;
    this.TailscaleIPs = obj.TailscaleIPs;

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

    // Setting the collapsible state to Collapsed will make the node expandable
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
