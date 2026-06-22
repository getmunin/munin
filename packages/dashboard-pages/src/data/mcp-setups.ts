export interface McpSetup {
  id: 'claude' | 'chatgpt' | 'gemini';
  label: string;
  sublabel: string;
  snippet: string;
  docsHref: string;
  docsLabel: string;
}

const TOKEN_PLACEHOLDER = 'mn_live_••••••••';

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
      docsHref: `${docs}/guides/connect-claude`,
      docsLabel: `${docsBare}/guides/connect-claude`,
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
      docsHref: `${docs}/guides/connect-chatgpt`,
      docsLabel: `${docsBare}/guides/connect-chatgpt`,
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
      docsHref: `${docs}/guides/connect-gemini`,
      docsLabel: `${docsBare}/guides/connect-gemini`,
    },
  ];
}

const DEFAULT_MCP_HOST = (process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp').replace(/\/+$/, '');
export const DEFAULT_DOCS_HOST = (process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3000/docs').replace(/\/+$/, '');

export const MCP_SETUPS: McpSetup[] = buildMcpSetups(DEFAULT_MCP_HOST, DEFAULT_DOCS_HOST);
