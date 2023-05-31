import React, { Fragment } from 'react';
import { vsCodeAPI } from '../../../vscode-api';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { errorForType } from '../../../tailscale/error';

export const Error = ({ type }) => {
  const { title, links, message } = errorForType(type);

  return (
    <div className="flex mt-2 bg-bannerBackground p-3">
      <div className="pr-2 text-notificationsErrorIconForeground codicon codicon-error"></div>
      <div className="text-bannerForeground">
        {title && <div className="font-bold">{title}</div>}
        <div>{message}</div>
        {links && (
          <div className="mt-4">
            {links.map(({ title, url }) => (
              <VSCodeButton key={url} onClick={() => vsCodeAPI.openLink(url)}>
                {title}
              </VSCodeButton>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
