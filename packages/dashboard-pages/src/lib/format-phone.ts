import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function formatPhoneNumber(raw: string): string {
  const parsed = parsePhoneNumberFromString(raw);
  return parsed?.isValid() ? parsed.formatInternational() : raw;
}
