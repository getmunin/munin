import { useEffect, useState } from 'react';
import { App as McpApp } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isProposalList, parseToolResult } from './types';
import { Chrome } from './chrome';
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
    mcpApp.onhostcontextchanged = (params) => {
      console.log('[Munin Inspector] host context changed:', params);
    };
    mcpApp
      .connect()
      .then(() => {
        setConnection('connected');
        console.log('[Munin Inspector] host context:', mcpApp.getHostContext());
      })
      .catch((err: unknown) => {
        setConnection('failed');
        setConnectionError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (connection === 'failed') {
    return (
      <Chrome context="Inspector" tool="—">
        <div className="plain">
          <p className="line line-error">Could not connect to the host: {connectionError}</p>
        </div>
      </Chrome>
    );
  }

  if (connection === 'connecting') {
    return (
      <Chrome context="Inspector" tool="—">
        <div className="plain">
          <p className="status">Connecting to host…</p>
        </div>
      </Chrome>
    );
  }

  if (isProposalList(payload)) {
    return <ProposalsView app={mcpApp} initial={payload} />;
  }

  return (
    <Chrome context="Inspector" tool="—">
      <div className="plain">
        <h1>Munin Inspector</h1>
        <p className="status">
          {payload === null
            ? 'Connected — waiting for a tool result from the host.'
            : 'Connected — showing the raw tool result.'}
        </p>
        {payload !== null && <pre className="payload">{JSON.stringify(payload, null, 2)}</pre>}
      </div>
    </Chrome>
  );
}
