/* eslint-disable @typescript-eslint/no-explicit-any */
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { ServeParams } from '../../types';
import { serveStatus, serveUpdate } from '../tsrelay';

export function useServe() {
  return useSWR('serveStatus', serveStatus, { refreshInterval: 3000 });
}

export function useServeMutation() {
  return useSWRMutation('serveStatus', (path: string, { arg }: { arg?: ServeParams }) => {
    return serveUpdate(arg);
  });
}

export async function fetchWithMessage(type: string, data: RequestInit = {}) {
  return await serveStatus;
}
