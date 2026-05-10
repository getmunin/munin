'use client';

import { useState } from 'react';

export function CurlBlock({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        /* noop */
      });
  };
  return (
    <div className="curl">
      <div className="curl-h">
        <span>{label ?? 'cURL'}</span>
        <button onClick={copy} type="button">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{command}</pre>
    </div>
  );
}
