import { test, describe, expect } from 'vitest';
import { escapeSpace, trimSuffix } from './string';

describe('escapeSpace', () => {
  test('escapes spaces', () => {
    const result = escapeSpace('foo bar');
    expect(result).toEqual('foo\\ bar');
  });

  test('does not escape other characters', () => {
    const result = escapeSpace('foo-bar');
    expect(result).toEqual('foo-bar');
  });
});

describe('trimSuffix', () => {
  test('trims the suffix', () => {
    const result = trimSuffix('foo.bar', '.bar');
    expect(result).toEqual('foo');
  });

  test('does not trim the suffix if it does not match', () => {
    const result = trimSuffix('foo.bar', '.baz');
    expect(result).toEqual('foo.bar');
  });
});
