import type { JourneySpecInput } from '@getmunin/types';

export interface ConvertibleCampaign {
  name: string;
  brief: string;
  segmentId: string;
  cadenceRules: { maxPerWeekPerContact?: number; quietHoursStart?: string; quietHoursEnd?: string };
  sequenceSteps: { waitDays: number; brief: string }[];
}

export function specFromCampaign(
  campaign: ConvertibleCampaign,
  goal: { event: string; windowDays: number },
): { spec: JourneySpecInput; notes: string[] } {
  const notes: string[] = [];
  const steps = campaign.sequenceSteps.slice(0, 20);
  if (campaign.sequenceSteps.length > steps.length) {
    notes.push(`only the first ${steps.length} follow-ups were converted`);
  }
  const nodes: Record<string, unknown>[] = [
    draftNode('first_touch', campaign.name, campaign.brief, steps.length ? 'wait_1' : 'done'),
  ];
  steps.forEach((step, index) => {
    const n = index + 1;
    const next = n < steps.length ? `wait_${n + 1}` : 'done';
    nodes.push({
      id: `wait_${n}`,
      type: 'wait',
      label: `Wait ${step.waitDays} days`,
      duration: `P${Math.max(1, Math.round(step.waitDays))}D`,
      next: `followup_${n}`,
    });
    nodes.push(draftNode(`followup_${n}`, `${campaign.name} — follow-up ${n}`, step.brief, next));
  });
  nodes.push({ id: 'replied', type: 'exit', label: 'Replied', reason: 'replied' });
  nodes.push({ id: 'done', type: 'exit', label: 'Sequence finished' });
  notes.push(
    'every email is agent-drafted from the campaign brief and filed for review; its reference content is the brief itself, so replace it before relying on the fallback',
    'a reply ends the sequence, as before; point onReply at an intent step to branch on what the reply says',
  );

  const settings: Record<string, unknown> = {};
  const { quietHoursStart, quietHoursEnd, maxPerWeekPerContact } = campaign.cadenceRules;
  if (quietHoursStart && quietHoursEnd) settings.quietHours = `${quietHoursStart}-${quietHoursEnd}`;
  if (maxPerWeekPerContact) settings.frequencyCapPerWeek = maxPerWeekPerContact;

  return {
    spec: {
      entry: {
        trigger: { type: 'segment', segmentId: campaign.segmentId, schedule: 'daily', at: '09:00' },
        reentry: 'once',
      },
      goal: { event: goal.event, windowDays: goal.windowDays, exitOnGoal: true },
      settings: settings,
      start: 'first_touch',
      nodes: nodes as JourneySpecInput['nodes'],
    },
    notes,
  };
}

function draftNode(id: string, subject: string, brief: string, next: string): Record<string, unknown> {
  return {
    id,
    type: 'message',
    channel: 'email',
    label: subject,
    draftBy: 'agent',
    brief: brief.slice(0, 2000),
    content: { subject: subject.slice(0, 300), body: brief },
    approval: 'draft_only',
    next,
    onReply: 'replied',
  };
}
