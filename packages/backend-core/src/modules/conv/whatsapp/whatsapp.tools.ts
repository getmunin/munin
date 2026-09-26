import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { WhatsAppTemplatesService } from './whatsapp-templates.service.ts';

const VariablesSchema = z
  .record(z.string().regex(/^[A-Za-z0-9_]{1,64}$/), z.string().min(1).max(1024))
  .refine((v) => Object.keys(v).length <= 30, 'at most 30 variables');

const ListTemplatesInput = z.object({
  channelId: z.string().min(1).describe('WhatsApp channel whose Business Account templates to list.'),
  status: z
    .enum(['approved', 'pending', 'rejected', 'paused', 'disabled'])
    .optional()
    .describe('Only return templates in this review status. Omit for all.'),
});

const SendTemplateInput = z.object({
  templateName: z.string().min(1).max(512).describe('Template name exactly as listed.'),
  language: z
    .string()
    .min(2)
    .max(16)
    .describe('Template language code exactly as listed, e.g. "en_US" or "nb".'),
  conversationId: z
    .string()
    .optional()
    .describe('Continue this WhatsApp conversation. Pass this or contactId, not both.'),
  contactId: z
    .string()
    .optional()
    .describe(
      'CRM contact to message. Reuses their open conversation on the channel, otherwise starts one. Requires channelId and a recorded lawful basis on the contact.',
    ),
  channelId: z
    .string()
    .optional()
    .describe('WhatsApp channel to send from. Required with contactId; inferred from conversationId otherwise.'),
  variables: VariablesSchema.optional().describe(
    'Body placeholder values keyed by placeholder name — "1", "2", … for positional templates, or the parameter name for named ones. Every placeholder listed in `variables` must be filled.',
  ),
  headerVariables: VariablesSchema.optional().describe(
    'Header placeholder values, keyed the same way, for templates whose text header has a placeholder.',
  ),
});

@Injectable()
export class WhatsAppTools {
  constructor(@Inject(WhatsAppTemplatesService) private readonly templates: WhatsAppTemplatesService) {}

  @McpTool({
    name: 'conv_list_whatsapp_templates',
    title: 'Conv: List WhatsApp message templates',
    description:
      'List the message templates on a WhatsApp channel’s Business Account, read live from Meta. Each template carries its name, language, category (marketing, utility, authentication), review status, header/body/footer text, buttons, and the placeholder names to fill in `variables` / `headerVariables`. Only approved templates can be sent; templates are created and reviewed in Meta Business Manager, not here.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: ListTemplatesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listTemplates(args: z.infer<typeof ListTemplatesInput>) {
    return this.templates.listTemplates(args);
  }

  @McpTool({
    name: 'conv_send_whatsapp_template',
    title: 'Conv: Send a WhatsApp template message',
    description:
      'Send an approved WhatsApp template, the only kind of message WhatsApp accepts outside the 24-hour customer-service window. Pass `conversationId` to continue a thread, or `contactId` + `channelId` to message a CRM contact (their open conversation on that channel is reused, otherwise a new one starts). The template must exist in that language, be approved, and have every placeholder filled; contacts who opted out are refused, and starting from `contactId` also requires a recorded lawful basis. The rendered text is stored on the thread and delivered like any outbound message.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendTemplateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  sendTemplate(args: z.infer<typeof SendTemplateInput>) {
    return this.templates.sendTemplate(args);
  }
}
