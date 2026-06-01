import {
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';

interface OAuthClientInfo {
  client_id: string;
  name: string | null;
  uri: string | null;
  icon: string | null;
}

/**
 * Public lookup for the disclosure fields of a registered OAuth client.
 * The consent page renders the client's human-facing name + URL + logo
 * instead of the random RFC 7591 `client_id`. Strictly disclosure-only:
 * we never return `clientSecret`, `redirectUris`, or anything else the
 * caller could weaponize.
 *
 * Anonymous on purpose — the consent page is rendered for any user
 * mid-authorization, before the OAuth flow has issued any credential.
 */
@PublicController('v1/oauth/clients')
export class OAuthClientInfoController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(':clientId')
  @Header('cache-control', 'public, max-age=60')
  async lookup(@Param('clientId') clientId: string): Promise<OAuthClientInfo> {
    const rows = await this.db
      .select({
        clientId: schema.oauthClient.clientId,
        name: schema.oauthClient.name,
        uri: schema.oauthClient.uri,
        icon: schema.oauthClient.icon,
        disabled: schema.oauthClient.disabled,
      })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, clientId))
      .limit(1);
    const row = rows[0];
    if (!row || row.disabled) throw new NotFoundException('oauth_client_not_found');
    return {
      client_id: row.clientId,
      name: row.name ?? null,
      uri: row.uri ?? null,
      icon: row.icon ?? null,
    };
  }
}
