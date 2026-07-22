import type { Config } from 'tailwindcss';

const muninPreset: Omit<Config, 'content'> = {
  darkMode: 'media',
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      // Tailwind v3 ships no default `invalid` aria variant (v4 does), so
      // `aria-invalid:*` utilities compile to nothing without this.
      aria: {
        invalid: 'invalid="true"',
      },
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        bone: 'rgb(var(--munin-bone) / <alpha-value>)',
        paper: {
          DEFAULT: 'rgb(var(--munin-paper) / <alpha-value>)',
          deep: 'rgb(var(--munin-paper-deep) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--munin-ink) / <alpha-value>)',
          soft: 'rgb(var(--munin-fg-2) / <alpha-value>)',
          mute: 'rgb(var(--munin-fg-3) / <alpha-value>)',
        },
        cobalt: {
          DEFAULT: 'rgb(var(--munin-accent) / <alpha-value>)',
          soft: 'rgb(var(--munin-accent-soft) / <alpha-value>)',
          deep: 'rgb(var(--munin-accent-deep) / <alpha-value>)',
        },
        rule: {
          DEFAULT: 'rgb(var(--munin-ink) / <alpha-value>)',
          soft: 'rgb(var(--munin-ink) / var(--munin-rule-soft-alpha))',
          'on-dark': 'rgb(var(--munin-fg-on-dark-2) / var(--munin-rule-on-dark-alpha))',
        },
        'auth-navy': {
          DEFAULT: 'rgb(var(--munin-auth-navy) / <alpha-value>)',
          hover: 'rgb(var(--munin-auth-navy-hover) / <alpha-value>)',
        },
        'alert-bad': {
          DEFAULT: 'rgb(var(--munin-alert-bad-bg) / <alpha-value>)',
          ink: 'rgb(var(--munin-alert-bad-ink) / <alpha-value>)',
          border: 'rgb(var(--munin-alert-bad-border) / <alpha-value>)',
        },
        'invite-good': {
          DEFAULT: 'rgb(var(--munin-invite-good-bg) / <alpha-value>)',
          ink: 'rgb(var(--munin-invite-good-ink) / <alpha-value>)',
        },
        'invite-bad': {
          DEFAULT: 'rgb(var(--munin-invite-bad-bg) / <alpha-value>)',
          ink: 'rgb(var(--munin-invite-bad-ink) / <alpha-value>)',
        },
      },
      borderRadius: {
        none: '0',
        sm: '0',
        DEFAULT: '0',
        md: '0',
        lg: 'var(--radius)',
        input: 'var(--munin-radius-input)',
        bubble: 'var(--munin-radius-bubble)',
        full: '9999px',
      },
      fontFamily: {
        sans: ['var(--munin-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--munin-serif)', 'Times New Roman', 'serif'],
        mono: ['var(--munin-mono)', 'ui-monospace', 'monospace'],
      },
      transitionTimingFunction: {
        munin: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '360ms',
      },
      letterSpacing: {
        eyebrow: '0.16em',
        meta: '0.10em',
      },
    },
  },
};

export default muninPreset;
