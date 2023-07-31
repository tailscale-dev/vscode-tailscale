import { test, expect, vi } from 'vitest';
import { parseTsUri } from './uri';
import { URI } from 'vscode-uri';

vi.mock('vscode');

test('parses ts URIs correctly', () => {
  const testUri = URI.parse('ts://tailnet-scales/foo/home/amalie');
  const expected = {
    hostname: 'foo',
    tailnet: 'tailnet-scales',
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
  const testUri = URI.parse('ts://tailnet-scales/foo/~');
  const expected = {
    hostname: 'foo',
    tailnet: 'tailnet-scales',
    resourcePath: '~',
  };

  const result = parseTsUri(testUri);
  expect(result).toEqual(expected);
});
