/**
 * Parses the embed snippet's `data-*` attributes into a typed `WidgetConfig`.
 *
 * The widget is configured entirely on its `<script>` tag:
 *   <script src="…/widget.js"
 *           data-munin-host="https://munin.example.com"
 *           data-widget-key="mn_widget_…"
 *           data-channel-id="…"
 *           data-external-id="user_42"
 *           data-user-hash="<hex-hmac>"
 *           data-munin-theme-color="#10b981"
 *           data-munin-position="bottom-right"
 *           data-munin-greeting="Hi! How can we help?"
 *           data-munin-title="Chat"
 *           data-munin-visitor-name="Ada"
 *           data-munin-visitor-email="ada@example.com"
 *           data-munin-visitor-meta='{"plan":"pro"}'
 *           data-munin-meta-account-id="acc_42"
 *           defer></script>
 *
 * Returns `{ ok: true, config }` or `{ ok: false, errors }`. The widget
 * bootstrap logs (but doesn't throw on) parse errors; the goal is to never
 * break the host page even if the operator misconfigures. Identity attrs
 * are conditional-required: if either `data-external-id` or
 * `data-user-hash` is set, both must be set.
 */

export const WIDGET_END_USER_BODY_MAX_CHARS = 1_000;
export const WIDGET_END_USER_BODY_HTML_MAX_CHARS = 4_000;

const VALID_POSITIONS = ['bottom-right', 'bottom-left'] as const;
type Position = (typeof VALID_POSITIONS)[number];

const VALID_SIZES = ['compact', 'standard', 'generous'] as const;
type Size = (typeof VALID_SIZES)[number];

const VALID_FONTS = ['bundled', 'system'] as const;
type Fonts = (typeof VALID_FONTS)[number];

const HEX64 = /^[0-9a-f]{64}$/i;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
// Loose RFC-5322ish; matches what the BE Zod `z.string().email()` accepts
// for the most part. We re-validate server-side anyway.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VISITOR_META_MAX_BYTES = 4 * 1024;

export interface WidgetVisitor {
  name?: string;
  email?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface WidgetConfig {
  /** REST + WS host, e.g. `https://munin.example.com`. No trailing slash. */
  host: string;
  /** `mn_widget_*` key bound to the channel below. */
  widgetKey: string;
  channelId: string;
  /** Operator's user ID. Required iff `userHash` is set. */
  externalId?: string;
  /** Hex sha-256 HMAC paired with `externalId`. Required iff `externalId` is set. */
  userHash?: string;
  themeColor: string;
  position: Position;
  greeting: string;
  title: string;
  eyebrow: string;
  size: Size;
  fonts: Fonts;
  showHistory: boolean;
  visitor?: WidgetVisitor;
}

export interface ParseError {
  attr: string;
  message: string;
}

export type ParseResult =
  | { ok: true; config: WidgetConfig; warnings: ParseError[] }
  | { ok: false; errors: ParseError[]; warnings: ParseError[] };

const DEFAULTS = {
  themeColor: '#0066FF',
  position: 'bottom-right' as Position,
  greeting: 'Hi there. How can we help?',
  title: 'Chat',
  eyebrow: 'Powered by Munin',
  size: 'standard' as Size,
  fonts: 'bundled' as Fonts,
  showHistory: true,
};

export function parseConfig(scriptEl: HTMLElement): ParseResult {
  const errors: ParseError[] = [];
  const warnings: ParseError[] = [];

  const host = req(scriptEl, 'data-munin-host', errors);
  const widgetKey = req(scriptEl, 'data-widget-key', errors);
  const channelId = req(scriptEl, 'data-channel-id', errors);

  const externalId = scriptEl.getAttribute('data-external-id') ?? undefined;
  const userHash = scriptEl.getAttribute('data-user-hash') ?? undefined;
  if ((externalId && !userHash) || (userHash && !externalId)) {
    errors.push({
      attr: 'data-external-id+data-user-hash',
      message: 'both data-external-id and data-user-hash must be set together',
    });
  }
  if (userHash && !HEX64.test(userHash)) {
    errors.push({
      attr: 'data-user-hash',
      message: 'must be a 64-char hex sha256 digest',
    });
  }

  const themeColor =
    optColor(scriptEl, 'data-munin-theme-color', warnings) ?? DEFAULTS.themeColor;
  const position = optPosition(scriptEl, warnings) ?? DEFAULTS.position;
  const greeting = scriptEl.getAttribute('data-munin-greeting') ?? DEFAULTS.greeting;
  const title =
    scriptEl.getAttribute('data-munin-org-name') ??
    scriptEl.getAttribute('data-munin-title') ??
    DEFAULTS.title;
  const eyebrow = scriptEl.getAttribute('data-munin-eyebrow') ?? DEFAULTS.eyebrow;
  const size = optEnum(scriptEl, 'data-munin-size', VALID_SIZES, warnings) ?? DEFAULTS.size;
  const fonts = optEnum(scriptEl, 'data-munin-fonts', VALID_FONTS, warnings) ?? DEFAULTS.fonts;
  const showHistory =
    optBool(scriptEl, 'data-munin-show-history', warnings) ?? DEFAULTS.showHistory;

  const visitor = parseVisitor(scriptEl, warnings);

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    warnings,
    config: {
      host: stripTrailingSlash(host!),
      widgetKey: widgetKey!,
      channelId: channelId!,
      externalId,
      userHash,
      themeColor,
      position,
      greeting,
      title,
      eyebrow,
      size,
      fonts,
      showHistory,
      visitor,
    },
  };
}

