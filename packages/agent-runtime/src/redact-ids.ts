import { NATIONAL_ID_DETECTORS, findNationalIds, redactNationalIds } from '@getmunin/core';

export function redactNationalIdsForPrompt(text: string): string {
  const matches = findNationalIds(text, NATIONAL_ID_DETECTORS);
  return matches.length === 0 ? text : redactNationalIds(text, matches, 'remove');
}
