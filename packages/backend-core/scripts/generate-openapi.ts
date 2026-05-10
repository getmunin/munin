import 'reflect-metadata';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module.js';
import { ALLOW_ANONYMOUS, AuthGuard } from '../src/common/auth/auth.guard.js';

const GUARDS_METADATA = '__guards__';

process.env.DATABASE_URL ??= 'postgres://noop:noop@127.0.0.1:5432/noop';
process.env.MUNIN_AUTH_SECRET ??= 'spec-generation-do-not-use-in-prod-32chars!!';
process.env.MUNIN_KEY_PEPPER ??= 'spec-pepper';
process.env.MUNIN_EMBEDDING_PROVIDER ??= 'stub';
process.env.MUNIN_MAIL_PROVIDER ??= 'stub';
process.env.MUNIN_STORAGE_PROVIDER ??= 'local';
process.env.MUNIN_STORAGE_LOCAL_PATH ??= '/tmp/munin-openapi-spec';
process.env.MUNIN_STORAGE_LOCAL_BASE_URL ??= 'http://127.0.0.1/static';
process.env.MUNIN_WEBHOOK_WORKER_DISABLED ??= '1';
process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED ??= '1';
process.env.MUNIN_BUILTIN_AGENT ??= '0';
process.env.MUNIN_REALTIME_DISABLED ??= '1';
process.env.MUNIN_PUBLIC_URL ??= 'http://127.0.0.1';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(process.env.OPENAPI_OUT ?? join(here, '..', 'openapi.json'));

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });

  const config = new DocumentBuilder()
    .setTitle('Munin')
    .setDescription(
      'HTTP surface area for the Munin platform. Authenticate with a bearer token (admin API key or delegated end-user token) or a session cookie.',
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'bearer')
    .addCookieAuth('munin_session', { type: 'apiKey', in: 'cookie', name: 'munin_session' }, 'session')
    .addServer('https://api.munin.eu', 'EU production')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  document.openapi = '3.1.0';

  applySecurityFromAllowAnonymous(app, document);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(document, null, 2));

  const pathCount = Object.keys(document.paths ?? {}).length;
  const opCount = Object.values(document.paths ?? {}).reduce((sum, item) => {
    if (!item) return sum;
    return sum + Object.keys(item).filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k)).length;
  }, 0);
  console.log(`wrote ${outFile}  (${pathCount} paths, ${opCount} operations)`);

  await app.close();
}

type Doc = ReturnType<typeof SwaggerModule.createDocument>;
type AppType = Awaited<ReturnType<typeof NestFactory.create>>;

function applySecurityFromAllowAnonymous(app: AppType, document: Doc) {
  const routesByOperationId = new Map<string, { authed: boolean }>();
  const container = (app as unknown as {
    container: {
      getModules(): Map<
        string,
        { controllers: Map<string, { instance: object | null; metatype: unknown }> }
      >;
    };
  }).container;

  for (const mod of container.getModules().values()) {
    for (const wrapper of mod.controllers.values()) {
      const instance = wrapper.instance as Record<string, unknown> | null;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const ctor = wrapper.metatype as { name?: string } | undefined;
      const ctorAnon = ctor ? Reflect.getMetadata(ALLOW_ANONYMOUS, ctor) === true : false;
      const ctorGuards = (ctor ? (Reflect.getMetadata(GUARDS_METADATA, ctor) as unknown[] | undefined) : undefined) ?? [];
      const methodNames = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
      for (const name of methodNames) {
        const fn = (instance as Record<string, unknown>)[name];
        if (typeof fn !== 'function') continue;
        const methodAnon = Reflect.getMetadata(ALLOW_ANONYMOUS, proto, name) === true;
        const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, proto, name) as unknown[] | undefined) ?? [];
        const guards = [...ctorGuards, ...methodGuards];
        const hasAuthGuard = guards.includes(AuthGuard);
        const authed = hasAuthGuard && !ctorAnon && !methodAnon;
        const opId = `${ctor?.name ?? 'Unknown'}_${name}`;
        routesByOperationId.set(opId, { authed });
      }
    }
  }

  for (const path of Object.values(document.paths ?? {})) {
    if (!path) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = (path as Record<string, { operationId?: string; security?: unknown[] }>)[method];
      if (!op || !op.operationId) continue;
      const meta = routesByOperationId.get(op.operationId);
      if (!meta) continue;
      op.security = meta.authed ? [{ bearer: [] }, { session: [] }] : [];
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
