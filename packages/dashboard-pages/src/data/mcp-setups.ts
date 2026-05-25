export interface McpSetup {
  id: 'claude' | 'chatgpt' | 'gemini';
  label: string;
  sublabel: string;
  snippet: string;
  docsHref: string;
  docsLabel: string;
}

const TOKEN_PLACEHOLDER = 'mn_live_••••••••';

/**
 * Build the per-client config snippets for the dashboard's
 * "Connect MCP" section. Pass the actual MCP host URL — the dashboard
 * fetches it at runtime from `/.well-known/oauth-protected-resource`,
 * so self-host instances render `http://localhost:3001` (or whatever
 * `MUNIN_MCP_URL` is set to) and cloud renders `mcp.getmunin.com`
 * without a rebuild.
 *
 * `docsHost` is the public docs site (e.g. `https://docs.getmunin.com`
 * for prod, `https://docs.dev.getmunin.com` for dev). Defaults to the
 * cloud-prod URL when omitted.
 */
export function buildMcpSetups(host: string, docsHost: string = DEFAULT_DOCS_HOST): McpSetup[] {
  const docs = docsHost.replace(/\/+$/, '');
  const docsBare = docs.replace(/^https?:\/\//, '');
  return [
    {
      id: 'claude',
      label: 'Claude',
      sublabel: 'Desktop & Web',
      snippet: `// claude_desktop_config.json
{
  "mcpServers": {
    "munin": {
      "url": "${host}",
      "headers": {
        "Authorization": "Bearer ${TOKEN_PLACEHOLDER}"
      }
    }
  }
}`,
      docsHref: `${docs}/mcp/claude`,
      docsLabel: `${docsBare}/mcp/claude`,
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      sublabel: 'Custom Connector',
      snippet: `// Settings → Connectors → New connector → MCP
{
  "name": "Munin",
  "transport": "http",
  "url":  "${host}",
  "auth": {
    "type":  "bearer",
    "token": "${TOKEN_PLACEHOLDER}"
  }
}`,
      docsHref: `${docs}/mcp/chatgpt`,
      docsLabel: `${docsBare}/mcp/chatgpt`,
    },
    {
      id: 'gemini',
      label: 'Gemini',
      sublabel: 'CLI & Studio',
      snippet: `// ~/.gemini/mcp.json
{
  "servers": {
    "munin": {
      "url": "${host}",
      "headers": {
        "Authorization": "Bearer ${TOKEN_PLACEHOLDER}"
      }
    }
  }
}`,
      docsHref: `${docs}/mcp/gemini`,
      docsLabel: `${docsBare}/mcp/gemini`,
    },
  ];
}

const DEFAULT_MCP_HOST = 'https://mcp.getmunin.com';
const DEFAULT_DOCS_HOST = 'https://docs.getmunin.com';

/** Static fallback used before the runtime fetch resolves. */
export const MCP_SETUPS: McpSetup[] = buildMcpSetups(DEFAULT_MCP_HOST, DEFAULT_DOCS_HOST);
