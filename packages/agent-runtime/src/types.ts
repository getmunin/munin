export type AuthorType = 'user' | 'agent' | 'end_user' | 'system' | 'staff';

export interface ConversationMessage {
  authorType: AuthorType;
  body: string;
  createdAt?: string;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
}

export interface AgentConfig {
  provider: ProviderConfig;
  model: string;
  systemPrompt: string;
  maxToolIterations?: number;
  maxTokens?: number;
  temperature?: number;
  maxHistoryChars?: number;
  responseFormat?: 'json_object';
  enablePromptCache?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: string; [key: string]: unknown }>;
  isError?: boolean;
}

export interface McpToolHandle {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  result: McpToolResult;
}

export interface AgentReply {
  body: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: 'stop' | 'length' | 'tool_iteration_limit' | 'error';
  toolCalls: ToolCallTrace[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ProviderResponse {
  message: ChatMessage;
  usage?: ProviderUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface ProviderCallArgs {
  config: AgentConfig;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  abortSignal?: AbortSignal;
}

export type Provider = (args: ProviderCallArgs) => Promise<ProviderResponse>;
