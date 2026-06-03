import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller.ts';
import { EndUsersController } from './end-users.controller.ts';
import { DelegatedTokenController } from './delegated-token.controller.ts';
import { TokensController } from './tokens.controller.ts';
import { OrgsController } from './orgs.controller.ts';
import { SkillsController } from './skills.controller.ts';
import { AssistantsController } from './assistants.controller.ts';
import { AuditLogController } from './audit-log.controller.ts';
import { UsageController } from './usage.controller.ts';
import { UsageStatsController } from './usage-stats.controller.ts';
import { ExportController } from './export.controller.ts';
import { WebhooksController } from './webhooks.controller.ts';
import { CmsDeliveryController } from './cms-delivery.controller.ts';
import { CmsDraftsController } from './cms-drafts.controller.ts';
import { CmsModule } from '../modules/cms/cms.module.ts';
import { ConvModule } from '../modules/conv/conv.module.ts';
import { CrmModule } from '../modules/crm/crm.module.ts';
import { KbModule } from '../modules/kb/kb.module.ts';
import { CuratorModule } from '../modules/curator/curator.module.ts';
import { CuratorJobsController } from './curator-jobs.controller.ts';
import { ConvChannelsController } from './conv-channels.controller.ts';
import { KbCandidatesController, KbSpacesController } from './kb-candidates.controller.ts';
import { McpModule } from '../mcp/mcp.module.ts';
import { RealtimeModule } from '../realtime/realtime.module.ts';
import { CrmMergeProposalsController } from './crm-merge-proposals.controller.ts';
import { CrmSegmentsController } from './crm-segments.controller.ts';
import { OutreachUnsubscribeController } from './outreach-unsubscribe.controller.ts';
import { EmailOpensController } from './email-opens.controller.ts';
import { OutreachProposalsController } from './outreach-proposals.controller.ts';
import { OutreachModule } from '../modules/outreach/outreach.module.ts';
import { PublicSkillsController } from './public-skills.controller.ts';
import { PublicMcpToolsController } from './public-mcp-tools.controller.ts';
import { InvitationsController } from './invitations.controller.ts';
import { AcceptInvitationController } from './accept-invitation.controller.ts';
import { InvitationsService } from './invitations.service.ts';
import { MembersController } from './members.controller.ts';
import { MembershipsController } from './memberships.controller.ts';
import { ConversationsController } from './conversations.controller.ts';
import { ActivityController } from './activity.controller.ts';
import { EndUserConversationsController } from './end-user-conversations.controller.ts';
import { OverviewController } from './overview.controller.ts';
import { InboxController } from './inbox.controller.ts';
import { AuthProvidersController } from './auth-providers.controller.ts';

/**
 * Control plane: server-to-server REST endpoints used by an org's backend
 * to mint scoped tokens, manage end-users, manage API keys, and read/update
 * org settings.
 *
 * All require admin API key auth. End-user delegated tokens are NOT
 * permitted on these endpoints — that's the privilege boundary.
 */
@Module({
  imports: [
    CmsModule,
    ConvModule,
    CrmModule,
    CuratorModule,
    KbModule,
    McpModule,
    OutreachModule,
    RealtimeModule,
  ],
  controllers: [
    ApiKeysController,
    EndUsersController,
    DelegatedTokenController,
    TokensController,
    OrgsController,
    SkillsController,
    AssistantsController,
    AuditLogController,
    UsageController,
    UsageStatsController,
    ExportController,
    WebhooksController,
    CmsDeliveryController,
    CmsDraftsController,
    InvitationsController,
    AcceptInvitationController,
    MembersController,
    MembershipsController,
    PublicSkillsController,
    PublicMcpToolsController,
    ConvChannelsController,
    ConversationsController,
    ActivityController,
    EndUserConversationsController,
    OverviewController,
    InboxController,
    CrmMergeProposalsController,
    CrmSegmentsController,
    OutreachUnsubscribeController,
    EmailOpensController,
    OutreachProposalsController,
    CuratorJobsController,
    KbCandidatesController,
    KbSpacesController,
    AuthProvidersController,
  ],
  providers: [InvitationsService],
})
export class ControlModule {}
