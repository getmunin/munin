/**
 * @munin/sdk — typed client for the Munin REST API.
 *
 * Used by an org's backend (server-to-server) to mint delegated end-user
 * tokens, look up end-users, send webhook test events, etc. Authenticated
 * with an admin API key.
 *
 * Implementation lands in M0.7. Sketch:
 *
 *   const munin = createMuninClient({
 *     baseUrl: 'https://api.getmunin.com',
 *     adminApiKey: process.env.MUNIN_ADMIN_API_KEY!,
 *   });
 *
 *   const { accessToken, endUserId } = await munin.mintEndUserToken({
 *     externalId: '+4791234567',
 *   });
 */

export interface MuninClientOptions {
  baseUrl: string;
  adminApiKey: string;
  fetch?: typeof fetch;
}

export const PLACEHOLDER = 'to be implemented in M0.7';
