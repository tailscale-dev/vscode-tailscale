import React, { useState, useEffect } from 'react';
import { VSCodeCheckbox, VSCodeLink, VSCodeButton } from '@vscode/webview-ui-toolkit/react';

import { vsCodeAPI } from '../../vscode-api';
import { SimpleView } from './simple-view';
import { trimSuffix } from '../../utils/string';
import { useServeStatusStore } from './store';
import { ServeConfig, Handlers, ServeParams } from '../../types';
import { PortInput } from './components/port-input';
import { PathInput } from './components/path-input';

export const App = () => {
  const { state, selectedAddress, showAdvanced } = useServeStatusStore();

  return (
    <div>
      {showAdvanced ? (
        <AdvancedView serveStatus={state} selectedAddress={selectedAddress} />
      ) : (
        <SimpleView />
      )}
    </div>
  );
};

function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  vsCodeAPI.postMessage({
    type: 'addServe',
    params: {
      protocol: 'https',
      port: 443,
      mountPoint: formData.get('mountPoint') as string,
      source: `http://127.0.0.1:${formData.get('port')}${formData.get('path')}` as string,
    },
  });
}

const ServeListMappings = ({ address, handlers, openSectionKey, setOpenSectionKey, funnel }) => {
  const isOpen = openSectionKey === address;
  const port = address.split(':')[1];
  // TODO(all): capture Funnel posts list from Capabilities property in status
  const canEnablefunnel = [443, 8443, 10000].indexOf(parseInt(port, 10)) > -1;

  const handleSectionClick = (e) => {
    e.stopPropagation();
    setOpenSectionKey(address);

    // persist the selection
    useServeStatusStore.setState({ selectedAddress: address });
  };

  function handleDelete(options: ServeParams) {
    vsCodeAPI.postMessage({
      type: 'deleteServe',
      params: options,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toggleFunnel(e: any) {
    vsCodeAPI.postMessage({
      type: 'setFunnel',
      params: { port, allow: e.target.checked },
    });
  }

  const DNSName = address.split(':')[0];

  return (
    <div className="pb-4">
      <div className="w-full flex">
        <div className="w-1/2 text-xl" onClick={handleSectionClick}>
          <div className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`}></div> Serve ports
          via HTTP ({port})
        </div>
        <div className="w-1/2 text-right">
          <VSCodeCheckbox checked={funnel} disabled={!canEnablefunnel} onChange={toggleFunnel} />{' '}
          <span className="text-lg">Public</span>
          <span className="relative group">
            <span className="codicon codicon-question cursor-pointer pl-2"></span>
            <span className="absolute invisible right-0 top-2 w-44 mt-1 py-1 px-2 bg-[var(--vscode-editorHoverWidget-background)] text-[var(--vscode-editorHoverWidget-foreground)] border border-[var(--vscode-editorHoverWidget-border)] rounded group-hover:visible">
              This enables Tailscale Funnel, which exposes the local port to the internet.{' '}
              <VSCodeLink href={'https://tailscale.com/kb/1223/tailscale-funnel/'}>
                Learn more.
              </VSCodeLink>
            </span>
          </span>
        </div>
      </div>
      {isOpen && (
        <div className="pl-5">
          <div className="w-full">
            <VSCodeLink href={`https://${DNSName}`}>{DNSName}</VSCodeLink>
          </div>
          <form onSubmit={handleSubmit}>
            <table className="mt-4 table-auto border-collapse w-full">
              <thead>
                <tr>
                  <th className="font-large text-left">Active</th>
                  <th className="font-large text-left">Target</th>
                  <th className="font-large text-left">Mount Point</th>
                  <th className=""></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries<Handlers>(handlers).flatMap(([mountPoint, { Proxy: source }]) => {
                  const sourceURL = new URL(source);
                  const addressURL = new URL(`http://${address}`);
                  const port = parseInt(addressURL.port);

                  return (
                    <tr key={`${address}:${mountPoint}`} className="mb-10">
                      <td>
                        <VSCodeCheckbox checked={true} />
                      </td>
                      <td>
                        http://127.0.0.1:{sourceURL.port}
                        {sourceURL.pathname}
                      </td>
                      <td>
                        https://{DNSName}
                        {mountPoint}
                        <div
                          onClick={() =>
                            vsCodeAPI.writeToClipboard(`https://${address + mountPoint}`)
                          }
                          className="pl-2 codicon codicon-copy"
                        ></div>
                      </td>
                      <td className="text-center">
                        <div
                          className="codicon codicon-trash"
                          onClick={() =>
                            handleDelete({ protocol: 'https', port, mountPoint, source })
                          }
                        ></div>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>
                    <VSCodeCheckbox checked={true} />
                  </td>
                  <td>
                    http://127.0.0.1:
                    <PortInput minWidth={true} name="port" />
                    <PathInput name="path" />
                  </td>
                  <td>
                    https://{DNSName}
                    <PathInput name="mountPoint" />
                  </td>

                  <td className="text-center">
                    <VSCodeButton type="submit">Save</VSCodeButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </form>
        </div>
      )}
    </div>
  );
};

const NewServeForm = ({
  portValue,
  showPort,
  serveStatus,
}: {
  portValue: string;
  showPort: boolean;
  serveStatus: ServeConfig;
}) => {
  const [port, setPort] = useState(portValue);
  const [sourcePort, setSourcePort] = useState('');
  const [mountPoint, setMountPoint] = useState('');
  const [sourcePath, setSourcePath] = useState('');

  const DNSName = trimSuffix(serveStatus.Self?.DNSName, '.');

  function handleSubmit(e) {
    e.preventDefault();
    vsCodeAPI.postMessage({
      type: 'addServe',
      params: {
        protocol: 'https',
        port: parseInt(port),
        mountPoint,
        source: `http://127.0.0.1:${sourcePort}${sourcePath}` as string,
      },
    });

    // reset the form
    setPort('443');
    setSourcePort('');
    setMountPoint('');
    setSourcePath('');
  }

  return (
    <form onSubmit={handleSubmit}>
      {showPort && (
        <div>
          <div className="text-xl">
            <div className="codicon codicon-add"></div> Serve ports via HTTP (
            <PortInput value={port} onChange={(e) => setPort(e.target.value)} minWidth={true} />)
          </div>
          <div className="pl-5">
            <VSCodeLink href={`https://${DNSName}`}>{DNSName}</VSCodeLink>
          </div>
        </div>
      )}

      <table className="ml-5 mt-4 table-auto border-collapse w-full">
        <thead>
          <tr>
            <th className="font-large text-left">Active</th>
            <th className="font-large text-left">Target</th>
            <th className="font-large text-left">Mount Point</th>
            <th className=""></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <VSCodeCheckbox checked={true} />
            </td>
            <td>
              http://127.0.0.1:
              <PortInput
                minWidth={true}
                value={sourcePort}
                onChange={(e) => setSourcePort(e.target.value)}
              />
              <PathInput value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} />
            </td>
            <td>
              {DNSName}
              <PathInput value={mountPoint} onChange={(e) => setMountPoint(e.target.value)} />
            </td>

            <td>
              <VSCodeButton type="submit">Save</VSCodeButton>
            </td>
          </tr>
        </tbody>
      </table>
    </form>
  );
};

const ServeList = ({
  serveStatus,
  selectedAddress,
}: {
  serveStatus: ServeConfig;
  selectedAddress: string | undefined;
}) => {
  const [openSectionKey, setOpenSectionKey] = useState(selectedAddress);

  useEffect(() => {
    if (openSectionKey) {
      return;
    }

    if (selectedAddress) {
      setOpenSectionKey(selectedAddress);
    }

    if (serveStatus.Web) {
      setOpenSectionKey(Object.keys(serveStatus.Web)[0]);
    }
  }, [openSectionKey, selectedAddress, serveStatus]);

  return (
    <div>
      {serveStatus.Web &&
        Object.entries(serveStatus.Web).map(([address, { Handlers }]) => {
          const funnel = serveStatus.AllowFunnel ? serveStatus.AllowFunnel[address] : false;
          return (
            <ServeListMappings
              funnel={funnel}
              key={address}
              address={address}
              handlers={Handlers}
              openSectionKey={openSectionKey}
              setOpenSectionKey={setOpenSectionKey}
            />
          );
        })}
      {!serveStatus.Web && (
        <NewServeForm serveStatus={serveStatus} showPort={true} portValue="443" />
      )}
    </div>
  );
};

const AdvancedView = ({
  serveStatus,
  selectedAddress,
}: {
  serveStatus: ServeConfig;
  selectedAddress: string | undefined;
}) => {
  const [showNewPort, setShowNewPort] = useState(false);

  return (
    <div>
      <ServeList serveStatus={serveStatus} selectedAddress={selectedAddress} />
      {showNewPort && <NewServeForm serveStatus={serveStatus} showPort={true} portValue="443" />}
      <div className="pt-8">
        <VSCodeButton onClick={() => setShowNewPort(!showNewPort)}>
          {showNewPort ? 'Hide' : ''} New Serve Port
        </VSCodeButton>
      </div>
    </div>
  );
};
