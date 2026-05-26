'use client';

import { useState } from 'react';

interface CopyPromptButtonProps {
  prompt: string;
  label?: string;
}

export function CopyPromptButton({ prompt, label }: CopyPromptButtonProps) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard
      ?.writeText(prompt)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        /* noop */
      });
  }

  return (
    <div className="curl">
      <div className="curl-h">
        <span>{label ?? 'System prompt'}</span>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      <pre>{prompt}</pre>
    </div>
  );
}
