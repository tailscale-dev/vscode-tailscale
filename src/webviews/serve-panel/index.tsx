import React from 'react';
import { createRoot } from 'react-dom/client';
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { App } from './app';
import type { WebviewEvent } from '../../types';

provideVSCodeDesignSystem().register(vsCodeButton());

import './index.css';

window.addEventListener('message', (m: WebviewEvent) => {
  switch (m.data.type) {
    // ignored dev messages
    case 'webpackOk':
    case 'webpackInvalid':
    case 'webpackStillOk':
      break;

    default:
      console.log('Unknown message type', m);
  }
});

if (module.hot) {
  module.hot.accept();
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
