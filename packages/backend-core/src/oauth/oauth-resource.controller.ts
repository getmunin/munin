import { Get, Header } from '@nestjs/common';
import { PublicController } from '../common/auth/auth.guard.ts';
import {
  authorizationServerUrl,
  mcpResourceUrl,
  SUPPORTED_SCOPES,
} from './oauth.constants.ts';

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: readonly string[];
  bearer_methods_supported: readonly string[];
  resource_documentation?: string;
  resource_indicators_supported: boolean;
}

@PublicController('.well-known/oauth-protected-resource')
export class OAuthResourceController {
  @Get()
  @Header('content-type', 'application/json; charset=utf-8')
  @Header('cache-control', 'public, max-age=3600')
  metadata(): ProtectedResourceMetadata {
    return {
      resource: mcpResourceUrl(),
      authorization_servers: [authorizationServerUrl()],
      scopes_supported: SUPPORTED_SCOPES,
      bearer_methods_supported: ['header'],
      resource_documentation: `${authorizationServerUrl()}/docs`,
      resource_indicators_supported: true,
    };
  }
}
