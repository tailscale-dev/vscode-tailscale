import React, { FormEvent, useEffect, useState } from 'react';
import { VSCodeButton, VSCodeLink, VSCodeProgressRing } from '@vscode/webview-ui-toolkit/react';
import { trimSuffix } from '../../utils/string';
import { vsCodeAPI } from '../../vscode-api';
import { PortInput } from './components/port-input';
import { Error } from './components/error';
import { KB_FUNNEL_USE_CASES } from '../../utils/url';
import { useServe, useServeMutation } from './swr';
import { Tooltip } from './components/tooltip';
import { errorForType } from '../../tailscale/error';
import { serveReset } from '../tsrelay';
import { ServeParams } from '../../types';

export const SimpleView = () => {
  const { data, mutate, isLoading } = useServe();
  const { trigger, isMutating } = useServeMutation();
  const [isDeleting, setIsDeleting] = useState(false);
  const [port, setPort] = useState('');
  const [previousPort, setPreviousPort] = useState('');
  const [disabledText, setDisabledText] = useState<string | undefined>(undefined);

  const DNSName = trimSuffix(data?.Self?.DNSName, '.');
  const persistedPort =
    data?.ServeConfig?.Web?.[`${DNSName}:443`]?.Handlers['/']?.Proxy.split(':')[2];

  useEffect(() => {
    if (data?.Errors && data.Errors.length > 0) {
      const e = errorForType(data.Errors[0].Type);
      setDisabledText(e.title);
      return;
    }

    setDisabledText(undefined);
  }, [data]);

  useEffect(() => {
    setPort(persistedPort);
  }, [persistedPort]);

  useEffect(() => {
    const handleMessage = (event) => {
      const message = event.data; // The JSON data our extension sent

      switch (message.command) {
        case 'refreshState':
          mutate();
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [mutate]);

  if (isLoading) {
    return <VSCodeProgressRing></VSCodeProgressRing>;
  }

  const textStyle = 'text-bannerForeground bg-bannerBackground';
  const textDisabledStyle = 'text-foreground bg-background';
  const hasServeTextStyle = persistedPort ? textStyle : textDisabledStyle;
  return (
    <div>
      {data?.Errors?.map((error, index) => (
        <Error key={index} type={error.Type} />
      ))}

      <div className="pt-2 pb-4">
        <div className="text-2xl">Tailscale Funnel</div>
        <div className="pt-2">
          Share a local server on the internet and more with Funnel.{' '}
          <VSCodeLink href={KB_FUNNEL_USE_CASES}>Learn More</VSCodeLink>
        </div>
      </div>

      {/* TODO: handle data.Self being unset */}
      {data?.Self && <Form />}
    </div>
  );

  function Form() {
    const handlePortChange = (e) => {
      setPort(e.target.value);
    };

    return (
      <form onSubmit={handleSubmit}>
        <div className="w-full flex flex-col md:flex-row">
          <div className={`p-3 flex items-center flex-0 ${hasServeTextStyle}`}>
            <span
              className={`${
                persistedPort ? 'text-green-400' : ''
              } codicon codicon-circle-filled pr-2`}
            ></span>
            <span>https://{DNSName}</span>
            <Tooltip tip={persistedPort ? 'Open link' : undefined}>
              <span
                onClick={() => persistedPort && vsCodeAPI.openLink(`https://${DNSName}`)}
                className={`${
                  persistedPort ? 'cursor-pointer' : ''
                } codicon codicon-globe pl-2 ml-auto`}
              ></span>
            </Tooltip>
            <Tooltip tip={persistedPort ? 'Copy' : undefined}>
              <span
                onClick={() => persistedPort && vsCodeAPI.writeToClipboard(`https://${DNSName}`)}
                className={`${persistedPort ? 'cursor-pointer' : ''} codicon codicon-copy pl-1`}
              ></span>
            </Tooltip>
          </div>

          <div className="md:hidden self-center mx-auto mt-2">
            <div className="codicon codicon-arrow-down"></div>
          </div>

          <div className="hidden md:block self-center">
            <div className="self-center px-4">
              <div className="codicon codicon-arrow-right"></div>
            </div>
          </div>

          <div className="flex bg-bannerBackground border-2 border-bannerBackground text-bannerForeground">
            <span className="p-3 inline-block text-bannerForeground">http://127.0.0.1:</span>

            <div className="flex-grow bg-background w-full text-bannerForeground inline-block">
              <PortInput
                width={8}
                name="port"
                disabled={!!disabledText}
                onInput={handlePortChange}
                defaultValue={port || previousPort}
                className="w-full"
              />
            </div>
          </div>

          {(persistedPort && port === persistedPort) || port === '' ? (
            <Tooltip tip={disabledText}>
              <VSCodeButton
                onClick={handleReset}
                disabled={!!disabledText || isDeleting}
                className="mx-auto w-full md:my-0 my-4 flex justify-center md:w-auto bg-buttonBackground md:ml-4"
              >
                {isDeleting ? 'Stoping' : 'Stop'}
              </VSCodeButton>
            </Tooltip>
          ) : (
            <Tooltip tip={disabledText}>
              <VSCodeButton
                type="submit"
                disabled={!!disabledText || isMutating}
                className="mx-auto w-full md:my-0 my-4 flex justify-center md:w-auto bg-buttonBackground md:ml-4"
              >
                {persistedPort
                  ? isMutating
                    ? 'Updating'
                    : 'Update'
                  : isMutating
                  ? 'Starting'
                  : 'Start'}
              </VSCodeButton>
            </Tooltip>
          )}
        </div>
        <div className="pt-4">{persistedPort && port === persistedPort ? renderService() : ''}</div>
      </form>
    );
  }

  function renderService(): JSX.Element {
    if (data?.Services[persistedPort]) {
      return (
        <div className="italic">
          Port {persistedPort} is currently started by "{data?.Services[persistedPort]}"
        </div>
      );
    }

    return (
      <div className="text-errorForeground">
        It seems there's no service currently utilizing port {persistedPort}. Please ensure you
        start a local service that is bound to port {persistedPort}.
      </div>
    );
  }

  async function handleReset(e) {
    e.preventDefault();
    e.stopPropagation();

    setIsDeleting(true);

    const resp = await serveReset();

    if (resp.Errors?.length && resp.Errors[0].Type === 'REQUIRES_SUDO') {
      vsCodeAPI.postMessage({
        type: 'sudoPrompt',
        operation: 'delete',
      });
    }

    setIsDeleting(false);
    setPreviousPort(port);
    setPort('');

    // trigger refresh
    await mutate();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.target as HTMLFormElement);
    const port = form.get('port');

    if (!port) {
      return;
    }

    const params: ServeParams = {
      protocol: 'https',
      port: 443,
      mountPoint: '/',
      source: `http://127.0.0.1:${port}`,
      funnel: true,
    };

    const resp = await trigger(params);
    if (resp.Errors?.length && resp.Errors[0].Type === 'REQUIRES_SUDO') {
      vsCodeAPI.postMessage({
        type: 'sudoPrompt',
        operation: 'add',
        params,
      });
    }
  }
};
