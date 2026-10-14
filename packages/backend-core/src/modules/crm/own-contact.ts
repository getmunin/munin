import { isSelfReportedIdentity } from '../connectors/identity-provenance.ts';

export interface OwnContactIdentity {
  email: string | null;
  phone: string | null;
  metadata: unknown;
}

export interface OwnContactKeys {
  email: string | null;
  phone: string | null;
}

export type OwnContactVerdict = 'ok' | 'self_reported' | 'email_unproven' | 'phone_unproven';

export function judgeOwnContact(endUser: OwnContactIdentity, contact: OwnContactKeys): OwnContactVerdict {
  if (isSelfReportedIdentity(endUser)) return 'self_reported';
  const contactEmail = normalizeEmailKey(contact.email);
  if (contactEmail) {
    return contactEmail === normalizeEmailKey(endUser.email) ? 'ok' : 'email_unproven';
  }
  const contactPhone = normalizePhoneKey(contact.phone);
  if (contactPhone && contactPhone !== normalizePhoneKey(endUser.phone)) return 'phone_unproven';
  return 'ok';
}

function normalizeEmailKey(email: string | null): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function normalizePhoneKey(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, '');
  return digits ? digits : null;
}
