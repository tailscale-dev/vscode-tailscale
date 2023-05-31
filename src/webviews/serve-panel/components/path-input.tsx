import React, { useState } from 'react';

export function PathInput({
  value = '',
  placeholder = '/<path>',
  minWidth = false,
  ...rest
}: {
  value?: string;
  placeholder?: string;
  minWidth?: boolean;
  [key: string]: unknown;
}) {
  const [path, setPath] = useState<string | undefined>(value);

  function style() {
    if (!minWidth) {
      return {};
    }

    if (path) {
      return { width: `${path.length}ch` };
    }

    if (placeholder) {
      return { width: `${placeholder?.length - 1}ch` };
    }
  }

  function onInput(e: React.FormEvent<HTMLInputElement>) {
    const p = e.currentTarget.value;

    if (p === '') {
      setPath(undefined);
      return;
    }

    // TODO(all): filter/validate on https://datatracker.ietf.org/doc/html/rfc3986#section-2
    setPath(p.startsWith('/') ? p : `/${p}`);
  }

  return (
    <input
      {...rest}
      value={path}
      className="bg-inherit"
      onInput={onInput}
      style={style()}
      placeholder={placeholder}
    />
  );
}
