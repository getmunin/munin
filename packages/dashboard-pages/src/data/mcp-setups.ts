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
 * `MUNIN_PUBLIC_URL` is set to) and cloud renders `mcp.getmunin.com`
 * without a rebuild.
 */
export function buildMcpSetups(host: string): McpSetup[] {
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
      docsHref: 'https://docs.getmunin.com/mcp/claude',
      docsLabel: 'docs.getmunin.com/mcp/claude',
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
      docsHref: 'https://docs.getmunin.com/mcp/chatgpt',
      docsLabel: 'docs.getmunin.com/mcp/chatgpt',
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
      docsHref: 'https://docs.getmunin.com/mcp/gemini',
      docsLabel: 'docs.getmunin.com/mcp/gemini',
    },
  ];
}

/** Static fallback used before the runtime fetch resolves. */
export const MCP_SETUPS: McpSetup[] = buildMcpSetups('https://mcp.getmunin.com');
