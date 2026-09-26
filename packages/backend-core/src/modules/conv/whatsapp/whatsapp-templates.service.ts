import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { schema } from '@getmunin/db';
import type { AgentMode } from '@getmunin/types';
import { ConvService, type ConversationDetail, type MessageDto } from '../conv.service.ts';
import { findOrCreateContactByPhone } from '../contact-by-phone.ts';
import { MetaGraphClientService } from './meta-graph-client.service.ts';
import { MetaWhatsAppService, jsonbToStored } from './meta-whatsapp.service.ts';
import {
  renderTemplateText,
  toTemplateDto,
  validateTemplateVariables,
  type WhatsAppTemplateDto,
  type WhatsAppTemplateSend,
} from './whatsapp-templates.ts';

export interface SendWhatsAppTemplateInput {
  channelId?: string;
  conversationId?: string;
  contactId?: string;
  templateName: string;
  language: string;
  variables?: Record<string, string>;
  headerVariables?: Record<string, string>;
  author?: { type: 'user' | 'agent'; id: string };
  conversationDefaults?: { outreachCampaignId?: string; agentMode?: AgentMode };
}

export interface PreparedWhatsAppTemplate {
  send: WhatsAppTemplateSend;
  body: string;
}

export interface SendWhatsAppTemplateResult {
  conversationId: string;
  createdConversation: boolean;
  message: MessageDto;
  template: { name: string; language: string; category: string };
}

type ConversationWriter = Pick<ConvService, 'sendMessage' | 'createConversation'>;

interface TemplateTarget {
  channelId: string;
  conversationId: string | null;
  convContactId?: string;
  endUserId?: string | null;
}

@Injectable()
export class WhatsAppTemplatesService {
  constructor(
    @Inject(MetaWhatsAppService) private readonly whatsapp: MetaWhatsAppService,
    @Inject(MetaGraphClientService) private readonly client: MetaGraphClientService,
    @Inject(ConvService) private readonly conv: ConversationWriter,
  ) {}

  async listTemplates(input: { channelId: string; status?: string }): Promise<{
    channelId: string;
    templates: WhatsAppTemplateDto[];
  }> {
    const templates = await this.loadTemplates(input.channelId);
    const status = input.status?.toLowerCase();
    return {
      channelId: input.channelId,
      templates: status ? templates.filter((t) => t.status === status) : templates,
    };
  }

  async listTemplatesForConversation(conversationId: string): Promise<{
    channelId: string;
    templates: WhatsAppTemplateDto[];
  }> {
    const target = await this.resolveConversationTarget(conversationId, undefined);
    return this.listTemplates({ channelId: target.channelId, status: 'approved' });
  }

