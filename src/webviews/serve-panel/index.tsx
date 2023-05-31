import React from 'react';
import { createRoot } from 'react-dom/client';
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { App } from './app';
import { useServeStatusStore } from './store';
import { vsCodeAPI } from '../../vscode-api';
import type { WebviewEvent } from '../../types';

provideVSCodeDesignSystem().register(vsCodeButton());

import './index.css';

useServeStatusStore.setState({});

// request initial data
// vsCodeAPI.postMessage({ type: 'refreshState' });

window.addEventListener('message', (m: WebviewEvent) => {
  switch (m.data.type) {
    case 'updateState':
      useServeStatusStore.setState({
        state: m.data.state,
        isLoaded: true,
      });

      break;

    case 'showAdvancedView':
      useServeStatusStore.setState({ showAdvanced: true });
      break;

    case 'showSimpleView':
      useServeStatusStore.setState({ showAdvanced: false });
      break;

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
