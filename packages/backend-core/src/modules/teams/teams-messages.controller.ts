import { Body, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import { describeError } from '@getmunin/core';
import { PublicController } from '../../common/auth/auth.guard.ts';
import { schema } from '@getmunin/db';
import { TeamsActivitySchema, type TeamsInboundActivity } from './teams-activity.ts';
import { BotFrameworkKeyStore, verifyBotFrameworkToken, type BotFrameworkKeyResolver } from './teams-auth.ts';
import { TeamsInboundService } from './teams-inbound.service.ts';
import { TeamsInteractionsService } from './teams-interactions.service.ts';
import type { InvokeResponse } from './teams-projection.ts';
import { isAllowedServiceUrl } from './teams.constants.ts';

type IntegrationRow = typeof schema.teamsIntegrations.$inferSelect;

export interface TeamsActivityReceiver {
  integrationForApp(appId: string): Promise<IntegrationRow | null>;
  tenantMatches(integration: IntegrationRow, activity: TeamsInboundActivity): boolean;
  processActivity(integration: IntegrationRow, activity: TeamsInboundActivity): Promise<void>;
}

export interface TeamsInvokeHandler {
  handleInvoke(integration: IntegrationRow, activity: TeamsInboundActivity): Promise<InvokeResponse>;
}

export interface TeamsHttpRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface TeamsHttpResponse {
  status(code: number): { json(body: unknown): unknown };
}

@PublicController('v1/teams', { throttle: true })
export class TeamsMessagesController {
  private readonly logger = new Logger(TeamsMessagesController.name);

  constructor(
    @Inject(TeamsInboundService) private readonly inbound: TeamsActivityReceiver,
    @Inject(TeamsInteractionsService) private readonly interactions: TeamsInvokeHandler,
    @Inject(BotFrameworkKeyStore) private readonly keys: BotFrameworkKeyResolver,
  ) {}

  @Post('messages')
  async handle(
    @Body() body: unknown,
    @Req() req: TeamsHttpRequest,
    @Res() res: TeamsHttpResponse,
  ): Promise<void> {
    const serviceUrl =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>).serviceUrl : null;
    const verification = await verifyBotFrameworkToken({
      authorization: req.headers.authorization,
      activityServiceUrl: serviceUrl,
      isKnownAppId: async (appId) => (await this.inbound.integrationForApp(appId)) !== null,
      keys: this.keys,
    });
    if (!verification.ok) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const parsed = TeamsActivitySchema.safeParse(body);
    if (!parsed.success || !isAllowedServiceUrl(parsed.data.serviceUrl)) {
      res.status(400).json({ error: 'invalid activity' });
      return;
    }
    const activity = parsed.data;
    const integration = await this.inbound.integrationForApp(verification.appId);
    if (!integration || !this.inbound.tenantMatches(integration, activity)) {
      res.status(200).json({});
      return;
    }

    if (activity.type === 'invoke') {
      try {
        const response = await this.interactions.handleInvoke(integration, activity);
        res.status(response.status).json(response.body);
      } catch (err) {
        this.logger.error(`teams invoke failed: ${describeError(err)}`);
        res.status(500).json({ statusCode: 500, type: 'application/vnd.microsoft.error', value: { message: 'internal error' } });
      }
      return;
    }

    res.status(200).json({});
    void this.inbound.processActivity(integration, activity).catch((err: unknown) => {
      this.logger.error(`teams activity processing failed: ${describeError(err)}`);
    });
  }
}
