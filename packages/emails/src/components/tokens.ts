export const colors = {
  paper: '#FAF7F2',
  bone: '#E8E4DC',
  ink: '#0F1419',
  inkSoft: '#3A4148',
  inkMute: '#8B8579',
  accent: '#C36A2D',
  accentSoft: '#E8B591',
  accentDeep: '#8F4B1E',
  rule: '#D9D3C7',
};

export const fonts = {
  serif: '"PT Serif", Georgia, "Times New Roman", serif',
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Courier New", monospace',
};

export const sizes = {
  bodyMax: '600px',
  bodyPaddingX: '40px',
  bodyPaddingY: '40px',
};

export const RAVEN_PNG_URL =
  process.env.MUNIN_EMAIL_LOGO_URL ?? 'https://www.getmunin.com/email-assets/raven-flying.png';
