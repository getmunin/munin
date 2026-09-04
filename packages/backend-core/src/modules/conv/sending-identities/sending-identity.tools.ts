import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { SendingIdentityService, type SendingIdentityDto } from './sending-identity.service.ts';

const CreateInput = z.object({
  domain: z.string().min(1).max(253),
});

const IdInput = z.object({
  identityId: z.string(),
});

@Injectable()
export class SendingIdentityAdminTools {
  constructor(
    @Inject(SendingIdentityService) private readonly identities: SendingIdentityService,
  ) {}

  @McpTool({
    name: 'conv_create_sending_identity',
    title: 'Conv: Add a sending domain',
    description:
      'Register a domain this organisation wants to send email from, and get back the DNS record to publish. Munin generates a DKIM keypair for the domain and returns a single TXT record; once the customer publishes it and verification passes, email channels may send from any address at that domain. Pass the domain alone (acme.com), not an email address. Verification is not instant — DNS can take up to 72 hours to propagate, and the identity is re-checked automatically in the background; call conv_refresh_sending_identity to check immediately.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  create(args: z.infer<typeof CreateInput>): Promise<SendingIdentityDto> {
    return this.identities.create({ domain: args.domain });
  }

  @McpTool({
    name: 'conv_list_sending_identities',
    title: 'Conv: List sending domains',
    description:
      'List the sending domains registered for this organisation with their verification status and the DNS record each one needs. A domain with status "verified" can be used as the from address of an email channel whose outbound provider is "identity"; "pending" means the DNS record has not been seen yet, and `lastError` says what the last check found.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: z.object({}),
    readOnlyHint: true,
  })
  list(): Promise<SendingIdentityDto[]> {
    return this.identities.list();
  }

  @McpTool({
    name: 'conv_refresh_sending_identity',
    title: 'Conv: Re-check a sending domain',
    description:
      'Check a sending domain now instead of waiting for the background refresh, and return its updated status. Use after the customer confirms they have published the DNS record. A result of "pending" is normal for a while after publishing — DNS propagation can take up to 72 hours.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: IdInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  refresh(args: z.infer<typeof IdInput>): Promise<SendingIdentityDto> {
    return this.identities.refresh(args.identityId);
  }

  @McpTool({
    name: 'conv_delete_sending_identity',
    title: 'Conv: Remove a sending domain',
    description:
      'Remove a sending domain and destroy its signing key. Email channels sending from an address at this domain through the "identity" outbound provider stop sending immediately. The customer should also delete the DNS record. This cannot be undone — re-adding the domain generates a new key and a new record to publish.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: IdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  remove(args: z.infer<typeof IdInput>): Promise<{ deleted: true }> {
    return this.identities.remove(args.identityId);
  }
}
