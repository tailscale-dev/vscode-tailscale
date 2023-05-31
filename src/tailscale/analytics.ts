import { trimSuffix } from '../utils/string';

const BASE_URL = 'https://tailscale.com';
const BASE_PARAMS = {
  utm_source: 'vscode',
  utm_medium: 'integration',
  utm_campaign: 'vscode-tailscale',
};

/**
 * Adds UTM parameters to Tailscale URLs to track usage.
 */
export function track(path: string, source: string) {
  const queryParams = { ...BASE_PARAMS, ...(source ? { utm_content: source } : {}) };
  const searchParams = new URLSearchParams(queryParams).toString();

  return `${BASE_URL}/${trimSuffix(path, '/')}?${searchParams}`;
}
