import React from 'react';
import { createRoot } from 'react-dom/client';
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { App } from './app';
import type { WebviewEvent } from '../../types';

provideVSCodeDesignSystem().register(vsCodeButton());

import './index.css';

if (module.hot) {
  module.hot.accept();
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
