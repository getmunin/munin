import type { SharedStrings } from './types.ts';

export const shared: SharedStrings = {
  fallbackPrefix: 'Button not working? Paste this link into your browser:',
  footerLegal: '© Apps AS · Vulkan 16, 0178 Oslo, Norway',
  footerHelp: 'Help',
  footerPrivacy: 'Privacy',
};

export const resetPassword = {
  subject: 'Reset your Munin password',
  eyebrow: 'Account security',
  heading: 'Reset your password',
  body: (name?: string | null) =>
    name
      ? `Hi ${name} — we received a request to reset the password for your Munin account. Choose a new one with the button below.`
      : 'We received a request to reset the password for your Munin account. Choose a new one with the button below.',
  cta: 'Reset password',
  expiry:
    "This link expires one hour after it was sent. If you didn't request a reset, you can safely ignore this email — your password stays unchanged.",
  footerReason: "You're receiving this because a password reset was requested for your Munin account.",
};

export const verifyEmail = {
  subject: 'Verify your Munin email',
  eyebrow: 'Confirm email',
  heading: 'Confirm your email',
  body: 'Welcome to Munin. Confirm this address to activate your account — it takes one click.',
  cta: 'Verify email',
  expiry: "This link expires in 24 hours. If you didn't create a Munin account, you can ignore this email.",
  footerReason: "You're receiving this because this address was used to sign up for Munin.",
};

export const deleteAccount = {
  subject: 'Confirm Munin account deletion',
  eyebrow: 'Account deletion',
  heading: 'Confirm account deletion',
  body: 'You asked to delete your Munin account. This is permanent — every organization, channel, and record you own is removed and cannot be recovered.',
  cta: 'Confirm deletion',
  expiry:
    "This confirmation link expires in one hour. If you didn't request this, do not click — change your password immediately and contact support.",
  footerReason: "You're receiving this because account deletion was requested in Munin Cloud.",
};

export const orgInvite = {
  subject: (orgName: string) => `You've been invited to ${orgName} on Munin`,
  eyebrow: 'Team invitation',
  heading: (orgName: string) => `Join ${orgName} on Munin`,
  body: (inviterName: string | null, orgName: string) =>
    inviterName
      ? `${inviterName} invited you to join ${orgName} on Munin — the customer platform built for the agentic era. Accept to set up your account and start handling conversations.`
      : `You've been invited to join ${orgName} on Munin — the customer platform built for the agentic era. Accept to set up your account and start handling conversations.`,
  cta: 'Accept invitation',
  expiry:
    "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email — nothing will be created.",
  footerReason: (orgName: string) =>
    `You're receiving this because someone at ${orgName} invited you to Munin.`,
};

export const channelTest = {
  subject: (channelName: string) => `Munin test message — ${channelName}`,
  eyebrow: 'Channel diagnostic',
  heading: 'Your email channel is working',
  body: (channelName: string) =>
    `This is an automated test from Munin. If it reached your inbox, the "${channelName}" channel is connected and delivery is configured correctly. No action is needed — you can delete this message.`,
  diagChannel: 'Channel',
  diagAddress: 'Address',
  diagDelivery: 'Delivery',
  diagDelivered: '✓ delivered',
  diagMessageId: 'Message-ID',
  footerReason: 'Sent by Munin to verify outbound delivery for this channel.',
};

export const partnerClaim = {
  subject: 'Claim your Munin account',
  eyebrow: 'Account ready',
  heading: 'Claim your Munin account',
  body: (partnerName: string, customerOrgName: string) =>
    `${partnerName} has set up a Munin workspace for ${customerOrgName} and added you as an admin. Set a password to claim your account and take it over.`,
  cta: 'Claim account',
  expiry: (partnerName: string) =>
    `This link expires in 7 days. If you don't recognize ${partnerName}, you can ignore this email — the workspace stays unclaimed.`,
  footerReason: "You're receiving this because a Munin partner provisioned an account for you.",
};
