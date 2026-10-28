import { describe, expect, it } from 'vitest';
import { parseJourneyDelivery } from './journey-delivery.ts';

const valid = {
  channel: 'email',
  format: 'markdown',
  templateId: null,
  templateHash: 'abc',
  preheader: null,
  policy: { class: 'transactional', cooldownHoursAfterConversation: 0, quietHours: '21:00-07:00' },
  auto: true,
};

describe('parseJourneyDelivery', () => {
  it('reads the stored delivery settings', () => {
    expect(parseJourneyDelivery('oprp_1', valid)).toEqual(valid);
  });

  it('fails closed instead of assuming defaults when the settings are missing or malformed', () => {
    expect(() => parseJourneyDelivery('oprp_1', null)).toThrow(/outreach_journey_invalid/);
    expect(() => parseJourneyDelivery('oprp_1', { ...valid, channel: 'fax' })).toThrow(/channel/);
    expect(() => parseJourneyDelivery('oprp_1', { ...valid, policy: { class: 'urgent', cooldownHoursAfterConversation: 0 } })).toThrow(
      /policy\.class/,
    );
    expect(() => parseJourneyDelivery('oprp_1', { ...valid, policy: { ...valid.policy, quietHours: 'evenings' } })).toThrow(
      /policy\.quietHours/,
    );
  });
});
