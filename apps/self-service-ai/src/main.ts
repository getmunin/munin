import { loadConfigFromEnv } from './config.js';
import { createConversationHandler } from './conversation-handler.js';
import { createMuninRestClient } from './munin-rest.js';
import { openMcpClient } from './mcp-client.js';
import { createRealtimeClient } from './realtime.js';

function main(): void {
  const config = loadConfigFromEnv();
  const rest = createMuninRestClient({
    baseUrl: config.muninBaseUrl,
    adminApiKey: config.muninAdminApiKey,
  });
  const handler = createConversationHandler({
    config,
    rest,
    openMcp: ({ delegatedToken }) =>
      openMcpClient({ baseUrl: config.muninBaseUrl, delegatedToken }),
  });
  const realtime = createRealtimeClient({
    baseUrl: config.muninBaseUrl,
    adminApiKey: config.muninAdminApiKey,
    onMessageReceived: (event) => handler.handle(event),
  });
  realtime.start();
  console.log(
    `[self-service-ai] connected to ${config.muninBaseUrl}, model=${config.model}, debounce=${config.debounceMs}ms`,
  );

  const shutdown = async (): Promise<void> => {
    console.log('[self-service-ai] shutting down…');
    await realtime.stop();
    await handler.flush();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

try {
  main();
} catch (err) {
  console.error('[self-service-ai] fatal:', err);
  process.exit(1);
}
