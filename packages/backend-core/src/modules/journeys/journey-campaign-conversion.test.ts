import { describe, expect, it } from 'vitest';
import { specFromCampaign } from './journey-campaign-conversion.ts';
import { parseJourneySpec, validateJourneySpec } from './journey-validator.ts';

describe('specFromCampaign', () => {
  it('turns a first touch and its follow-ups into agent-drafted emails with waits, ending on a reply', () => {
    const { spec, notes } = specFromCampaign(
      {
        name: 'Q4 pilots',
        brief: 'Offer a two-week pilot to logistics leads.',
        segmentId: 'seg_trial',
        cadenceRules: { quietHoursStart: '20:00', quietHoursEnd: '08:00', maxPerWeekPerContact: 2 },
        sequenceSteps: [
          { waitDays: 3, brief: 'Share the Posten case study.' },
          { waitDays: 7, brief: 'Last nudge, ask for a 15 minute call.' },
        ],
      },
      { event: 'deal.won', windowDays: 60 },
    );
    const parsed = parseJourneySpec(spec);
    expect(parsed.validation.errors).toEqual([]);
    const result = validateJourneySpec(parsed.spec!, {
      segmentIds: new Set(['seg_trial']),
      emailTemplateIds: new Set(),
      webhookIds: new Set(),
    });
    expect(result.errors).toEqual([]);
    expect(parsed.spec!.nodes.map((n) => n.id)).toEqual([
      'first_touch',
      'wait_1',
      'followup_1',
      'wait_2',
      'followup_2',
      'replied',
      'done',
    ]);
    expect(parsed.spec!.nodes[1]).toMatchObject({ type: 'wait', duration: 'P3D', next: 'followup_1' });
    expect(parsed.spec!.nodes[4]).toMatchObject({
      draftBy: 'agent',
      brief: 'Last nudge, ask for a 15 minute call.',
      approval: 'draft_only',
      onReply: 'replied',
      next: 'done',
    });
    expect(parsed.spec!.settings).toMatchObject({ quietHours: '20:00-08:00', frequencyCapPerWeek: 2 });
    expect(parsed.spec!.entry).toMatchObject({ reentry: 'once', trigger: { type: 'segment', segmentId: 'seg_trial' } });
    expect(notes.length).toBeGreaterThan(0);
  });
});
