import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createConversationHandler,
  createMuninRestClient,
  createPromptResolver,
  createRealtimeClient,
  openMcpClient,
} from '@getmunin/agent-runtime';
import { loadConfigFromEnv } from './config.js';
import { startCurators } from './curator-loop.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const rest = createMuninRestClient({
    baseUrl: config.muninBaseUrl,
    adminApiKey: config.muninAdminApiKey,
  });

  const adminMcp = await openMcpClient({
    baseUrl: config.muninBaseUrl,
    bearerToken: config.muninAdminApiKey,
    clientName: 'munin-agent-sidecar-admin',
  });

  const prompts = await createPromptResolver({
    promptsDir: config.promptsDir,
    mcp: adminMcp,
  });

  const holderId = process.env.MUNIN_SIDECAR_HOLDER_ID ?? `sidecar-${hostname()}-${randomUUID().slice(0, 8)}`;
  const handler = createConversationHandler({
    config,
    rest,
    prompts,
    openMcp: ({ delegatedToken }) =>
      openMcpClient({ baseUrl: config.muninBaseUrl, bearerToken: delegatedToken }),
    holderId,
  });

  const curators = startCurators({ config, rest });

  const realtime = createRealtimeClient({
    baseUrl: config.muninBaseUrl,
    adminApiKey: config.muninAdminApiKey,
    onMessageReceived: (event) => handler.handle(event),
    onCuratorJobPending: (event) => curators.onCuratorJobPending(event),
    onConnected: () => curators.onConnected(),
    onKbDocumentChanged: (event) => {
      if (event.type === 'deleted') return;
      if (!event.slug || !prompts.isPromptDocument(event.slug)) return;
      void prompts.refresh(event.slug);
    },
  });
  realtime.start();
  console.log(
    `[agent-sidecar] connected to ${config.muninBaseUrl}, model=${config.model}, holder=${holderId}, prompts=${config.promptsDir}, debounce=${config.debounceMs}ms, curators=${config.curatorsDisabled ? 'off' : 'on'}`,
  );

  const shutdown = async (): Promise<void> => {
    console.log('[agent-sidecar] shutting down…');
    await realtime.stop();
    await handler.flush();
    await curators.stop();
    await adminMcp.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error('[agent-sidecar] fatal:', err);
  process.exit(1);
});
