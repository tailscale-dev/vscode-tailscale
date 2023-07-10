import { postMessageWithResponse } from './api';
import type { RelayServeResponse, ServeParams, ServeStatus, WithErrors } from '../types';

export async function serveStatus() {
  const reponse = (await postMessageWithResponse({
    type: 'relayRequest',
    endpoint: '/serve',
    method: 'GET',
  })) as RelayServeResponse;

  return reponse.data as ServeStatus;
}

export async function serveReset() {
  const reponse = (await postMessageWithResponse({
    type: 'relayRequest',
    endpoint: '/serve',
    method: 'DELETE',
  })) as RelayServeResponse;

  return reponse.data as WithErrors;
}

export async function serveUpdate(arg?: ServeParams) {
  const reponse = (await postMessageWithResponse({
    type: 'relayRequest',
    endpoint: '/serve',
    method: 'POST',
    data: arg,
  })) as RelayServeResponse;

  return reponse.data as WithErrors;
}
