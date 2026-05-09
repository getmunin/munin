/**
 * The widget runs inside a closed Shadow DOM root so the host page's
 * CSS never reaches in (and we never reach out). The whole stylesheet
 * is the template literal below; theme color is injected via the
 * `--munin-theme` custom property on the root, position via the
 * `data-position` attribute.
 */
export const WIDGET_CSS = String.raw`
:host {
  --munin-theme: #2563eb;
  --munin-theme-fg: #ffffff;
  --munin-bg: #ffffff;
  --munin-fg: #111827;
  --munin-fg-muted: #6b7280;
  --munin-border: #e5e7eb;
  --munin-bubble-end-user: var(--munin-theme);
  --munin-bubble-end-user-fg: var(--munin-theme-fg);
  --munin-bubble-agent: #f3f4f6;
  --munin-bubble-agent-fg: var(--munin-fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color-scheme: light;
}

.root {
  position: fixed;
  bottom: 16px;
  z-index: 2147483647;
  font-size: 14px;
  line-height: 1.4;
}
.root[data-position='bottom-right'] { right: 16px; }
.root[data-position='bottom-left']  { left:  16px; }

button {
  font: inherit;
  cursor: pointer;
  background: none;
  border: 0;
  color: inherit;
  padding: 0;
}

/* — Launcher bubble — */
.launcher {
  width: 56px;
  height: 56px;
  border-radius: 999px;
  background: var(--munin-theme);
  color: var(--munin-theme-fg);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 120ms ease;
}
.launcher:hover { transform: scale(1.04); }
.launcher:focus-visible { outline: 3px solid color-mix(in srgb, var(--munin-theme) 40%, white); outline-offset: 2px; }
.launcher svg { width: 28px; height: 28px; fill: currentColor; }

/* — Panel — */
.panel {
  width: 360px;
  max-width: calc(100vw - 32px);
  height: 520px;
  max-height: calc(100vh - 32px);
  background: var(--munin-bg);
  color: var(--munin-fg);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--munin-border);
}

.header {
  background: var(--munin-theme);
  color: var(--munin-theme-fg);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}
.close {
  width: 28px; height: 28px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  opacity: 0.85;
}
.close:hover { background: rgba(255,255,255,0.15); }
.close svg { width: 16px; height: 16px; fill: currentColor; }

.status {
  padding: 6px 14px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 12px;
  border-bottom: 1px solid var(--munin-border);
}
.status[hidden] { display: none; }

.messages {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--munin-bg);
}
.greeting {
  align-self: flex-start;
  background: var(--munin-bubble-agent);
  color: var(--munin-bubble-agent-fg);
  padding: 10px 12px;
  border-radius: 12px 12px 12px 2px;
  max-width: 80%;
}

.message {
  padding: 8px 12px;
  border-radius: 12px;
  max-width: 80%;
  white-space: pre-wrap;
  word-break: break-word;
}
.message.end_user {
  align-self: flex-end;
  background: var(--munin-bubble-end-user);
  color: var(--munin-bubble-end-user-fg);
  border-radius: 12px 12px 2px 12px;
}
.message.agent, .message.system {
  align-self: flex-start;
  background: var(--munin-bubble-agent);
  color: var(--munin-bubble-agent-fg);
  border-radius: 12px 12px 12px 2px;
}
.message.system { font-style: italic; opacity: 0.85; }

/* Typing indicator — three dots */
.typing {
  align-self: flex-start;
  background: var(--munin-bubble-agent);
  padding: 10px 12px;
  border-radius: 12px 12px 12px 2px;
  display: inline-flex;
  gap: 4px;
}
.typing[hidden] { display: none; }
.typing span {
  width: 6px; height: 6px;
  border-radius: 999px;
  background: var(--munin-fg-muted);
  animation: munin-blink 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes munin-blink {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}

/* Composer */
.composer {
  border-top: 1px solid var(--munin-border);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--munin-bg);
}
.composer textarea {
  resize: none;
  border: 1px solid var(--munin-border);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  color: var(--munin-fg);
  background: var(--munin-bg);
  min-height: 38px;
  max-height: 120px;
  outline: none;
}
.composer textarea:focus { border-color: var(--munin-theme); }
.composer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.counter {
  font-size: 11px;
  color: var(--munin-fg-muted);
}
.counter.over { color: #b91c1c; }
.send {
  background: var(--munin-theme);
  color: var(--munin-theme-fg);
  padding: 6px 14px;
  border-radius: 999px;
  font-weight: 600;
}
.send:disabled {
  background: var(--munin-border);
  color: var(--munin-fg-muted);
  cursor: not-allowed;
}

@media (max-width: 480px) {
  .panel { width: calc(100vw - 32px); }
}

@media (prefers-reduced-motion: reduce) {
  .launcher { transition: none; }
  .typing span { animation: none; opacity: 0.6; }
}
`;
