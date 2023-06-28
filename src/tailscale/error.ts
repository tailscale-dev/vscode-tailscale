interface TailscaleError {
  title: string;
  message: string;
  links?: Link[];
}

interface Link {
  url: string;
  title: string;
}

export function errorForType(type: string): TailscaleError {
  switch (type) {
    case 'OFFLINE':
      return {
        title: 'Tailscale offline',
        message: 'Please log in and try again',
      };
    case 'NOT_RUNNING':
      return {
        title: 'Tailscale not running',
        message: 'Tailscale is either uninstalled or not running',
        links: [{ url: 'https://tailscale.com/download', title: 'Install' }],
      };
    case 'FUNNEL_OFF':
      return {
        title: 'Funnel is disabled',
        message:
          'Enable Funnel by adding a new `funnel` attribute under `noteAttrs` in your tailet policy file.',
        links: [
          { url: 'https://tailscale.com/kb/1223/tailscale-funnel/#setup', title: 'Enable Funnel' },
        ],
      };
    case 'HTTPS_OFF':
      return {
        title: 'HTTPS disabled',
        message:
          'HTTPS is required to use Funnel. Enable the HTTPS certificates in the Admin Console.',
        links: [
          {
            url: 'https://tailscale.com/kb/1153/enabling-https/#configure-https',
            title: 'Enable HTTPS',
          },
        ],
      };
    case 'REQUIRES_RESTART':
      return {
        title: 'Restart Flatpak Container',
        message: 'Please quit VSCode and restart the container to finish setting up Tailscale',
      };
    default:
      return {
        title: 'Unknown error',
        message: 'An unknown error occurred. Check the logs for more information or file an issue.',
      };
  }
}
