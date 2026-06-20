export function buildWidgetCss(_fonts: 'bundled' | 'system'): string {
  return BASE_CSS;
}

const BASE_CSS = String.raw`
:host {
  --munin-theme: #0066FF;
  --munin-theme-fg: #FBFAF7;
  --munin-bone: #E8E4DC;
  --munin-paper: #FBFAF7;
  --munin-paper-deep: #F0EEE8;
  --munin-ink: #0F1419;
  --munin-ink-soft: #3D424A;
  --munin-ink-mute: #7E8590;
  --munin-rule: rgba(15, 20, 25, 0.18);

  --munin-serif: 'Munin Serif', ui-serif, 'Iowan Old Style', Georgia, serif;
  --munin-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --munin-mono: 'Munin Mono', ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;

  font-family: var(--munin-sans);
  color: var(--munin-ink);
  color-scheme: light;
}

.root {
  position: fixed;
  bottom: 24px;
  z-index: 2147483647;
  font-family: var(--munin-sans);
  font-size: 13.5px;
  line-height: 1.4;
  color: var(--munin-ink);
}
.root[data-position='bottom-right'] { right: 24px; }
.root[data-position='bottom-left']  { left:  24px; }

button {
  font: inherit;
  cursor: pointer;
  background: none;
  border: 0;
  color: inherit;
  padding: 0;
}

[hidden] { display: none !important; }

/* ─── Launcher ───────────────────────────────────────── */
.launcher {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--munin-ink);
  color: var(--munin-paper);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 12px 36px rgba(15, 20, 25, 0.22),
    0 2px 8px rgba(15, 20, 25, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  transition: transform 160ms cubic-bezier(.2,.7,.2,1), box-shadow 160ms;
}
.launcher:hover { transform: translateY(-2px) scale(1.03); }
.launcher:active { transform: translateY(0) scale(.98); }
.launcher:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--munin-theme) 45%, white);
  outline-offset: 2px;
}
.launcher svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; }

.launcher-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--munin-theme);
  color: #fff;
  font-family: var(--munin-mono);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--munin-bone);
  pointer-events: none;
}

/* ─── Panel ──────────────────────────────────────────── */
.panel {
  position: absolute;
  bottom: 0;
  background: var(--munin-paper);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateY(20px) scale(.96);
  opacity: 0;
  pointer-events: none;
  transform-origin: bottom right;
  transition:
    transform 220ms cubic-bezier(.2,.7,.2,1),
    opacity 180ms cubic-bezier(.2,.7,.2,1);
  box-shadow:
    0 24px 64px rgba(15, 20, 25, 0.22),
    0 6px 18px rgba(15, 20, 25, 0.10),
    inset 0 0 0 1px rgba(15, 20, 25, 0.08);
  width: 400px;
  height: 640px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
}
.root[data-position='bottom-left']  .panel { left: 0;  transform-origin: bottom left;  }
.root[data-position='bottom-right'] .panel { right: 0; transform-origin: bottom right; }
.panel.open {
  transform: translateY(0) scale(1);
  opacity: 1;
  pointer-events: auto;
}
.panel[hidden] { display: none; }
.root[data-size='compact']  .panel { width: 380px; height: 560px; }
.root[data-size='standard'] .panel { width: 400px; height: 640px; }
.root[data-size='generous'] .panel { width: 440px; height: 720px; }

/* ─── Panel head ─────────────────────────────────────── */
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  background: var(--munin-ink);
  color: var(--munin-paper);
  flex-shrink: 0;
}
.panel-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.panel-head-mark {
  width: 30px; height: 30px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  display: inline-flex; align-items: center; justify-content: center;
}
.panel-head-mark svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; }
.panel-head-text { min-width: 0; }
.panel-head-org {
  font-family: var(--munin-serif);
  font-size: 17px;
  line-height: 1;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-head-meta {
  margin-top: 4px;
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(251, 250, 247, 0.6);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.panel-head-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--munin-theme);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.08);
}
.panel-head-right { display: flex; gap: 4px; }
.icon-btn {
  width: 28px; height: 28px;
  border-radius: 6px;
  color: rgba(251, 250, 247, 0.6);
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: rgba(255, 255, 255, 0.08); color: var(--munin-paper); }
.icon-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; }

/* ─── Status banner ──────────────────────────────────── */
.status {
  padding: 6px 14px;
  background: #FFF7ED;
  color: #9A3412;
  font-size: 12px;
  border-bottom: 1px solid var(--munin-rule);
}
.status[hidden] { display: none; }

/* ─── Panel body ─────────────────────────────────────── */
.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.screen { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.screen[hidden] { display: none; }

/* ─── Welcome ────────────────────────────────────────── */
.welcome {
  padding: 24px 22px 16px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.welcome-eyebrow {
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--munin-ink-mute);
}
.welcome-eyebrow strong { font-weight: 500; }
.welcome-eyebrow a { color: inherit; text-decoration: none; }
.welcome-eyebrow a:hover, .welcome-eyebrow a:hover strong { color: var(--munin-ink); }
.welcome-eyebrow a:hover strong { text-decoration: underline; text-underline-offset: 2px; }
.welcome-h1 {
  font-family: var(--munin-serif);
  font-weight: 400;
  font-size: 30px;
  line-height: 1.05;
  letter-spacing: -0.02em;
  margin: 8px 0 16px;
  color: var(--munin-ink);
}
.welcome-h1 em {
  font-style: italic;
  color: var(--munin-ink-soft);
}
.welcome-status {
  font-size: 12.5px;
  color: var(--munin-ink-soft);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 22px;
}
.welcome-status-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--munin-theme);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--munin-theme) 18%, transparent);
}

.cta {
  width: 100%;
  background: var(--munin-paper);
  border: 1px solid var(--munin-ink);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-align: left;
  box-shadow: 0 2px 0 var(--munin-ink);
  transition: transform 120ms, box-shadow 120ms;
}
.cta:hover { transform: translateY(-1px); box-shadow: 0 3px 0 var(--munin-ink); }
.cta:active { transform: translateY(1px); box-shadow: 0 1px 0 var(--munin-ink); }
.cta-label { display: flex; flex-direction: column; gap: 4px; }
.cta-eyebrow {
  font-family: var(--munin-serif);
  font-size: 18px;
  line-height: 1;
  color: var(--munin-ink);
  letter-spacing: -0.01em;
}
.cta-sub {
  font-size: 12px;
  color: var(--munin-ink-mute);
}
.cta-arrow {
  font-family: var(--munin-serif);
  font-size: 22px;
  color: var(--munin-theme);
}

.section-head {
  margin: 24px 0 8px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--munin-rule);
  padding-bottom: 8px;
  font-family: var(--munin-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--munin-ink-soft);
}
.section-meta { color: var(--munin-ink-mute); }

.past { list-style: none; padding: 0; margin: 0 0 18px; }
.past-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--munin-rule);
  background: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: padding 100ms;
  font: inherit;
  color: inherit;
}
.past-row:hover { padding-left: 10px; }
.past-row:last-child { border-bottom: 0; }
.past-text { min-width: 0; flex: 1; }
.past-title {
  font-family: var(--munin-sans);
  font-size: 13.5px;
  color: var(--munin-ink);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.past-preview {
  font-family: var(--munin-sans);
  font-size: 12px;
  color: var(--munin-ink-mute);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.past-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
.tag {
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
}
.tag-open { background: color-mix(in srgb, var(--munin-theme) 12%, transparent); color: var(--munin-theme); }
.tag-closed { background: rgba(15, 20, 25, 0.06); color: var(--munin-ink-mute); }
.tag-snoozed { background: rgba(15, 20, 25, 0.06); color: var(--munin-ink-soft); }
.past-when {
  font-family: var(--munin-mono);
  font-size: 9px;
  color: var(--munin-ink-mute);
}

.empty {
  margin-top: 28px;
  padding: 28px 16px;
  border: 1px dashed var(--munin-rule);
  border-radius: 12px;
  text-align: center;
  color: var(--munin-ink-soft);
}
.empty-glyph { color: var(--munin-ink-mute); margin-bottom: 12px; display: inline-flex; }
.empty-glyph svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.empty-title {
  font-family: var(--munin-serif);
  font-size: 18px;
  letter-spacing: -0.01em;
  color: var(--munin-ink);
  margin-bottom: 6px;
}
.empty-sub { font-size: 12.5px; color: var(--munin-ink-mute); }

/* ─── Chat ───────────────────────────────────────────── */
.screen.chat { position: relative; }
.chat-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--munin-rule);
  flex-shrink: 0;
  background: var(--munin-paper);
}
.back-btn {
  width: 28px; height: 28px;
  border-radius: 6px;
  color: var(--munin-ink-soft);
  display: inline-flex; align-items: center; justify-content: center;
}
.back-btn:hover { background: var(--munin-paper-deep); color: var(--munin-ink); }
.back-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }
.chat-head-text { flex: 1; min-width: 0; }
.chat-title {
  font-family: var(--munin-serif);
  font-size: 16px;
  letter-spacing: -0.01em;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--munin-ink);
}
.chat-sub {
  margin-top: 5px;
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--munin-ink-mute);
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.chat-sub-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--munin-theme);
}

.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 18px 8px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--munin-paper);
  scroll-behavior: smooth;
}

.msg { display: flex; flex-direction: column; gap: 5px; max-width: 86%; }
.msg.mine   { align-self: flex-end;   align-items: flex-end;   }
.msg.theirs { align-self: flex-start; align-items: flex-start; }
.msg-head {
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--munin-ink-mute);
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.msg-who { color: var(--munin-ink-soft); font-weight: 600; }
.msg-role { color: var(--munin-ink-mute); }
.msg-t { color: var(--munin-ink-mute); font-family: var(--munin-mono); font-size: 9px; }
.msg-t.mine { padding-right: 2px; }

.bubble {
  border: 1px solid var(--munin-rule);
  background: var(--munin-paper-deep);
  color: var(--munin-ink);
  padding: 10px 13px;
  border-radius: 14px;
  border-bottom-left-radius: 4px;
  font-family: var(--munin-sans);
  font-size: 13.5px;
  line-height: 1.45;
  max-width: 100%;
  word-wrap: break-word;
}
.msg.mine .bubble {
  background: var(--munin-theme);
  border-color: var(--munin-theme);
  color: var(--munin-theme-fg);
  border-bottom-left-radius: 14px;
  border-bottom-right-radius: 4px;
  white-space: pre-wrap;
}
.bubble p { margin: 0; }
.bubble p + p { margin-top: 8px; }
.bubble ul, .bubble ol { margin: 6px 0 0; padding-left: 20px; }
.bubble li { margin: 2px 0; }
.bubble code {
  font-family: var(--munin-mono);
  font-size: 12px;
  background: rgba(15, 20, 25, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
}
.bubble pre {
  margin: 6px 0 0;
  padding: 8px 10px;
  background: rgba(15, 20, 25, 0.06);
  border-radius: 6px;
  overflow-x: auto;
  font-family: var(--munin-mono);
  font-size: 12px;
  line-height: 1.4;
  white-space: pre;
}
.bubble pre code {
  background: transparent;
  padding: 0;
  font-size: inherit;
}
.bubble a {
  color: var(--munin-theme);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.bubble strong { font-weight: 600; }
.bubble em { font-style: italic; }

.bubble.typing { display: inline-flex; gap: 4px; padding: 12px 14px; }
.bubble.typing span {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--munin-ink-mute);
  animation: munin-blink 1.2s infinite ease-in-out;
}
.bubble.typing span:nth-child(2) { animation-delay: .15s; }
.bubble.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes munin-blink {
  0%, 60%, 100% { opacity: .25; transform: translateY(0); }
  30%           { opacity: 1;   transform: translateY(-3px); }
}

/* System divider — "Pulled in a teammate", "Conversation closed", etc. */
.system {
  display: flex;
  align-items: center;
  gap: 10px;
  align-self: stretch;
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--munin-ink-mute);
  padding: 4px 0;
}
.system-line { flex: 1; height: 1px; background: var(--munin-rule); }
.system-text { white-space: nowrap; }

/* Inline email-save card */
.card {
  align-self: stretch;
  background: var(--munin-paper-deep);
  border: 1px solid var(--munin-rule);
  border-radius: 12px;
  padding: 14px 16px;
}
.card-eyebrow {
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--munin-ink-mute);
}
.card-title {
  font-family: var(--munin-sans);
  font-size: 13px;
  line-height: 1.45;
  margin: 6px 0 12px;
  color: var(--munin-ink);
}
.card-form { display: flex; gap: 6px; }
.card-form input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--munin-rule);
  background: var(--munin-paper);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--munin-ink);
  outline: none;
}
.card-form input:focus { border-color: var(--munin-ink); }
.card-form button {
  background: var(--munin-theme);
  color: var(--munin-theme-fg);
  border: 1px solid var(--munin-theme);
  border-radius: 8px;
  padding: 8px 14px;
  font-family: var(--munin-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.card-skip {
  margin-top: 8px;
  font-family: var(--munin-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--munin-ink-mute);
}
.card-skip:hover { color: var(--munin-ink); }
.card-done .card-eyebrow { color: var(--munin-theme); }
.card-done .card-title { margin-bottom: 0; }
.card-done .card-title strong { color: var(--munin-ink); font-weight: 600; }

/* ─── Composer ───────────────────────────────────────── */
.composer {
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 12px 14px;
  border-top: 1px solid var(--munin-rule);
  background: var(--munin-paper);
  flex-shrink: 0;
}
.composer textarea {
  flex: 1;
  box-sizing: border-box;
  border: 1px solid var(--munin-rule);
  background: var(--munin-paper-deep);
  border-radius: 12px;
  padding: 10px 14px;
  font: inherit;
  font-size: 13.5px;
  line-height: 1.4;
  color: var(--munin-ink);
  resize: none;
  outline: none;
  max-height: 110px;
  overflow-y: auto;
  min-height: 56px;
}
.composer textarea:focus { border-color: var(--munin-ink); background: var(--munin-paper); }
.composer-row {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 4px;
}
.counter {
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--munin-ink-mute);
}
.counter.over { color: #B91C1C; }
.send {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--munin-rule);
  color: var(--munin-ink-mute);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: border-color 120ms, background 120ms, color 120ms;
}
.send:hover:not(:disabled) { border-color: var(--munin-ink); background: var(--munin-paper-deep); color: var(--munin-ink); }
.send:disabled { opacity: 0.55; cursor: not-allowed; }
.send.active { color: var(--munin-theme); border-color: var(--munin-theme); }
.send svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }

/* ─── Voice — header trigger pill ────────────────────── */
.voice-trigger {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--munin-rule);
  border-radius: 999px;
  padding: 6px 12px 6px 10px;
  color: var(--munin-ink-soft);
  background: transparent;
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  transition: border-color 120ms, background 120ms, color 120ms;
}
.voice-trigger:hover { border-color: var(--munin-ink); color: var(--munin-ink); background: var(--munin-paper-deep); }
.voice-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
.voice-trigger svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; }
.voice-trigger[hidden] { display: none; }

/* ─── Voice — minimized banner above messages ────────── */
.voice-banner {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--munin-ink);
  color: var(--munin-paper);
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 9px 16px;
  font-family: var(--munin-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  flex-shrink: 0;
  text-align: left;
  transition: background 120ms;
}
.voice-banner:hover { background: #1a1815; }
.voice-banner[hidden] { display: none; }
.voice-banner-left { display: inline-flex; align-items: center; gap: 8px; }
.voice-banner-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--munin-theme);
  animation: voice-blink 1.4s ease-in-out infinite;
}
.voice-banner[data-muted='true'] .voice-banner-dot {
  background: #E0A93B;
  animation: none;
}
.voice-banner[data-state='error'] .voice-banner-dot { background: #B91C1C; animation: none; }
.voice-banner-timer { color: var(--munin-paper); font-variant-numeric: tabular-nums; }
.voice-banner-muted-tag {
  margin-left: 6px;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: #E0A93B;
}
.voice-banner-muted-tag[hidden] { display: none; }
.voice-banner-right { color: rgba(251, 250, 247, 0.55); }

/* ─── Voice — full-overlay call screen ───────────────── */
.voice-call {
  position: absolute;
  inset: 0;
  background: var(--munin-ink);
  color: var(--munin-paper);
  display: flex;
  flex-direction: column;
  z-index: 5;
}
.voice-call[hidden] { display: none; }
.voice-call-min {
  align-self: flex-start;
  margin: 14px 0 0 12px;
  color: rgba(251, 250, 247, 0.55);
  font-family: var(--munin-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 6px 10px;
  border-radius: 6px;
  background: transparent;
}
.voice-call-min:hover { color: var(--munin-paper); background: rgba(255, 255, 255, 0.06); }
.voice-call-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 12px 24px 24px;
  text-align: center;
}
.voice-call-avatar {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
  color: var(--munin-paper);
}
.voice-call-avatar svg { width: 48px; height: 48px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.voice-call-avatar.pulsing::before,
.voice-call-avatar.pulsing::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.22);
  animation: voice-callpulse 2s ease-out infinite;
  pointer-events: none;
}
.voice-call-avatar.pulsing::after { animation-delay: 1s; }
.voice-call-name {
  font-family: var(--munin-serif);
  font-size: 26px;
  letter-spacing: -0.02em;
  line-height: 1;
}
.voice-call-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--munin-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(251, 250, 247, 0.7);
}
.voice-call-status .voice-call-sep { color: rgba(251, 250, 247, 0.35); }
.voice-call-status .voice-call-timer { color: var(--munin-paper); font-variant-numeric: tabular-nums; }
.voice-call-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--munin-theme);
}
.voice-call-dot.blink { animation: voice-blink 1.4s ease-in-out infinite; }
.voice-call[data-state='error'] .voice-call-dot { background: #B91C1C; animation: none; }
.voice-call-hint {
  max-width: 240px;
  margin-top: 6px;
  font-family: var(--munin-sans);
  font-size: 11.5px;
  line-height: 1.45;
  color: rgba(251, 250, 247, 0.5);
}
.voice-call-controls {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 18px 18px 26px;
}
.voice-call-btn {
  flex: 0 1 110px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--munin-paper);
  border-radius: 14px;
  padding: 14px 8px 12px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  transition: background 120ms, border-color 120ms;
}
.voice-call-btn:hover { background: rgba(255, 255, 255, 0.12); }
.voice-call-btn.on {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.22);
}
.voice-call-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.voice-call-btn-end {
  background: #B8493A;
  border-color: #B8493A;
  color: #FBFAF7;
}
.voice-call-btn-end:hover { background: #A23E30; border-color: #A23E30; }

@keyframes voice-blink {
  0%, 100% { opacity: 0.3; }
  50%      { opacity: 1; }
}
@keyframes voice-callpulse {
  0%   { transform: scale(1);   opacity: 1; }
  100% { transform: scale(1.9); opacity: 0; }
}

/* ─── Footer credit ──────────────────────────────────── */
.footer-credit {
  padding: 8px 16px 10px;
  font-family: var(--munin-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--munin-ink-mute);
  text-align: center;
  border-top: 1px solid var(--munin-rule);
  background: var(--munin-paper);
  flex-shrink: 0;
}
.footer-credit strong { color: var(--munin-ink); font-weight: 500; }
.footer-credit a { color: inherit; text-decoration: none; }
.footer-credit a:hover { color: var(--munin-ink); }
.footer-credit a:hover strong { text-decoration: underline; text-underline-offset: 2px; }
.composer textarea:disabled { opacity: 0.55; cursor: not-allowed; }

/* ─── Responsive + reduced motion ────────────────────── */
@media (max-width: 600px) {
  .root { bottom: 16px; }
  .root[data-position='bottom-right'] { right: 16px; }
  .root[data-position='bottom-left']  { left:  16px; }

  .root[data-size] .panel {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    max-width: none;
    max-height: none;
    border-radius: 0;
    transform-origin: bottom center;
  }
  .panel-head { padding-top: calc(16px + env(safe-area-inset-top)); }
  .composer { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .voice-call { padding-top: env(safe-area-inset-top); }
  .voice-call-controls { padding-bottom: calc(26px + env(safe-area-inset-bottom)); }
}

@media (hover: none) and (pointer: coarse) {
  .composer textarea,
  .card-form input { font-size: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .launcher { transition: none; }
  .panel { transition: none; }
  .bubble.typing span { animation: none; opacity: 0.6; }
}
`;
