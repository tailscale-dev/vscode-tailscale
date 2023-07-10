import { vsCodeAPI } from '../vscode-api';
import type { Message, Responses } from '../types';

let currentMessageId = 1;
const messagePromises = new Map<
  number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { resolve: (value: Responses) => void; reject: (reason?: any) => void }
>();

class MessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageError';
  }
}

/**
 * Sends a message to the VSCode extension and returns a promise that resolves with the response.
 * @param message The message to send.
 * @returns A promise that resolves with the response from the extension.
 */
export function postMessageWithResponse(message: Message): Promise<Responses> {
  return new Promise<Responses>((resolve, reject) => {
    message.id = currentMessageId++;
    messagePromises.set(message.id, { resolve, reject });

    vsCodeAPI.postMessage(message);
  });
}

/**
 * Handles incoming messages from the VSCode extension.
 * @param event The message event.
 */
window.addEventListener('message', (event) => {
  const message = event.data ?? {};

  if (!message.id || !message.type) {
    return;
  }

  const promiseMethods = messagePromises.get(message.id);

  if (!promiseMethods) {
    return;
  }

  const { resolve, reject } = promiseMethods;
  messagePromises.delete(message.id);

  if (message.error) {
    reject(new MessageError(`Message error: ${message.error}`));
  } else {
    resolve(message as Responses);
  }
});
