import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { SkillRegistry, type RegisteredSkill } from '@getmunin/mcp-toolkit';
import { McpSkillRegistryService } from '../mcp/mcp.skill-registry.service.js';
import { PublicSkillsController } from './public-skills.controller.js';

class StubSkillRegistry extends SkillRegistry {
  instructions(): string {
    return '';
  }
}

const PUBLIC_ADMIN_SKILL: RegisteredSkill = {
  uri: 'skill://conv/email-channel-setup',
  name: 'Email channel setup',
  description: 'Configure an inbound email channel.',
  audiences: ['admin'],
  mimeType: 'text/markdown',
  content: '# Email channel setup\n\nStep one.\n',
  public: true,
};

const PUBLIC_SELF_SERVICE_SKILL: RegisteredSkill = {
  uri: 'skill://kb/article-bulk-import',
  name: 'Article bulk import',
  description: 'Import articles in bulk.',
  audiences: ['admin', 'self_service'],
  mimeType: 'text/markdown',
  content: 'bulk import body',
  public: true,
};

const INTERNAL_SKILL: RegisteredSkill = {
  uri: 'skill://crm/internal-only',
  name: 'Internal only',
  description: 'Should not appear on the public API.',
  audiences: ['admin'],
  mimeType: 'text/markdown',
  content: 'internal',
  public: false,
};

@Module({
  controllers: [PublicSkillsController],
  providers: [
    {
      provide: McpSkillRegistryService,
      useFactory: (): StubSkillRegistry => {
        const reg = new StubSkillRegistry();
        reg.register(PUBLIC_ADMIN_SKILL);
        reg.register(PUBLIC_SELF_SERVICE_SKILL);
        reg.register(INTERNAL_SKILL);
        return reg;
      },
    },
  ],
})
class TestModule {}

describe('PublicSkillsController', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected an AddressInfo from app.getHttpServer()');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/public/skills returns only public skills', async () => {
    const res = await fetch(`${baseUrl}/api/public/skills`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ uri: string }>;
    const uris = body.map((s) => s.uri).sort();
    expect(uris).toEqual([
      'skill://conv/email-channel-setup',
      'skill://kb/article-bulk-import',
    ]);
    expect(uris).not.toContain('skill://crm/internal-only');
  });

  it('GET /api/public/skills returns the documented list shape', async () => {
    const res = await fetch(`${baseUrl}/api/public/skills`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const item = body.find((s) => s.uri === 'skill://conv/email-channel-setup')!;
    expect(item).toEqual({
      uri: 'skill://conv/email-channel-setup',
      module: 'conv',
      slug: 'email-channel-setup',
      title: 'Email channel setup',
      description: 'Configure an inbound email channel.',
    });
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('mimeType');
  });

  it('GET /api/public/skills/:module/:slug returns the full detail', async () => {
    const res = await fetch(`${baseUrl}/api/public/skills/conv/email-channel-setup`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      uri: 'skill://conv/email-channel-setup',
      module: 'conv',
      slug: 'email-channel-setup',
      title: 'Email channel setup',
      description: 'Configure an inbound email channel.',
      content: '# Email channel setup\n\nStep one.\n',
      mimeType: 'text/markdown',
    });
  });

  it('GET /api/public/skills/:module/:slug returns 404 for an unknown slug', async () => {
    const res = await fetch(`${baseUrl}/api/public/skills/conv/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('GET /api/public/skills/:module/:slug returns 404 for an unknown module', async () => {
    const res = await fetch(`${baseUrl}/api/public/skills/no-such-module/email-channel-setup`);
    expect(res.status).toBe(404);
  });

  it('GET /api/public/skills/:module/:slug returns 404 for a registered but non-public skill', async () => {
    const res = await fetch(`${baseUrl}/api/public/skills/crm/internal-only`);
    expect(res.status).toBe(404);
  });

  it('does not require an Authorization header', async () => {
    const list = await fetch(`${baseUrl}/api/public/skills`, { headers: {} });
    expect(list.status).toBe(200);
    const detail = await fetch(`${baseUrl}/api/public/skills/conv/email-channel-setup`, {
      headers: {},
    });
    expect(detail.status).toBe(200);
  });
});