  async sendTemplate(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult> {
    if (!!input.conversationId === !!input.contactId) {
      throw new BadRequestException(
        'conv_invalid: pass exactly one of conversationId (continue a thread) or contactId (start a new one)',
      );
    }
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const variables = input.variables ?? {};
    const headerVariables = input.headerVariables ?? {};

    const target: TemplateTarget = input.conversationId
      ? await this.resolveConversationTarget(input.conversationId, input.channelId)
      : await this.resolveContactTarget(input.contactId!, input.channelId);

    const { send, body } = await this.prepareTemplate({
      channelId: target.channelId,
      templateName: input.templateName,
      language: input.language,
      variables,
      headerVariables,
    });
    const authorType = input.author?.type ?? (actor.type === 'user' ? ('user' as const) : ('agent' as const));
    const authorId = input.author?.id ?? actor.id;
    const summary = { name: send.name, language: send.language, category: send.category ?? 'unknown' };

    if (target.conversationId) {
      const message = await this.conv.sendMessage({
        conversationId: target.conversationId,
        body,
        authorType,
        authorId,
        whatsappTemplate: send,
      });
      return { conversationId: target.conversationId, createdConversation: false, message, template: summary };
    }

    if (!target.convContactId) {
      throw new BadRequestException('conv_invalid: no conversation contact to start a conversation with');
    }
    const detail: ConversationDetail = await this.conv.createConversation({
      channelId: target.channelId,
      body,
      contactId: target.convContactId,
      ...(target.endUserId ? { endUserId: target.endUserId } : {}),
      ...(input.conversationDefaults?.outreachCampaignId
        ? { outreachCampaignId: input.conversationDefaults.outreachCampaignId }
        : {}),
      ...(input.conversationDefaults?.agentMode ? { agentMode: input.conversationDefaults.agentMode } : {}),
      messageMetadata: { whatsappTemplate: send },
      authorType,
      authorId,
    });
    return {
      conversationId: detail.id,
      createdConversation: true,
      message: detail.messages[0]!,
      template: summary,
    };
  }

  async prepareTemplate(input: {
    channelId: string;
    templateName: string;
    language: string;
    variables?: Record<string, string>;
    headerVariables?: Record<string, string>;
  }): Promise<PreparedWhatsAppTemplate> {
    const variables = input.variables ?? {};
    const headerVariables = input.headerVariables ?? {};
    const templates = await this.loadTemplates(input.channelId);
    const template = templates.find(
      (t) => t.name === input.templateName && t.language === input.language,
    );
    if (!template) {
      const languages = templates.filter((t) => t.name === input.templateName).map((t) => t.language);
      throw new NotFoundException(
        languages.length > 0
          ? `conv_not_found: template "${input.templateName}" has no "${input.language}" translation; available: ${languages.join(', ')}`
          : `conv_not_found: no template named "${input.templateName}" on this WhatsApp Business Account`,
      );
    }
    if (template.status !== 'approved') {
      throw new BadRequestException(
        `conv_invalid: template "${template.name}" (${template.language}) is ${template.status}; only approved templates can be sent`,
      );
    }
    const problem = validateTemplateVariables(template, variables, headerVariables);
    if (problem) throw new BadRequestException(`conv_invalid: ${problem}`);
    return {
      send: {
        name: template.name,
        language: template.language,
        category: template.category,
        parameterFormat: template.parameterFormat,
        variables,
        ...(Object.keys(headerVariables).length > 0 ? { headerVariables } : {}),
      },
      body: renderTemplateText(template, variables, headerVariables),
    };
  }

  private async loadTemplates(channelId: string): Promise<WhatsAppTemplateDto[]> {
    const channel = await this.whatsapp.loadChannel(channelId);
    if (!channel.active) {
      throw new BadRequestException(`conv_invalid: channel ${channelId} is not active`);
    }
    const stored = jsonbToStored(channel.config);
    const auth = await this.whatsapp.authFor(stored);
    const templates = await this.client.listTemplates(auth, stored.wabaId).catch((err: unknown) => {
      throw new BadRequestException(
        `conv_invalid: could not read templates from Meta: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return templates.map(toTemplateDto);
  }

  private async resolveConversationTarget(
    conversationId: string,
    channelId: string | undefined,
  ): Promise<TemplateTarget> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        channelId: schema.convConversations.channelId,
        channelType: schema.convChannels.type,
        phone: schema.convContacts.phone,
      })
      .from(schema.convConversations)
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convConversations.channelId))
      .leftJoin(schema.convContacts, eq(schema.convContacts.id, schema.convConversations.contactId))
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`conv_not_found: conversation ${conversationId}`);
    if (row.channelType !== 'whatsapp') {
      throw new BadRequestException(
        `conv_invalid: conversation ${conversationId} is on a ${row.channelType} channel; templates apply to WhatsApp only`,
      );
    }
    if (channelId && channelId !== row.channelId) {
      throw new BadRequestException(
        `conv_invalid: conversation ${conversationId} belongs to channel ${row.channelId}, not ${channelId}`,
      );
    }
    if (!row.phone) {
      throw new BadRequestException(`conv_invalid: conversation ${conversationId} has no phone number to send to`);
    }
    await this.assertNotSuppressed(row.phone);
    return { channelId: row.channelId, conversationId };
  }

  private async resolveContactTarget(
    contactId: string,
    channelId: string | undefined,
  ): Promise<TemplateTarget> {
    if (!channelId) {
      throw new BadRequestException('conv_invalid: channelId is required when starting a conversation from contactId');
    }
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.orgId, actor.orgId)))
      .limit(1);
    const contact = rows[0];
    if (!contact) throw new NotFoundException(`conv_not_found: contact ${contactId}`);
    if (!contact.phone) {
      throw new BadRequestException(`conv_invalid: contact ${contactId} has no phone number`);
    }
    if (contact.doNotContact || contact.unsubscribedAt) {
      throw new ConflictException(`conv_conflict: contact ${contactId} has opted out of contact`);
    }
    if (!contact.consentLawfulBasis) {
      throw new BadRequestException(
        `conv_invalid: contact ${contactId} has no recorded lawful basis; a business-initiated WhatsApp message needs recorded opt-in consent`,
      );
    }

    const convContact = await ctx.db.transaction((tx) =>
      findOrCreateContactByPhone(tx, actor.orgId, contact.phone!, contact.name ?? undefined, 'whatsapp-template'),
    );
    if (!convContact) {
      throw new BadRequestException(`conv_invalid: could not resolve a conversation contact for ${contactId}`);
    }

    const open = await ctx.db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.channelId, channelId),
          eq(schema.convConversations.contactId, convContact.id),
          inArray(schema.convConversations.status, ['open', 'snoozed']),
        ),
      )
      .orderBy(desc(schema.convConversations.lastMessageAt))
      .limit(1);

    return {
      channelId,
      conversationId: open[0]?.id ?? null,
      convContactId: convContact.id,
      endUserId: contact.endUserId ?? convContact.endUserId ?? null,
    };
  }

  private async assertNotSuppressed(phone: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({ doNotContact: schema.crmContacts.doNotContact, unsubscribedAt: schema.crmContacts.unsubscribedAt })
      .from(schema.crmContacts)
      .where(and(eq(schema.crmContacts.orgId, actor.orgId), eq(schema.crmContacts.phone, phone)))
      .limit(1);
    const contact = rows[0];
    if (contact && (contact.doNotContact || contact.unsubscribedAt)) {
      throw new ConflictException('conv_conflict: this contact has opted out of contact');
    }
  }
}
