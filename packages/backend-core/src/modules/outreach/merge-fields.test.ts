import { describe, expect, it } from 'vitest';
import { previewJourneyMerge } from './merge-fields.ts';

const contact = { name: 'Kari Nordmann', customFields: { first_name: 'Kari', seats: 12 } };

describe('previewJourneyMerge', () => {
  it('fills custom fields, name and org name in an email the way the send path does', () => {
    const preview = previewJourneyMerge(
      {
        channel: 'email',
        subject: 'Welcome, {{contact.custom_fields.first_name|there}}',
        body: 'Hi {{contact.custom_fields.first_name|there}}, {{org_name}} reserved {{contact.custom_fields.seats}} seats. Re: {{subject}}',
      },
      contact,
      'Acme',
    );
    expect(preview).toEqual({
      subject: 'Welcome, Kari',
      body: 'Hi Kari, Acme reserved 12 seats. Re: Welcome, Kari',
      unfilled: [],
    });
  });

  it('reports each missing field once with the fallback the recipient will see', () => {
    const preview = previewJourneyMerge(
      {
        channel: 'email',
        subject: null,
        body: '{{contact.custom_fields.threll_name|your threll}} and {{contact.custom_fields.threll_name|your threll}} and {{contact.custom_fields.plan}}',
      },
      contact,
      'Acme',
    );
    expect(preview?.body).toBe('your threll and your threll and ');
    expect(preview?.unfilled).toEqual([
      { placeholder: 'contact.custom_fields.threll_name', fallback: 'your threll' },
      { placeholder: 'contact.custom_fields.plan', fallback: null },
    ]);
  });

  it('leaves org name empty in sms and chat because those sends only merge name and custom fields', () => {
    const preview = previewJourneyMerge(
      { channel: 'sms', subject: 'ignored {{name}}', body: 'Hi {{name}} from {{org_name}}' },
      contact,
      'Acme',
    );
    expect(preview).toEqual({
      subject: null,
      body: 'Hi Kari Nordmann from ',
      unfilled: [{ placeholder: 'org_name', fallback: null }],
    });
  });

  it('returns null for drafts without merge fields and for voice openings, which are spoken as written', () => {
    expect(previewJourneyMerge({ channel: 'email', subject: 'Hello', body: 'Plain' }, contact, 'Acme')).toBeNull();
    expect(
      previewJourneyMerge({ channel: 'voice', subject: null, body: 'Hi {{name}}' }, contact, 'Acme'),
    ).toBeNull();
  });
});
