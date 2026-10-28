import { describe, expect, it } from 'vitest';
import {
  formFromRules,
  recommendedForm,
  rulesFromForm,
  sameRules,
  timeZoneOptions,
  type SendRulesDto,
} from './send-rules-form';

const recommended = { quietHours: '20:00-08:00', validDays: null, weeklyCap: 3, cooldownHoursAfterConversation: 24 };
const unconfigured: SendRulesDto = {
  timezone: 'UTC',
  quietHours: null,
  validDays: null,
  weeklyCap: null,
  cooldownHoursAfterConversation: 0,
  configured: false,
  recommended,
};

describe('send rules form', () => {
  it('round-trips rules through the form unchanged', () => {
    const rules = {
      timezone: 'Europe/Oslo',
      quietHours: '21:30-07:00',
      validDays: ['mon', 'tue', 'wed', 'thu', 'fri'] as const,
      weeklyCap: 2,
      cooldownHoursAfterConversation: 48,
    };
    const back = rulesFromForm(formFromRules({ ...rules, validDays: [...rules.validDays] }, recommended));
    expect(back).toEqual({ rules: { ...rules, validDays: [...rules.validDays] } });
  });

  it('keeps switched-off rules as null and offers the recommended values to switch on', () => {
    const form = formFromRules(unconfigured, recommended);
    expect(form).toMatchObject({ quietEnabled: false, quietFrom: '20:00', quietTo: '08:00', capEnabled: false, cap: '3' });
    expect(rulesFromForm(form)).toEqual({
      rules: { timezone: 'UTC', quietHours: null, validDays: null, weeklyCap: null, cooldownHoursAfterConversation: 0 },
    });
  });

  it('fills the recommended rules in the browser time zone', () => {
    const form = recommendedForm(unconfigured, 'Europe/Oslo');
    expect(rulesFromForm(form)).toEqual({
      rules: { timezone: 'Europe/Oslo', quietHours: '20:00-08:00', validDays: null, weeklyCap: 3, cooldownHoursAfterConversation: 24 },
    });
  });

  it('refuses an empty quiet window, no weekdays and out-of-range numbers', () => {
    const base = formFromRules(unconfigured, recommended);
    expect(rulesFromForm({ ...base, quietEnabled: true, quietFrom: '08:00', quietTo: '08:00' })).toEqual({ error: 'quietSame' });
    expect(rulesFromForm({ ...base, daysEnabled: true, days: [] })).toEqual({ error: 'noDays' });
    expect(rulesFromForm({ ...base, capEnabled: true, cap: '0' })).toEqual({ error: 'capRange' });
    expect(rulesFromForm({ ...base, capEnabled: true, cap: '2.5' })).toEqual({ error: 'capRange' });
    expect(rulesFromForm({ ...base, cooldownHours: '' })).toEqual({ error: 'cooldownRange' });
    expect(rulesFromForm({ ...base, cooldownHours: '721' })).toEqual({ error: 'cooldownRange' });
  });

  it('tells every day apart from no day restriction', () => {
    const all = { ...unconfigured, validDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as SendRulesDto['validDays'] };
    expect(sameRules(unconfigured, all)).toBe(false);
    expect(sameRules(unconfigured, { ...unconfigured })).toBe(true);
  });

  it('always lists UTC first and the current zone even when the runtime does not know it', () => {
    const zones = timeZoneOptions('Mars/Olympus_Mons');
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Mars/Olympus_Mons');
  });
});
