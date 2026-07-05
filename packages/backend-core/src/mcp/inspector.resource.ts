import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { APP_RESOURCE_MIME_TYPE, type RegisteredSkill } from '@getmunin/mcp-toolkit';

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
      <h1>Munin Inspector</h1>
      <p id="status">Connecting to host…</p>
      <pre id="payload">—</pre>
    </main>
    <script type="module">
      import { App } from 'https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@1.7.4/+esm';

      const statusEl = document.getElementById('status');
      const payloadEl = document.getElementById('payload');

      const app = new App({ name: 'Munin Inspector', version: '0.1.0' });

      app.ontoolresult = (result) => {
        statusEl.textContent = 'Tool result pushed by host.';
        const text = result?.content?.find((c) => c.type === 'text')?.text;
        payloadEl.textContent = text ?? JSON.stringify(result ?? {}, null, 2);
      };

      await app.connect();
      statusEl.textContent =
        'Connected — the interactive panel bundle is not built on this server (@getmunin/inspector-app).';
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

const inspectorPayload = loadInspectorPayload();

export const INSPECTOR_APP_URI = `ui://munin/inspector@${createHash('sha256')
  .update(inspectorPayload.content)
  .digest('hex')
  .slice(0, 8)}`;

// Asset thumbnails in the media-library view load straight from the storage
// provider's public URL, so its origin must be CSP-allowed inside the iframe.
function assetStorageOrigin(): string | null {
  const provider = (process.env.MUNIN_STORAGE_PROVIDER ?? 'local').toLowerCase();
  const base =
    provider === 's3'
      ? (process.env.MUNIN_STORAGE_S3_PUBLIC_BASE_URL ??
        (process.env.MUNIN_STORAGE_S3_ENDPOINT && process.env.MUNIN_STORAGE_S3_BUCKET
          ? `${process.env.MUNIN_STORAGE_S3_ENDPOINT}/${process.env.MUNIN_STORAGE_S3_BUCKET}`
          : null))
      : (process.env.MUNIN_STORAGE_LOCAL_BASE_URL ?? 'http://localhost:3001/static/assets');
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

export function inspectorAppResource(): RegisteredSkill {
  const { content, cspDomains } = inspectorPayload;
  const assetOrigin = assetStorageOrigin();
  const resourceDomains = [...(cspDomains ?? []), ...(assetOrigin ? [assetOrigin] : [])];
  return {
    uri: INSPECTOR_APP_URI,
    name: 'Munin Inspector',
    description:
      'Interactive panel rendered by MCP App hosts: outreach proposal review, CRM merge-proposal review, KB curation review, analytics charts, CMS entry preview, and the media-library gallery.',
    audiences: ['admin'],
    mimeType: APP_RESOURCE_MIME_TYPE,
    content,
    public: false,
    meta: {
      ui: { csp: { resourceDomains, connectDomains: cspDomains ?? [] } },
    },
  };
}
