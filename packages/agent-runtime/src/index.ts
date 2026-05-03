export { runAgent, compactHistory } from './runtime.js';
export { openAiCompatibleProvider, ProviderError } from './providers/openai-compatible.js';
export { createStubProvider, type StubProviderHandle, type StubScript } from './providers/stub.js';
export { mcpToolsToChatTools, flattenToolResult } from './mcp-tool-translation.js';
export type {
  AgentConfig,
  AgentReply,
  AuthorType,
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
  ConversationMessage,
  McpTool,
  McpToolHandle,
  McpToolResult,
  Provider,
  ProviderCallArgs,
  ProviderConfig,
  ProviderResponse,
  ProviderUsage,
  ToolCallTrace,
} from './types.js';
