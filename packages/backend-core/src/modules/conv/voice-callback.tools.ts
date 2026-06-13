import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { VoiceCallbackService, type VoiceCallbackResult } from './voice-callback.service.ts';

const CallbackInput = z.object({
  conversationId: z.string(),
  channelId: z.string().min(1).max(64).optional(),
});

@Injectable()
export class VoiceCallbackTools {
  constructor(
    @Inject(VoiceCallbackService) private readonly svc: VoiceCallbackService,
  ) {}

  @McpTool({
    name: 'conv_request_phone_call_for_my_conversation',
    title: 'Conv: Place a phone call to the user in this conversation',
    description:
      "Place an outbound phone call to the contact in this conversation. Use this only when the user has asked to be called — e.g. \"can you call me?\". The call goes to the phone number already on file for this conversation's contact; you cannot specify an arbitrary number. The org must have an active Vapi voice channel configured. After requesting the call, tell the user briefly that a call is on the way and stop replying — the rest of the conversation happens on the phone.",
    audiences: ['self_service'],
    scopes: ['conv:write'],
    input: CallbackInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  requestPhoneCall(args: z.infer<typeof CallbackInput>): Promise<VoiceCallbackResult> {
    return this.svc.placeCallbackForConversation(args);
  }

  @McpTool({
    name: 'conv_voice_call_contact',
    title: "Conv: Place a voice call to this conversation's contact",
    description:
      "Place an outbound voice call to the contact attached to a conversation. Resolves the phone number from the conversation's contact. If your org has more than one active voice channel, pass `channelId` to pick one; with a single channel the call falls back to it. For arbitrary destinations, use `conv_voice_call` instead.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CallbackInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  callContact(args: z.infer<typeof CallbackInput>): Promise<VoiceCallbackResult> {
    return this.svc.placeCallbackForConversation(args);
  }
}
