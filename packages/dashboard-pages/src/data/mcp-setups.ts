export interface McpSetup {
  id: 'claude' | 'chatgpt' | 'gemini';
  label: string;
  sublabel: string;
  snippet: string;
  docsHref: string;
  docsLabel: string;
}

const HOST = 'https://mcp.getmunin.com';
const TOKEN_PLACEHOLDER = 'mn_live_••••••••';

export const MCP_SETUPS: McpSetup[] = [
  {
    id: 'claude',
    label: 'Claude',
    sublabel: 'Desktop & Web',
    snippet: `// claude_desktop_config.json
{
  "mcpServers": {
    "munin": {
      "url": "${HOST}",
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
  "url":  "${HOST}",
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
      "url": "${HOST}",
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
