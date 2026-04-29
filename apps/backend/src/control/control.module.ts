import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller.js';
import { EndUsersController } from './end-users.controller.js';
import { DelegatedTokenController } from './delegated-token.controller.js';
import { TokensController } from './tokens.controller.js';
import { OrgsController } from './orgs.controller.js';
import { PartnerOrgsController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';
import { AuditLogController } from './audit-log.controller.js';
import { UsageController } from './usage.controller.js';
import { SuggestionsAdminController } from './suggestions.controller.js';
import { SuggestionsModule } from '../modules/suggestions/suggestions.module.js';
import { ExportController } from './export.controller.js';
import { WebhooksController } from './webhooks.controller.js';
import { PublicSuggestionsController } from './public-suggestions.controller.js';
import { CmsDeliveryController } from './cms-delivery.controller.js';
import { CmsModule } from '../modules/cms/cms.module.js';
import { InvitationsController } from './invitations.controller.js';
import { AcceptInvitationController } from './accept-invitation.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembersController } from './members.controller.js';

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
  imports: [SuggestionsModule, CmsModule],
  controllers: [
    ApiKeysController,
    EndUsersController,
    DelegatedTokenController,
    TokensController,
    OrgsController,
    PartnerOrgsController,
    AuditLogController,
    UsageController,
    SuggestionsAdminController,
    ExportController,
    WebhooksController,
    PublicSuggestionsController,
    CmsDeliveryController,
    InvitationsController,
    AcceptInvitationController,
    MembersController,
  ],
  providers: [PartnersService, InvitationsService],
})
export class ControlModule {}
