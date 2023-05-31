import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { ServeStatus, ServeParams } from '../../types';

export function useServe() {
  // TODO(tyler): implement cache provider using memento storage (context.globalstate)
  return useSWR<ServeStatus>('/serve', fetchWithUser, { refreshInterval: 3000 });
}

export function useServeMutation() {
  return useSWRMutation('/serve', (path: string, { arg }: { arg?: ServeParams }) => {
    const requestOptions: RequestInit = {
      method: 'POST',
      body: arg ? JSON.stringify(arg) : undefined,
    };

    return fetchWithUser(path, requestOptions);
  });
}

export async function fetchWithUser(path: string, options: RequestInit = {}) {
  const { url, authkey } = window.tailscale;

  options.headers = options.headers || {};
  options.headers['Content-Type'] = 'application/json';
  options.headers['Authorization'] = `Basic ${authkey}`;

  console.time(path);
  const res = await fetch(url + path, options);
  console.timeEnd(path);

  if (options.method !== 'DELETE') {
    return res.json();
  }
}
