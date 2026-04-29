import 'reflect-metadata';
import { createApp } from '@getmunin/backend-core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await createApp(AppModule);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`munin-backend listening on :${port}`);
}

void bootstrap();
