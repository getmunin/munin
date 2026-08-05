---
'@getmunin/chat-widget': minor
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/docs-pages': minor
---

chat widget: `data-munin-fonts="inherit"` really adopts the page's typography, and the launcher bubble is themeable

`data-munin-fonts` used to accept `"system"`, which did nothing to the type stack: `buildWidgetCss()`
discarded its argument, so the only effect was skipping the `@font-face` injection and letting
`'Munin Serif'` / `'Munin Mono'` fall through to `ui-serif` / `ui-monospace`. The widget still rendered
serif headings and mono labels, and never picked up the host page's font — `all: initial` on the shadow
host plus `font-family: var(--munin-sans)` on `:host` made that impossible.

`"system"` is replaced by `"inherit"`, which does what the name says: no webfonts are downloaded and
every string in the panel renders in the `font-family` the page applies to `<body>`. Sizes, weights and
italics are unchanged. `"bundled"` remains the default and the designed look. An embed still passing
`data-munin-fonts="system"` logs the usual console warning and falls back to `"bundled"`.

The launcher bubble was hardcoded to the near-black ink of the panel header, with `data-munin-theme-color`
only reaching the badge, links, send button and visitor bubbles. Two new attributes fix that:
`data-munin-launcher-color` fills the bubble and `data-munin-launcher-icon-color` overrides the glyph.
Given only a bubble color, the glyph picks whichever of ink/paper contrasts better — the same pick now
also drives `--munin-theme-fg`, so a light `data-munin-theme-color` no longer paints near-white text on
visitor bubbles.

Three more gaps closed in the same pass:

- **`data-munin-header-color`** themes the panel's top bar (org name + close button) the same way
  `data-munin-launcher-color` themes the bubble — auto-contrast text/icon, defaults to the same fixed
  chrome tone.
- **`data-munin-color-scheme`** (`auto` default, `light`, `dark`) gives the panel a real dark mode.
  `auto` follows `prefers-color-scheme` live; `light`/`dark` pin it regardless of the visitor's OS
  setting. Only the panel body (welcome/chat/composer/cards/bubbles) inverts — the launcher, header bar
  and voice-call screen keep their fixed near-black chrome in every mode (introduced `--munin-chrome`/
  `--munin-chrome-fg`, decoupled from the `--munin-ink`/`--munin-paper` pair that now flips per scheme)
  so brand-color and dark-mode customization don't fight each other.
- **`window.mn.widget`** exposes `open()`/`close()`/`toggle()`/`isOpen()` once the script has run, so a
  site's own "Chat with us" link (or a proactive prompt) can drive the panel instead of requiring a click
  on the launcher bubble. It's one global, so with two embeds on a page it stays bound to whichever
  mounted first and the second warns instead of silently stealing an already-wired control surface.

Two latent bugs found while reviewing the above, both verified in a browser rather than from the source:

- `color-scheme` was declared on `:host`, where the shadow host's inline `style="all: initial"` outranks
  it — so it computed to `normal` and every UA-rendered surface inside the panel (scrollbar track/thumb
  where scrollbars aren't overlay-style, autofill styling) stayed in light mode even with the panel fully
  dark. It now sits on `.root`, which the inline reset can't reach. The pre-existing `color-scheme: light`
  was inert for the same reason.
- `HEX_COLOR` accepted `{3,8}` hex digits, including the 5- and 7-digit lengths CSS rejects. A typo'd
  `data-munin-header-color="#12345"` passed validation without a warning, reached CSS as an invalid token,
  and resolved to a *transparent* header — near-white auto-contrast text on the near-white panel, so the
  org name and close button both became invisible. Now `{3,4}|{6}|{8}` only, so a bad value warns and
  falls back like every other malformed attribute.

The panel's edge also moved to a `--munin-edge` token that inverts to a light hairline in dark mode; the
only edge treatment was an `inset … rgba(15, 20, 25, 0.08)` hairline plus dark drop shadows, which made
the panel dissolve entirely into a host page whose background was near `#1B1D22`. Light mode is
byte-identical.

Two more hardcoded colors became tokens, on opposite sides of the chrome/body split:

- The two voice `[data-state='error']` dots used `#B91C1C` on the always-dark chrome — 2.8:1 against
  `#0F1419`, too weak for a 7px status dot. They now use a `--munin-chrome-danger` that is deliberately
  *not* scheme-flipped (`#F87171`, ~6.6:1) because the surface under them never flips. Body-scoped
  `--munin-danger` still inverts per scheme for `.counter.over`.
- `.pcard-shot` hardcoded `background: #fff`, a blinding tile in a dark panel. It's now `--munin-shot`:
  `#FFFFFF` in light, `#E8E4DC` in dark. It stays a *light* tile in both because `object-fit: contain`
  letterboxes product photography that overwhelmingly assumes white — a dark tile would make
  transparent-PNG product art disappear and leave white-background JPEGs sitting in a bright rectangle.
  The `.pcard-shot-empty` placeholder is unaffected and still follows the scheme.
