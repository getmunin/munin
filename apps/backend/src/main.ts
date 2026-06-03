import './load-env.js';
import './instrument.js';
import 'reflect-metadata';
import { setDefaultResultOrder } from 'node:dns';
import { createApp } from '@getmunin/backend-core';
import { parseEnvInt } from '@getmunin/core';
import { AppModule } from './app.module.ts';

setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const widgetAssetDir = process.env.MUNIN_WIDGET_ASSET_DIR?.trim() || undefined;
  const app = await createApp(AppModule, widgetAssetDir ? { widgetAssetDir } : undefined);
  app.enableShutdownHooks();
  const port = parseEnvInt({ name: 'PORT', default: 3001 });
  await app.listen(port);
  console.log(`munin-backend listening on :${port}`);
}

void bootstrap();
