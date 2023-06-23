/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import * as util from 'node:util';
import * as child_process from 'node:child_process';
import { Status, Peer } from './types';
import { Tailscale } from './tailscale/cli';

const exec = util.promisify(child_process.exec);

// NodeExplorerProvider serves as a TreeDataProvider for PeerTree items.
export class NodeExplorerProvider implements vscode.TreeDataProvider<PeerBaseTreeItem> {
  constructor(private readonly ts: Tailscale) {}

  getTreeItem(element: PeerBaseTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PeerBaseTreeItem): Promise<PeerBaseTreeItem[]> {
    if (element instanceof PeerTree) {
      // If a PeerTree is provided, return its details
      return [
        new PeerDetailTreeItem('Hostname', element.HostName, 'tailscale-peer-item-hostname'),
        new PeerDetailTreeItem('IPv6', element.TailscaleIPs[0], 'tailscale-peer-item-ip'),
        ...(element.TailscaleIPs[1]
          ? [new PeerDetailTreeItem('IPv4', element.TailscaleIPs[1], 'tailscale-peer-item-ip')]
          : []),
      ];
    } else {
      // Otherwise, return the top-level nodes (peers)
      const peers: PeerTree[] = [];

      try {
        const status = await this.ts.status();

        for (const key in status.Peer) {
          const p = status.Peer[key];
          peers.push(new PeerTree({ ...p }));
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`unable to fetch status ${e.message}`);
        console.error(`Error fetching status: ${e}`);
      }

      return peers;
    }
  }
}

export class PeerBaseTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label);
  }
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
    if (contextValue) {
      this.contextValue = contextValue;
    }
  }
}
