import { useEffect, useState } from 'react';
import { App as McpApp } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isHelloPayload, isProposalList, parseToolResult } from './types';
import { HelloView } from './views/hello';
import { ProposalsView } from './views/proposals';

const mcpApp = new McpApp({ name: 'Munin Inspector', version: '0.2.0' });

type Connection = 'connecting' | 'connected' | 'failed';

export function InspectorApp() {
  const [connection, setConnection] = useState<Connection>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [payload, setPayload] = useState<unknown>(null);

  useEffect(() => {
    mcpApp.ontoolresult = (result: CallToolResult) => {
      setPayload(parseToolResult(result));
    };
    mcpApp
      .connect()
      .then(() => setConnection('connected'))
      .catch((err: unknown) => {
        setConnection('failed');
        setConnectionError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (connection === 'failed') {
    return (
      <div className="shell">
        <p className="status status-error">Could not connect to the host: {connectionError}</p>
      </div>
    );
  }

  if (connection === 'connecting') {
    return (
      <div className="shell">
        <p className="status">Connecting to host…</p>
      </div>
    );
  }

  if (isProposalList(payload)) {
    return <ProposalsView app={mcpApp} initial={payload} />;
  }

  if (isHelloPayload(payload)) {
    return <HelloView app={mcpApp} initial={payload} />;
  }

  return (
    <div className="shell">
      <h1>Munin Inspector</h1>
      <p className="status">
        {payload === null
          ? 'Connected — waiting for a tool result from the host.'
          : 'Connected — showing the raw tool result.'}
      </p>
      {payload !== null && <pre className="payload">{JSON.stringify(payload, null, 2)}</pre>}
    </div>
  );
}
