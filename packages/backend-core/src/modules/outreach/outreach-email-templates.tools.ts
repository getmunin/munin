import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { EMAIL_CONTENT_FORMATS } from './email-template-render.ts';
import { OutreachEmailTemplatesService } from './outreach-email-templates.service.ts';
import { translateInvalid } from './outreach.tools.ts';

const TemplateId = z.string().min(1).max(64);
const TemplateName = z.string().min(1).max(120);
const TemplateDescription = z.string().max(500).nullable();
const TemplateMjml = z
  .string()
  .min(1)
  .max(200_000)
  .describe(
    'Complete MJML document (<mjml><mj-head>…</mj-head><mj-body>…</mj-body></mjml>). Must contain {{content}} exactly once, directly inside <mj-body> or <mj-wrapper>, and link to {{unsubscribe_url}} in an href. May also use {{subject}}, {{preheader}}, {{org_name}} and {{name}} / {{name|fallback}}.',
  );

const EmailContentSchema = z.object({
  format: z
    .enum(EMAIL_CONTENT_FORMATS)
    .describe(
      '`markdown` renders as one text section styled by the template; `mjml` is a fragment of <mj-section>/<mj-wrapper> elements for richer layouts such as cards, images and buttons.',
    ),
  body: z
    .string()
    .min(1)
    .max(100_000)
    .describe('The message content. May use {{name}} / {{name|fallback}}, {{org_name}} and {{subject}}.'),
});

const ListTemplatesInput = z.object({});
const GetTemplateInput = z.object({ id: TemplateId });
const DeleteTemplateInput = z.object({ id: TemplateId });

const CreateTemplateInput = z.object({
  name: TemplateName,
  description: TemplateDescription.optional(),
  mjml: TemplateMjml,
  isDefault: z
    .boolean()
    .optional()
    .describe('Make this the org default template. The previous default, if any, stops being the default.'),
});

const UpdateTemplateInput = z.object({
  id: TemplateId,
  name: TemplateName.optional(),
  description: TemplateDescription.optional(),
  mjml: TemplateMjml.optional(),
  isDefault: z
    .boolean()
    .optional()
    .describe('true makes this the org default (the previous default stops being one); false clears it.'),
});

const PreviewTemplateInput = z.object({
  templateId: TemplateId.optional().describe(
    'Saved template to render. Leave out both templateId and mjml to use the org default template.',
  ),
  mjml: TemplateMjml.optional().describe(
    'Unsaved MJML to render instead of a saved template, so a design can be checked before it is stored. Same rules as a saved template.',
  ),
  content: EmailContentSchema,
  name: z.string().max(200).nullable().optional().describe('Recipient name to fill {{name}} with.'),
  subject: z.string().max(500).nullable().optional(),
  preheader: z.string().max(500).nullable().optional(),
});

@Injectable()
export class OutreachEmailTemplateTools {
  constructor(
    @Inject(OutreachEmailTemplatesService) private readonly templates: OutreachEmailTemplatesService,
  ) {}

  @McpTool({
    name: 'outreach_list_email_templates',
    title: 'Outreach: List email templates',
    description:
      "List this org's outreach email templates: id, name, description and whether it is the default. The default template comes first. The MJML source is left out of the list.",
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: ListTemplatesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listTemplates() {
    return this.templates.listTemplates();
  }

  @McpTool({
    name: 'outreach_get_email_template',
    title: 'Outreach: Read email template',
    description:
      "Read one email template, including its MJML source and `warnings` from compiling it now (for example images without alt text, or a layout heavy enough that Gmail may clip it).",
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: GetTemplateInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getTemplate(args: z.infer<typeof GetTemplateInput>) {
    return translateInvalid(() => this.templates.getTemplate(args.id));
  }

  @McpTool({
    name: 'outreach_create_email_template',
    title: 'Outreach: Create email template',
    description:
      'Store an MJML email template that wraps outreach email content in the org\'s branded layout. The template is validated before it is saved: it must compile under strict MJML validation, contain {{content}} exactly once where sections may go, and link to {{unsubscribe_url}}. Scripts, forms, iframes, inline event handlers, javascript:/data: URLs, CSS @import and <mj-include> are refused. Validation errors name the template line. Images must be hosted at a public https URL. Returns the template with `warnings` that do not block saving. Names are unique per org.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: CreateTemplateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createTemplate(args: z.infer<typeof CreateTemplateInput>) {
    return translateInvalid(() => this.templates.createTemplate(args));
  }

  @McpTool({
    name: 'outreach_update_email_template',
    title: 'Outreach: Update email template',
    description:
      'Change an email template\'s name, description, MJML source or default flag. New MJML is validated with the same rules as on create, and nothing is saved if it fails. Returns the updated template with `warnings`.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: UpdateTemplateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateTemplate(args: z.infer<typeof UpdateTemplateInput>) {
    return translateInvalid(() => this.templates.updateTemplate(args));
  }

  @McpTool({
    name: 'outreach_delete_email_template',
    title: 'Outreach: Delete email template',
    description: 'Delete an email template permanently. Returns `{ deleted: true, id }`.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: DeleteTemplateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  deleteTemplate(args: z.infer<typeof DeleteTemplateInput>) {
    return translateInvalid(() => this.templates.deleteTemplate(args.id));
  }

  @McpTool({
    name: 'outreach_preview_email_template',
    title: 'Outreach: Preview email template',
    description:
      "Render sample content through an email template without sending anything: a saved template by `templateId`, unsaved MJML passed as `mjml`, or the org default when both are left out. Returns the final `html` and plain-text `text` exactly as a recipient would get them, `htmlBytes`, and `warnings`. The unsubscribe link in a preview is a placeholder that does not unsubscribe anyone. Fails with the same validation messages as saving would.",
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: PreviewTemplateInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  previewTemplate(args: z.infer<typeof PreviewTemplateInput>) {
    return translateInvalid(() => this.templates.previewTemplate(args));
  }
}
