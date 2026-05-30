import type { SharedStrings } from './types.ts';

export const shared: SharedStrings = {
  fallbackPrefix: 'Virker ikke knappen? Lim inn denne lenken i nettleseren:',
  footerLegal: '© Apps AS · Vulkan 16, 0178 Oslo, Norge',
  footerHelp: 'Hjelp',
  footerPrivacy: 'Personvern',
};

export const resetPassword = {
  subject: 'Tilbakestill Munin-passordet ditt',
  eyebrow: 'Kontosikkerhet',
  heading: 'Tilbakestill passordet ditt',
  body: (name?: string | null) =>
    name
      ? `Hei ${name} — vi mottok en forespørsel om å tilbakestille passordet for Munin-kontoen din. Velg et nytt passord med knappen under.`
      : 'Vi mottok en forespørsel om å tilbakestille passordet for Munin-kontoen din. Velg et nytt passord med knappen under.',
  cta: 'Tilbakestill passord',
  expiry:
    'Lenken utløper én time etter at den ble sendt. Hvis du ikke ba om tilbakestilling, kan du trygt se bort fra denne e-posten — passordet ditt forblir uendret.',
  footerReason: 'Du mottar denne e-posten fordi det ble bedt om tilbakestilling av passordet på Munin-kontoen din.',
};

export const verifyEmail = {
  subject: 'Bekreft Munin-e-postadressen din',
  eyebrow: 'Bekreft e-post',
  heading: 'Bekreft e-postadressen din',
  body: 'Velkommen til Munin. Bekreft denne adressen for å aktivere kontoen din — det tar ett klikk.',
  cta: 'Bekreft e-post',
  expiry: 'Lenken utløper om 24 timer. Hvis du ikke opprettet en Munin-konto, kan du se bort fra denne e-posten.',
  footerReason: 'Du mottar denne e-posten fordi denne adressen ble brukt til å registrere seg på Munin.',
};

export const deleteAccount = {
  subject: 'Bekreft sletting av Munin-konto',
  eyebrow: 'Kontosletting',
  heading: 'Bekreft sletting av kontoen',
  body: 'Du har bedt om å slette Munin-kontoen din. Dette er permanent — alle organisasjoner, kanaler og data du eier, fjernes og kan ikke gjenopprettes.',
  cta: 'Bekreft sletting',
  expiry:
    'Bekreftelseslenken utløper om én time. Hvis du ikke ba om dette, ikke klikk — endre passordet ditt umiddelbart og kontakt support.',
  footerReason: 'Du mottar denne e-posten fordi det ble bedt om kontosletting i Munin Cloud.',
};

export const orgInvite = {
  subject: (orgName: string) => `Du er invitert til ${orgName} på Munin`,
  eyebrow: 'Teaminvitasjon',
  heading: (orgName: string) => `Bli med i ${orgName} på Munin`,
  body: (inviterName: string | null, orgName: string) =>
    inviterName
      ? `${inviterName} har invitert deg til å bli med i ${orgName} på Munin — kundeplattformen bygget for AI-agenter. Aksepter for å opprette kontoen din og begynne å håndtere samtaler.`
      : `Du er invitert til å bli med i ${orgName} på Munin — kundeplattformen bygget for AI-agenter. Aksepter for å opprette kontoen din og begynne å håndtere samtaler.`,
  cta: 'Aksepter invitasjon',
  expiry: 'Invitasjonen utløper om 7 dager. Hvis du ikke ventet den, kan du se bort fra denne e-posten — ingenting blir opprettet.',
  footerReason: (orgName: string) =>
    `Du mottar denne e-posten fordi noen hos ${orgName} har invitert deg til Munin.`,
};

export const channelTest = {
  subject: (channelName: string) => `Munin testmelding — ${channelName}`,
  eyebrow: 'Kanaldiagnostikk',
  heading: 'E-postkanalen din fungerer',
  body: (channelName: string) =>
    `Dette er en automatisk test fra Munin. Hvis den nådde innboksen din, er kanalen "${channelName}" tilkoblet og leveransen er riktig konfigurert. Ingen handling er nødvendig — du kan slette denne meldingen.`,
  diagChannel: 'Kanal',
  diagAddress: 'Adresse',
  diagDelivery: 'Levering',
  diagDelivered: '✓ levert',
  diagMessageId: 'Meldings-ID',
  footerReason: 'Sendt av Munin for å verifisere utgående levering for denne kanalen.',
};

export const partnerClaim = {
  subject: 'Krev Munin-kontoen din',
  eyebrow: 'Kontoen er klar',
  heading: 'Krev Munin-kontoen din',
  body: (partnerName: string, customerOrgName: string) =>
    `${partnerName} har satt opp et Munin-arbeidsområde for ${customerOrgName} og lagt deg til som administrator. Velg et passord for å kreve kontoen din og overta den.`,
  cta: 'Krev kontoen',
  expiry: (partnerName: string) =>
    `Lenken utløper om 7 dager. Hvis du ikke kjenner igjen ${partnerName}, kan du se bort fra denne e-posten — arbeidsområdet forblir ukrevd.`,
  footerReason: 'Du mottar denne e-posten fordi en Munin-partner har klargjort en konto for deg.',
};
