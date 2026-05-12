import serifRegular from '../fonts/Instrument-Serif-latin.woff2?inline';
import serifItalic from '../fonts/Instrument-Serif-Italic-latin.woff2?inline';
import mono from '../fonts/JetBrains-Mono-latin.woff2?inline';

const STYLE_ID = 'munin-widget-fonts';

export function registerBundledFonts(): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || !doc.head) return;
  if (doc.getElementById(STYLE_ID)) return;
  const styleEl = doc.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.setAttribute('data-munin', 'widget-fonts');
  styleEl.textContent = String.raw`
@font-face {
  font-family: 'Munin Serif';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(${serifRegular}) format('woff2');
}
@font-face {
  font-family: 'Munin Serif';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url(${serifItalic}) format('woff2');
}
@font-face {
  font-family: 'Munin Mono';
  font-style: normal;
  font-weight: 400 500;
  font-display: swap;
  src: url(${mono}) format('woff2');
}
`;
  doc.head.appendChild(styleEl);
}
