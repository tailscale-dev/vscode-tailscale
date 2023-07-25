interface ServeHTTPSParams {
  protocol: 'https';
  port: number;
  mountPoint: string;
  source: string;
  funnel?: boolean;
}

interface ServeTCPParams {
  protocol: 'tcp' | 'tls-terminated-tcp';
  port: number;
  localPort: string;
  funnel?: boolean;
}

export type ServeParams = ServeHTTPSParams | ServeTCPParams;

export interface Handlers {
  Proxy: string;
}

export interface Peer {
  ID: string;
  HostName: string;
  Active?: boolean;
  Online?: boolean;
  TailscaleIPs: string[];
  sshHostKeys?: string[];
  ShareeNode?: boolean;
}

export interface Status extends WithErrors {
  Peer: {
    [key: string]: Peer;
  };
}

export interface ServeStatus extends WithErrors {
  ServeConfig?: ServeConfig;
  FunnelPorts?: number[];
  Services: {
    [port: number]: string;
  };
  BackendState: string;
  Self: PeerStatus;
}

export interface WithErrors {
  Errors?: RelayError[];
}

export interface RelayError {
  Type:
    | 'FUNNEL_OFF'
    | 'HTTPS_OFF'
    | 'OFFLINE'
    | 'REQUIRES_SUDO'
    | 'NOT_RUNNING'
    | 'FLATPAK_REQUIRES_RESTART';
}

interface PeerStatus {
  DNSName: string;
  Online: boolean;
}

export interface ServeConfig {
  TCP?: {
    [port: number]: {
      HTTPS: boolean;
    };
  };
  Web?: {
    [address: string]: {
      Handlers: Handlers;
    };
  };
  AllowFunnel?: {
    [address: string]: boolean;
  };
  Self?: {
    DNSName: string;
  };
}

export interface Version {
  majorMinorPatch: string;
  short: string;
  long: string;
  gitCommit: string;
  extraGitCommit: string;
  cap: number;
}

/**
 * Messages sent from the webview to the extension.
 */

interface RefreshState {
  type: 'refreshState';
}

interface DeleteServe {
  type: 'deleteServe';
  params: ServeParams;
}

interface AddServe {
  type: 'addServe';
  params: ServeParams;
}

interface ResetServe {
  type: 'resetServe';
}

interface SetFunnel {
  type: 'setFunnel';
  params: {
    port: string;
    allow: boolean;
  };
}

interface WriteToClipboard {
  type: 'writeToClipboard';
  params: {
    text: string;
  };
}

interface OpenLink {
  type: 'openLink';
  params: {
    url: string;
  };
}

export type Message =
  | RefreshState
  | DeleteServe
  | AddServe
  | ResetServe
  | SetFunnel
  | WriteToClipboard
  | OpenLink
  | SudoPrompt;

interface SudoPrompt {
  type: 'sudoPrompt';
  operation: 'add' | 'delete';
  params?: ServeParams;
}

/**
 * Messages sent from the extension to the webview.
 */

interface UpdateState {
  type: 'updateState';
  state: ServeConfig;
}

interface RefreshState {
  type: 'refreshState';
}

interface WebpackOk {
  type: 'webpackOk';
}

interface WebpackInvalid {
  type: 'webpackInvalid';
}

interface WebpackStillOk {
  type: 'webpackStillOk';
}

export type WebviewData = UpdateState | RefreshState | WebpackOk | WebpackInvalid | WebpackStillOk;
export type WebviewEvent = Event & { data: WebviewData };

export interface NewPortNotification {
  message: string;
  port: number;
}

export interface TSRelayDetails {
  address: string;
  nonce: string;
  port: string;
}

export interface FileInfo {
  name: string;
  isDir: boolean;
  path: string;
}
