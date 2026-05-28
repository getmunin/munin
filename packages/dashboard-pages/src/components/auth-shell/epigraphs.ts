export const AUTH_STATES = [
  'login',
  'login-error',
  'signup',
  'forgot',
  'reset',
  'reset-done',
  'invite',
  'invite-bad',
] as const;

export type AuthState = (typeof AUTH_STATES)[number];

export type AuthFooter = readonly [string, ...string[]];

export const OSS_AUTH_FOOTER: AuthFooter = ['Open source', 'MIT licensed', 'MCP-first'];

export const CLOUD_AUTH_FOOTER: AuthFooter = ['MCP-first', 'EU data residency'];
