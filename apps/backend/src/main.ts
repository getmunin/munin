import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const DEFAULT_DEV_WEB_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function readAllowedOrigins(): string[] | true {
  const env = process.env.MUNIN_CORS_ORIGINS;
  if (!env) return DEFAULT_DEV_WEB_ORIGINS;
  if (env === '*') return true;
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: readAllowedOrigins(),
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`munin-backend listening on :${port}`);
}

void bootstrap();
