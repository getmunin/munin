import { loadConfigFromEnv } from './config.js';
import { createConversationHandler } from './conversation-handler.js';
import { createMuninRestClient } from './munin-rest.js';
import { openMcpClient } from './mcp-client.js';
import { createPromptResolver } from '@getmunin/agent-runtime';
import { createRealtimeClient } from './realtime.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const rest = createMuninRestClient({
    baseUrl: config.muninBaseUrl,
    adminApiKey: config.muninAdminApiKey,
  });

  const adminMcp = await openMcpClient({
    baseUrl: config.muninBaseUrl,
    bearerToken: config.muninAdminApiKey,
    clientName: 'munin-self-service-ai-admin',
  });

  const prompts = await createPromptResolver({
    promptsDir: config.promptsDir,
    mcp: adminMcp,
  });

  const handler = createConversationHandler({
    config,
    rest,
    prompts,
    openMcp: ({ delegatedToken }) =>
      openMcpClient({ baseUrl: config.muninBaseUrl, bearerToken: delegatedToken }),
  });

  const realtime = createRealtimeClient({
    baseUrl: config.muninBaseUrl,
    adminApiKey: config.muninAdminApiKey,
    onMessageReceived: (event) => handler.handle(event),
    onKbDocumentChanged: (event) => {
      if (event.type === 'deleted') return;
      if (!event.slug || !prompts.isPromptDocument(event.slug)) return;
      void prompts.refresh(event.slug);
    },
  });
  realtime.start();
  console.log(
    `[self-service-ai] connected to ${config.muninBaseUrl}, model=${config.model}, prompts=${config.promptsDir}, debounce=${config.debounceMs}ms`,
  );

  const shutdown = async (): Promise<void> => {
    console.log('[self-service-ai] shutting down…');
    await realtime.stop();
    await handler.flush();
    await adminMcp.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error('[self-service-ai] fatal:', err);
  process.exit(1);
});
