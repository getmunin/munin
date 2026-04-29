import { createApp } from './bootstrap-app.js';

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`munin-backend listening on :${port}`);
}

void bootstrap();