function req(el: HTMLElement, attr: string, errors: ParseError[]): string | null {
  const v = el.getAttribute(attr);
  if (!v || v.trim().length === 0) {
    errors.push({ attr, message: `${attr} is required` });
    return null;
  }
  return v.trim();
}

function optColor(el: HTMLElement, attr: string, warnings: ParseError[]): string | undefined {
  const v = el.getAttribute(attr);
  if (!v) return undefined;
  if (!HEX_COLOR.test(v.trim())) {
    warnings.push({ attr, message: `${attr} must be a hex color (e.g. #2563eb)` });
    return undefined;
  }
  return v.trim();
}

function optPosition(el: HTMLElement, warnings: ParseError[]): Position | undefined {
  const v = el.getAttribute('data-munin-position');
  if (!v) return undefined;
  const t = v.trim() as Position;
  if (!VALID_POSITIONS.includes(t)) {
    warnings.push({
      attr: 'data-munin-position',
      message: `must be one of ${VALID_POSITIONS.join(', ')}`,
    });
    return undefined;
  }
  return t;
}

function optEnum<T extends string>(
  el: HTMLElement,
  attr: string,
  allowed: readonly T[],
  warnings: ParseError[],
): T | undefined {
  const v = el.getAttribute(attr);
  if (!v) return undefined;
  const t = v.trim() as T;
  if (!allowed.includes(t)) {
    warnings.push({ attr, message: `${attr} must be one of ${allowed.join(', ')}` });
    return undefined;
  }
  return t;
}

function optBool(el: HTMLElement, attr: string, warnings: ParseError[]): boolean | undefined {
  const v = el.getAttribute(attr);
  if (v === null) return undefined;
  const t = v.trim().toLowerCase();
  if (t === '' || t === 'true' || t === '1' || t === 'yes') return true;
  if (t === 'false' || t === '0' || t === 'no') return false;
  warnings.push({ attr, message: `${attr} must be true|false` });
  return undefined;
}

function parseVisitor(el: HTMLElement, warnings: ParseError[]): WidgetVisitor | undefined {
  const name = el.getAttribute('data-munin-visitor-name')?.trim();
  const emailRaw = el.getAttribute('data-munin-visitor-email')?.trim();
  let email: string | undefined;
  if (emailRaw) {
    if (EMAIL.test(emailRaw)) {
      email = emailRaw;
    } else {
      warnings.push({
        attr: 'data-munin-visitor-email',
        message: 'invalid email format; ignoring',
      });
    }
  }

  const metadata = parseVisitorMetadata(el, warnings);

  if (!name && !email && !metadata) return undefined;
  const out: WidgetVisitor = {};
  if (name) out.name = name.slice(0, 120);
  if (email) out.email = email;
  if (metadata) out.metadata = metadata;
  return out;
}

function parseVisitorMetadata(
  el: HTMLElement,
  warnings: ParseError[],
): Record<string, string | number | boolean> | undefined {
  // Sugar form first: every data-munin-meta-<key>=<value> attr.
  const sugar: Record<string, string | number | boolean> = {};
  for (const a of Array.from(el.attributes)) {
    const m = /^data-munin-meta-(.+)$/.exec(a.name);
    if (!m) continue;
    const key = camelize(m[1]!);
    sugar[key] = a.value;
  }

  // Explicit JSON form. Wins on key collision with the sugar form.
  let explicit: Record<string, string | number | boolean> | null = null;
  const raw = el.getAttribute('data-munin-visitor-meta');
  if (raw) {
    if (byteLength(raw) > VISITOR_META_MAX_BYTES) {
      warnings.push({
        attr: 'data-munin-visitor-meta',
        message: `exceeds ${VISITOR_META_MAX_BYTES} bytes; ignoring`,
      });
    } else {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          explicit = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              explicit[k] = v;
            } else {
              warnings.push({
                attr: 'data-munin-visitor-meta',
                message: `value at "${k}" must be string|number|boolean; dropped`,
              });
            }
          }
        } else {
          warnings.push({
            attr: 'data-munin-visitor-meta',
            message: 'must be a flat JSON object; ignoring',
          });
        }
      } catch {
        warnings.push({
          attr: 'data-munin-visitor-meta',
          message: 'malformed JSON; ignoring',
        });
      }
    }
  }

  const merged: Record<string, string | number | boolean> = { ...sugar, ...(explicit ?? {}) };
  return Object.keys(merged).length === 0 ? undefined : merged;
}

function camelize(kebab: string): string {
  return kebab.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
