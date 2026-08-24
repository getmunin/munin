import { Get, Header, Inject, Param } from '@nestjs/common';
import type { Db } from '@getmunin/db';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';
import { readOrgConnectorJwks } from '../modules/connectors/external-mcp.ts';

@PublicController('v1/public/connectors', { throttle: true })
export class ConnectorJwksController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(':orgId/jwks')
  @Header('cache-control', 'public, max-age=300, stale-while-revalidate=3600')
  jwks(@Param('orgId') orgId: string): Promise<{ keys: Record<string, unknown>[] }> {
    return readOrgConnectorJwks(this.db, orgId);
  }
}
