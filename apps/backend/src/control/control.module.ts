import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller.js';
import { EndUsersController } from './end-users.controller.js';
import { DelegatedTokenController } from './delegated-token.controller.js';
import { TokensController } from './tokens.controller.js';
import { OrgsController } from './orgs.controller.js';
import { PartnerOrgsController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';

/**
 * Control plane: server-to-server REST endpoints used by an org's backend
 * to mint scoped tokens, manage end-users, manage API keys, and read/update
 * org settings.
 *
 * All require admin API key auth (or partner API key, scoped to provisioned
 * orgs). End-user delegated tokens are NOT permitted on these endpoints —
 * that's the privilege boundary.
 */
@Module({
  controllers: [
    ApiKeysController,
    EndUsersController,
    DelegatedTokenController,
    TokensController,
    OrgsController,
    PartnerOrgsController,
  ],
  providers: [PartnersService],
})
export class ControlModule {}
