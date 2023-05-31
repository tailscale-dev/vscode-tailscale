/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/webviews/serve-panel/**/*.{js,jsx,ts,tsx}'],
  theme: {
    colors: {
      // Global
      background: 'var(--vscode-editor-background, #1e1e1e)',
      foreground: 'var(--vscode-editor-foreground, #cccccc)',
      contrastActiveBorder: 'var(--vscode-contrastActiveBorder, #f38518)',
      contrastBorder: 'var(--vscode-contrastBorder, #6fc3df)',
      disabledOpacity: 0.4,
      errorForeground: 'var(--vscode-errorForeground)',
      focusBorder: 'var(--vscode-focusBorder, #007fd4)',

      // Notifications
      notificationsBackground: 'var(--vscode-notifications-background)',
      notificationsErrorIconForeground: 'var(--vscode-notificationsErrorIcon-foreground)',
      notificationsForeground: 'var(--vscode-notifications-foreground)',

      // Banner
      bannerBackground: 'var(--vscode-banner-background)',
      bannerForeground: 'var(--vscode-banner-foreground)',
      bannerIconForeground: 'var(--vscode-banner-iconForeground)',

      // Badge
      badgeBackground: 'var(--vscode-badge-background)',
      badgeForeground: 'var(--vscode-badge-foreground)',

      // Text Field & Area
      inputBackground: 'var(--vscode-input-background, #3c3c3c)',
      inputFocusOutline: 'var(--vscode-activityBar-activeBorder)',
      inputForeground: 'var(--vscode-input-foreground, #cccccc)',
      inputPlaceholderForeground: 'var(--vscode-input-placeholderForeground, #cccccc)',

      // Button
      buttonBackground: 'var(--vscode-button-background)',
    },
    extend: {},
  },
  plugins: [],
};
