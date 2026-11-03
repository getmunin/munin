import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { OutreachSendRulesService, SendRulesInput } from './send-rules.ts';

@Injectable()
export class OutreachSendRulesTools {
  constructor(@Inject(OutreachSendRulesService) private readonly rules: OutreachSendRulesService) {}

  @McpTool({
    name: 'outreach_get_send_rules',
    title: 'Outreach: Read send rules',
    description:
      "Read the org's send rules for marketing: default time zone, quiet hours, weekdays, weekly cap per contact and the cool-down after a contact last wrote to the team. They apply to every marketing send — campaign first touches and follow-ups, broadcasts and journey messages; a journey or a campaign can only make them stricter. Replies to a contact's own message are exempt. `configured: false` means the org has not set them yet and none of them apply; `recommended` holds suggested values.",
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: z.object({}),
    readOnlyHint: true,
    destructiveHint: false,
  })
  get() {
    return this.rules.get();
  }

  @McpTool({
    name: 'outreach_configure_send_rules',
    title: 'Outreach: Configure send rules',
    description:
      "Replace the org's send rules for marketing. A send that would break them waits for the next allowed time in the contact's own time zone (`customFields.timezone`, else the journey's, else this `timezone`); a broadcast recipient already over the weekly cap is skipped with `frequency_cap`. These org rules never hold back transactional messages or replies.",
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: SendRulesInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  configure(args: z.infer<typeof SendRulesInput>) {
    return this.rules.configure(args);
  }
}
