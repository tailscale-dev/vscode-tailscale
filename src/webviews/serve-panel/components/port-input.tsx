import React, { CSSProperties, InputHTMLAttributes, useState, useEffect, useRef } from 'react';

interface PortInputProps extends InputHTMLAttributes<HTMLInputElement> {
  value?: string;
  placeholder?: string;
  minWidth?: boolean;
  width?: number;
  className?: string;
  style?: CSSProperties;
}

export function PortInput({
  placeholder = '<port>',
  defaultValue = '',
  minWidth = false,
  ...props
}: PortInputProps) {
  const [port, setPort] = useState(defaultValue);

  useEffect(() => {
    setPort(defaultValue);
  }, [defaultValue]);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value.replace(/[^0-9]/g, '');

    // limit to valid TCP/UDP ports
    if (Number(inputValue) > 65535) {
      return;
    }

    setPort(inputValue);

    if (props.onInput) {
      const newEvent = { ...e, target: { ...e.target, value: inputValue } };
      props.onInput(newEvent);
    }
  };

  return (
    <input
      {...props}
      ref={inputRef}
      className={`${props.className} bg-inherit px-2 h-full bg-inputBackground text-inputForeground placeholder:text-inputPlaceholderForeground focus:outline-inputFocusOutline]`}
      placeholder={placeholder}
      value={port}
      onInput={handleInput}
    />
  );
}
