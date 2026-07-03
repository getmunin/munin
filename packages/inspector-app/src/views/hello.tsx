import { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { isHelloPayload, parseToolResult, type HelloPayload } from '../types';

export function HelloView({ app, initial }: { app: McpApp; initial: HelloPayload }) {
  const [payload, setPayload] = useState<HelloPayload>(initial);
  const [status, setStatus] = useState('Tool result pushed by host.');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setStatus('Calling inspector_hello…');
    try {
      const result = await app.callServerTool({ name: 'inspector_hello', arguments: {} });
      const parsed = parseToolResult(result);
      if (result.isError || !isHelloPayload(parsed)) {
        setStatus('Tool call failed.');
      } else {
        setPayload(parsed);
        setStatus('Refreshed via tools/call round trip.');
      }
    } catch (err) {
      setStatus(`Tool call failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <h1>Hello from Munin 👋</h1>
      <p className="status">{status}</p>
      <pre className="payload">{JSON.stringify(payload, null, 2)}</pre>
      <button className="btn" disabled={busy} onClick={() => void refresh()}>
        Refresh from server
      </button>
    </div>
  );
}
