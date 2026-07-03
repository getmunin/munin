import type { ReactNode } from 'react';

export function Chrome({
  context,
  tool,
  children,
}: {
  context: string;
  tool: string;
  children: ReactNode;
}) {
  return (
    <div className="panel">
      <div className="chrome">
        <div className="chrome-brand">
          <span className="wordmark">
            Munin<span className="wordmark-dot">.</span>
          </span>
          <span className="chrome-context">{context}</span>
        </div>
        <span className="chrome-tool">{tool}</span>
      </div>
      {children}
    </div>
  );
}
