import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { APP_RESOURCE_MIME_TYPE, type RegisteredSkill } from '@getmunin/mcp-toolkit';

export const INSPECTOR_APP_URI = 'ui://munin/inspector';

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Munin Inspector — Hello</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      }
      body {
        margin: 0;
        padding: 1.25rem;
        line-height: 1.5;
      }
      h1 {
        font-size: 1.1rem;
        margin: 0 0 0.5rem;
      }
      #status {
        font-size: 0.85rem;
        opacity: 0.7;
        margin: 0 0 0.75rem;
      }
      pre {
        background: rgba(127, 127, 127, 0.12);
        border-radius: 8px;
        padding: 0.75rem;
        font-size: 0.8rem;
        overflow: auto;
        margin: 0 0 0.75rem;
      }
      button {
        font: inherit;
        padding: 0.4rem 0.9rem;
        border-radius: 8px;
        border: 1px solid rgba(127, 127, 127, 0.4);
        background: transparent;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Hello from Munin 👋</h1>
      <p id="status">Connecting to host…</p>
      <pre id="payload">—</pre>
      <button id="refresh" disabled>Refresh from server</button>
    </main>
    <script type="module">
      import { App } from 'https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@1.7.4/+esm';

      const statusEl = document.getElementById('status');
      const payloadEl = document.getElementById('payload');
      const refreshBtn = document.getElementById('refresh');

      function render(result) {
        const text = result?.content?.find((c) => c.type === 'text')?.text;
        payloadEl.textContent = text ?? JSON.stringify(result ?? {}, null, 2);
      }

      const app = new App({ name: 'Munin Inspector', version: '0.1.0' });

      app.ontoolresult = (params) => {
        statusEl.textContent = 'Tool result pushed by host.';
        render(params);
      };

      await app.connect();
      statusEl.textContent = 'Connected — served by Munin over ui://munin/inspector.';
      refreshBtn.disabled = false;

      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        statusEl.textContent = 'Calling inspector_hello…';
        try {
          const result = await app.callServerTool({ name: 'inspector_hello', arguments: {} });
          statusEl.textContent = 'Refreshed via tools/call round trip.';
          render(result);
        } catch (err) {
          statusEl.textContent = 'Tool call failed: ' + (err?.message ?? err);
        } finally {
          refreshBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>
`;

interface InspectorPayload {
  content: string;
  cspDomains: string[] | null;
}

function loadInspectorPayload(): InspectorPayload {
  try {
    const require = createRequire(import.meta.url);
    const bundlePath = require.resolve('@getmunin/inspector-app/dist/index.html');
    return { content: readFileSync(bundlePath, 'utf8'), cspDomains: null };
  } catch {
    return { content: FALLBACK_HTML, cspDomains: ['https://cdn.jsdelivr.net'] };
  }
}

export function inspectorAppResource(): RegisteredSkill {
  const { content, cspDomains } = loadInspectorPayload();
  return {
    uri: INSPECTOR_APP_URI,
    name: 'Munin Inspector',
    description:
      'Interactive panel rendered by MCP App hosts: outreach proposal review plus a hello diagnostics view (issue #385).',
    audiences: ['admin'],
    mimeType: APP_RESOURCE_MIME_TYPE,
    content,
    public: false,
    meta: cspDomains
      ? { ui: { csp: { resourceDomains: cspDomains, connectDomains: cspDomains } } }
      : { ui: { csp: { resourceDomains: [], connectDomains: [] } } },
  };
}
