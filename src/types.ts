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

interface RequestBase {
  id?: number;
  type: string;
  data?: unknown;
}

interface RelayRequestBase extends RequestBase {
  type: 'relayRequest';
  endpoint: string;
  method: string;
}

interface RelayServeRequest extends RelayRequestBase {
  endpoint: '/serve';
  method: 'GET' | 'POST' | 'DELETE';
}

interface WriteToClipboard extends RequestBase {
  type: 'writeToClipboard';
  data: {
    text: string;
  };
}

interface OpenLink extends RequestBase {
  type: 'openLink';
  data: {
    url: string;
  };
}

interface SudoPrompt {
  id?: number;
  type: 'sudoPrompt';
  operation: 'add' | 'delete';
  params?: ServeParams;
}

export type Message = RelayServeRequest | WriteToClipboard | OpenLink | SudoPrompt;
export type MessageWithId = Omit<Message, 'id'> & { id: number };

/**
 * Messages sent from the extension to the webview.
 */

interface ResponseBase {
  id?: number;
  type: string;
  data?: unknown;
  error?: string;
}

interface RelayResponseBase extends Omit<RelayRequestBase, 'type'>, Omit<ResponseBase, 'type'> {
  id?: number;
  endpoint: string;
  method: string;
  body?: unknown;
  error?: string;
}

export interface RelayServeResponse extends RelayResponseBase {
  type: 'relayResponse';
  body?: ServeStatus;
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

export type Responses = RelayServeResponse;
export type WebviewData = Responses | WebpackOk | WebpackInvalid | WebpackStillOk;
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
