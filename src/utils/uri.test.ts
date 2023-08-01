import { test, expect, describe, vi } from 'vitest';
import { createTsUri, parseTsUri } from './uri';
import { URI, Utils } from 'vscode-uri';

vi.mock('vscode', async () => {
  return {
    Uri: {
      parse: (uri: string) => URI.parse(uri),
      from: (params: { scheme: string; authority: string; path: string }) => URI.from(params),
      joinPath: (uri: URI, ...paths: string[]) => Utils.joinPath(uri, ...paths),
    },
  };
});

describe('parseTsUri', () => {
  test('parses ts URIs correctly', () => {
    const testUri = URI.parse('ts://tails-scales/foo/home/amalie');
    const expected = {
      hostname: 'foo',
      tailnet: 'tails-scales',
      resourcePath: '/home/amalie',
    };

    const result = parseTsUri(testUri);
    expect(result).toEqual(expected);
  });

  test('throws an error when scheme is not supported', () => {
    const testUri = URI.parse('http://example.com');

    expect(() => parseTsUri(testUri)).toThrow('Unsupported scheme: http');
  });

  test('correctly returns ~ as a resourcePath', () => {
    const testUri = URI.parse('ts://tails-scales/foo/~');
    const expected = {
      hostname: 'foo',
      tailnet: 'tails-scales',
      resourcePath: '.',
    };

    const result = parseTsUri(testUri);
    expect(result).toEqual(expected);
  });

  test('correctly returns ~ in a deeply nested resourcePath', () => {
    const testUri = URI.parse('ts://tails-scales/foo/~/bar/baz');
    const expected = {
      hostname: 'foo',
      tailnet: 'tails-scales',
      resourcePath: './bar/baz',
    };

    const result = parseTsUri(testUri);
    expect(result).toEqual(expected);
  });
});

describe('createTsUri', () => {
  test('creates ts URIs correctly', () => {
    const expected = URI.parse('ts://tails-scales/foo/home/amalie');
    const params = {
      hostname: 'foo',
      tailnet: 'tails-scales',
      resourcePath: '/home/amalie',
    };

    expect(createTsUri(params)).toEqual(expected);
  });

  test('creates ts URIs correctly', () => {
    const expected = URI.parse('ts://tails-scales/foo/~');
    const params = {
      hostname: 'foo',
      tailnet: 'tails-scales',
      resourcePath: '~',
    };

    expect(createTsUri(params)).toEqual(expected);
  });
});
