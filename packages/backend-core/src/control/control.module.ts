import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller.js';
import { EndUsersController } from './end-users.controller.js';
import { DelegatedTokenController } from './delegated-token.controller.js';
import { TokensController } from './tokens.controller.js';
import { OrgsController } from './orgs.controller.js';
import { AuditLogController } from './audit-log.controller.js';
import { UsageController } from './usage.controller.js';
import { ExportController } from './export.controller.js';
import { WebhooksController } from './webhooks.controller.js';
import { CmsDeliveryController } from './cms-delivery.controller.js';
import { CmsModule } from '../modules/cms/cms.module.js';
import { ConvModule } from '../modules/conv/conv.module.js';
import { CrmModule } from '../modules/crm/crm.module.js';
import { McpModule } from '../mcp/mcp.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { CrmMergeProposalsController } from './crm-merge-proposals.controller.js';
import { PublicSkillsController } from './public-skills.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { AcceptInvitationController } from './accept-invitation.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembersController } from './members.controller.js';
import { MembershipsController } from './memberships.controller.js';
import { ConversationsController } from './conversations.controller.js';
import { ActivityController } from './activity.controller.js';
import { EndUserConversationsController } from './end-user-conversations.controller.js';
import { OverviewController } from './overview.controller.js';

/**
 * Control plane: server-to-server REST endpoints used by an org's backend
 * to mint scoped tokens, manage end-users, manage API keys, and read/update
 * org settings.
 *
 * All require admin API key auth. End-user delegated tokens are NOT
 * permitted on these endpoints — that's the privilege boundary.
 */
@Module({
  imports: [CmsModule, ConvModule, CrmModule, McpModule, RealtimeModule],
  controllers: [
    ApiKeysController,
    EndUsersController,
    DelegatedTokenController,
    TokensController,
    OrgsController,
    AuditLogController,
    UsageController,
    ExportController,
    WebhooksController,
    CmsDeliveryController,
    InvitationsController,
    AcceptInvitationController,
    MembersController,
    MembershipsController,
    PublicSkillsController,
    ConversationsController,
    ActivityController,
    EndUserConversationsController,
    OverviewController,
    CrmMergeProposalsController,
  ],
  providers: [InvitationsService],
})
export class ControlModule {}
