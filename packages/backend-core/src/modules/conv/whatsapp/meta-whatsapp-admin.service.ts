import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentModeSchema, sensitive } from '@getmunin/types';
import { MetaGraphClientService } from './meta-graph-client.service.ts';
import {
  MetaWhatsAppService,
  jsonbToStored,
  type MetaWhatsAppChannelDto,
} from './meta-whatsapp.service.ts';

export const ConfigureInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional(),
  defaultAgentMode: AgentModeSchema.optional().describe(
    "How the agent handles inbound WhatsApp messages on this channel: 'auto' replies directly, 'draft_only' files a draft for a human, 'off' does neither.",
  ),
  wabaId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('WhatsApp Business Account ID, from Meta Business Manager or the app’s WhatsApp → API Setup page. Required on create.'),
  phoneNumberId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Phone number ID of the WhatsApp sender (not the phone number itself), from WhatsApp → API Setup. Required on create.'),
  graphApiVersion: z
    .string()
    .regex(/^v\d{1,3}\.\d{1,2}$/)
    .optional()
    .describe('Graph API version to call, e.g. "v23.0". Defaults to the version Munin is tested against.'),
  accessToken: sensitive(
    z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe(
        'Permanent system-user access token with whatsapp_business_messaging and whatsapp_business_management. Required on create; on update, omit to keep the stored token.',
      ),
  ),
  appSecret: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'The Meta app’s App Secret (App settings → Basic), used to verify webhook signatures. Required on create; on update, omit to keep the stored secret.',
      ),
  ),
});

@Injectable()
export class MetaWhatsAppAdminService {
  constructor(
    @Inject(MetaWhatsAppService) private readonly svc: MetaWhatsAppService,
    @Inject(MetaGraphClientService) private readonly client: MetaGraphClientService,
  ) {}

  completeSetup(
    channelId: string,
    secrets: Record<string, string>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    return this.svc.completeSetup(channelId, secrets);
  }

  async configure(args: z.infer<typeof ConfigureInput>): Promise<MetaWhatsAppChannelDto> {
    if (args.channelId) {
      return this.svc.updateChannel({
        channelId: args.channelId,
        name: args.name,
        defaultAgentMode: args.defaultAgentMode,
        config: {
          wabaId: args.wabaId,
          phoneNumberId: args.phoneNumberId,
          graphApiVersion: args.graphApiVersion,
          accessToken: args.accessToken,
          appSecret: args.appSecret,
        },
      });
    }
    if (!args.name) throw new BadRequestException('name is required when creating a channel');
    if (!args.wabaId) throw new BadRequestException('wabaId is required when creating a channel');
    if (!args.phoneNumberId) {
      throw new BadRequestException('phoneNumberId is required when creating a channel');
    }
    if (!args.accessToken) throw new BadRequestException('accessToken is required when creating a channel');
    if (!args.appSecret) throw new BadRequestException('appSecret is required when creating a channel');
    return this.svc.createChannel({
      name: args.name,
      defaultAgentMode: args.defaultAgentMode,
      config: {
        wabaId: args.wabaId,
        phoneNumberId: args.phoneNumberId,
        graphApiVersion: args.graphApiVersion,
        accessToken: args.accessToken,
        appSecret: args.appSecret,
      },
    });
  }

  async testChannel(args: { channelId: string }): Promise<
    | {
        ok: true;
        phoneNumberId: string;
        displayPhoneNumber: string | null;
        verifiedName: string | null;
        qualityRating: string | null;
      }
    | { ok: false; error: string }
  > {
    const channel = await this.svc.loadChannel(args.channelId);
    const stored = jsonbToStored(channel.config);
    try {
      const auth = await this.svc.authFor(stored);
      const phone = await this.client.getPhoneNumber(auth, stored.phoneNumberId);
      return {
        ok: true,
        phoneNumberId: phone.id,
        displayPhoneNumber: phone.displayPhoneNumber,
        verifiedName: phone.verifiedName,
        qualityRating: phone.qualityRating,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendTest(args: {
    channelId: string;
    to: string;
    body?: string;
    templateName?: string;
    templateLanguage?: string;
  }): Promise<{ delivered: true; wamid: string; kind: 'text' | 'template' }> {
    const channel = await this.svc.loadChannel(args.channelId);
    const stored = jsonbToStored(channel.config);
    const auth = await this.svc.authFor(stored);
    try {
      if (args.templateName) {
        const res = await this.client.sendTemplate(auth, stored.phoneNumberId, args.to, {
          name: args.templateName,
          language: args.templateLanguage ?? 'en_US',
          parameters: {},
        });
        return { delivered: true, wamid: res.wamid, kind: 'template' };
      }
      const body = args.body ?? 'Munin test message — outbound WhatsApp is working.';
      const res = await this.client.sendText(auth, stored.phoneNumberId, args.to, body);
      return { delivered: true, wamid: res.wamid, kind: 'text' };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }
}
