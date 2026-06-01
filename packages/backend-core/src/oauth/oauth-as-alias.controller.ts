import { Get, Header } from '@nestjs/common';
import { PublicController } from '../common/auth/auth.guard.ts';
import { authorizationServerUrl, SUPPORTED_SCOPES } from './oauth.constants.ts';

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  registration_endpoint: string;
  introspection_endpoint: string;
  revocation_endpoint: string;
  response_types_supported: readonly string[];
  response_modes_supported: readonly string[];
  grant_types_supported: readonly string[];
  token_endpoint_auth_methods_supported: readonly string[];
  code_challenge_methods_supported: readonly string[];
  scopes_supported: readonly string[];
  resource_indicators_supported: boolean;
}

@PublicController('.well-known/oauth-authorization-server')
export class OAuthAsAliasController {
  @Get()
  @Header('content-type', 'application/json; charset=utf-8')
  @Header('cache-control', 'public, max-age=300')
  metadata(): AuthorizationServerMetadata {
    const issuer = authorizationServerUrl();
    const authBase = `${issuer}/auth`;
    return {
      issuer,
      authorization_endpoint: `${authBase}/oauth2/authorize`,
      token_endpoint: `${authBase}/oauth2/token`,
      jwks_uri: `${authBase}/jwks`,
      registration_endpoint: `${authBase}/oauth2/register`,
      introspection_endpoint: `${authBase}/oauth2/introspect`,
      revocation_endpoint: `${authBase}/oauth2/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: [
        'client_secret_basic',
        'client_secret_post',
        'none',
      ],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access', ...SUPPORTED_SCOPES],
      resource_indicators_supported: true,
    };
  }
}
