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

export interface ServeStatus {
  ServeConfig?: ServeConfig;
  FunnelPorts?: number[];
  BackendState: string;
  Self: PeerStatus;
  Errors?: RelayError[];
}

interface RelayError {
  Type: string;
}

interface RelayErrorLink {
  title: string;
  url: string;
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

interface SetViewType {
  type: 'setViewType';
  params: {
    type: 'simple' | 'advanced';
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
  | SetViewType
  | WriteToClipboard
  | OpenLink;

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

interface ShowAdvancedView {
  type: 'showAdvancedView';
}

interface ShowSimpleView {
  type: 'showSimpleView';
}

export type WebviewData =
  | UpdateState
  | RefreshState
  | ShowAdvancedView
  | ShowSimpleView
  | WebpackOk
  | WebpackInvalid
  | WebpackStillOk;
export type WebviewEvent = Event & { data: WebviewData };

export interface NewPortNotification {
  message: string;
  port: number;
}
