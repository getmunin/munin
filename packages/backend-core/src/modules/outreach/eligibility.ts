import type { ContactDto } from '../crm/crm.service.ts';
import type { MessageClass } from './send-policy.ts';
import { OutreachInvalidError, OutreachUndeliverableError } from './outreach-errors.ts';

export type EligibilityFacts = Pick<
  ContactDto,
  'id' | 'doNotContact' | 'unsubscribedAt' | 'consentLawfulBasis' | 'deliverability'
>;

export function assertEligible(
  contact: EligibilityFacts,
  send: { class: MessageClass; channelType: string },
): void {
  const marketing = send.class === 'marketing';
  if (contact.doNotContact || (marketing && (contact.unsubscribedAt || !contact.consentLawfulBasis))) {
    throw new OutreachInvalidError(
      `contact ${contact.id} is no longer eligible (suppression or consent withdrawn)`,
    );
  }
  assertDeliverable(contact, send.channelType);
}

export function assertDeliverable(contact: Pick<ContactDto, 'id' | 'deliverability'>, channelType: string): void {
  if (channelType !== 'email') return;
  const state = contact.deliverability;
  if (!state || state.state !== 'undeliverable') return;
  throw new OutreachUndeliverableError(
    `mail cannot reach ${state.address} (${state.reason ?? 'no reason recorded'}, since ${state.stateChangedAt}) — ` +
      `correct contact ${contact.id}'s address, or clear the address's deliverability state if it works again`,
  );
}
