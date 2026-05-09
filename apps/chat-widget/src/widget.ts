import { parseConfig } from './config.js';

/**
 * Bootstrap entry. Looks up the script tag that loaded us, parses its
 * data-* attributes, and (in a follow-up PR) mounts the launcher + chat
 * panel and opens the WebSocket. For now this is the smallest viable
 * entry that exercises the bundle pipeline and config parser.
 */
function bootstrap(): void {
  const scriptEl = currentScript();
  if (!scriptEl) {
    // The widget could not find its own <script> tag — that means it was
    // loaded as a module or eval'd without a host element. Bail quietly;
    // this should never happen for the IIFE bundle in real usage.
    return;
  }
  const result = parseConfig(scriptEl);
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`[munin-widget] ${err.attr}: ${err.message}`);
    }
    return;
  }
  for (const w of result.warnings) {
    console.warn(`[munin-widget] ${w.attr}: ${w.message}`);
  }
  // UI + WS wiring lands in the next PR. For now expose the parsed
  // config on the global so smoke tests / dev harnesses can inspect it.
  (window as unknown as { __muninWidget?: unknown }).__muninWidget = {
    config: result.config,
  };
}

function currentScript(): HTMLElement | null {
  // `document.currentScript` is the script tag mid-execution. Browsers
  // populate it for synchronously executed inline-and-external scripts.
  // Fallback: pick the last <script> with a data-widget-key attr (works
  // for `defer` / module loaders that null out currentScript).
  const cur = document.currentScript;
  if (cur instanceof HTMLElement) return cur;
  const all = document.querySelectorAll('script[data-widget-key]');
  return (all[all.length - 1] as HTMLElement | undefined) ?? null;
}

bootstrap();
