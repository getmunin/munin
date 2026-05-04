#!/usr/bin/env node
import {
  createConversationHandler,
  createMuninRestClient,
  createPromptResolver,
  createRealtimeClient,
  defaultPromptsDir,
  openMcpClient,
} from '../packages/agent-runtime/dist/index.js';

const {
  MUNIN_BASE_URL = 'http://localhost:3001',
  MUNIN_ADMIN_API_KEY,
  MUNIN_PROVIDER_BASE_URL = 'https://openrouter.ai/api/v1',
  MUNIN_PROVIDER_API_KEY,
  MUNIN_MODEL = 'openai/gpt-oss-120b:free',
} = process.env;

if (!MUNIN_ADMIN_API_KEY) {
  console.error('MUNIN_ADMIN_API_KEY required');
  process.exit(1);
}
if (!MUNIN_PROVIDER_API_KEY) {
  console.error('MUNIN_PROVIDER_API_KEY required (e.g. OpenRouter key)');
  process.exit(1);
}

const log = {
  info: (m) => console.log(`[runner] ${m}`),
  warn: (m) => console.warn(`[runner] ${m}`),
  error: (m) => console.error(`[runner] ${m}`),
};

const rest = createMuninRestClient({
  baseUrl: MUNIN_BASE_URL,
  adminApiKey: MUNIN_ADMIN_API_KEY,
});

const adminMcp = await openMcpClient({
  baseUrl: MUNIN_BASE_URL,
  bearerToken: MUNIN_ADMIN_API_KEY,
  clientName: 'self-service-runner-local',
});

const prompts = await createPromptResolver({
  promptsDir: defaultPromptsDir(),
  mcp: adminMcp,
  logger: log,
});

const handler = createConversationHandler({
  config: {
    providerBaseUrl: MUNIN_PROVIDER_BASE_URL,
    providerApiKey: MUNIN_PROVIDER_API_KEY,
    model: MUNIN_MODEL,
    maxToolIterations: 8,
    maxHistoryChars: 32_000,
    debounceMs: 500,
  },
  rest,
  prompts,
  openMcp: ({ delegatedToken }) =>
    openMcpClient({ baseUrl: MUNIN_BASE_URL, bearerToken: delegatedToken }),
  logger: log,
});

const realtime = createRealtimeClient({
  baseUrl: MUNIN_BASE_URL,
  adminApiKey: MUNIN_ADMIN_API_KEY,
  onMessageReceived: (event) =>
    handler.handle({
      conversationId: event.conversationId,
      authorType: event.authorType,
    }),
  onKbDocumentChanged: (event) => {
    if (event.type === 'deleted') return;
    if (!event.slug || !prompts.isPromptDocument(event.slug)) return;
    void prompts.refresh(event.slug);
  },
  logger: log,
});
realtime.start();

log.info(`listening on ${MUNIN_BASE_URL}/api/realtime — model=${MUNIN_MODEL}`);
log.info('waiting for end-user messages…');

const shutdown = async () => {
  log.info('shutting down');
  await realtime.stop();
  await handler.flush();
  await adminMcp.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
