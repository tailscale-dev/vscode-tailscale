import React, { useState } from 'react';

export const Tooltip = ({ children, tip }) => {
  const [showTip, setTip] = useState(false);

  const toggleTip = () => {
    setTip(!showTip);
  };

  return (
    <div className="relative inline-flex" onMouseEnter={toggleTip} onMouseLeave={toggleTip}>
      {children}
      {tip && showTip && (
        <div className="absolute inline-flex min-w-max bg-badgeBackground border-2 border-[var(--vscode-checkbox-border)] text-badgeForeground py-1 px-2 bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 whitespace-normal">
          {tip}
        </div>
      )}
    </div>
  );
};
