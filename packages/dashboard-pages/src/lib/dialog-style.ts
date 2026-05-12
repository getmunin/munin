/**
 * Shared typography + spacing tokens for in-dialog form elements.
 * Dialog forms use a sans-serif prose voice (sentence case, no eyebrow tracking)
 * instead of the editorial mono-caps style used in page chrome.
 *
 * Apply via the component's `className` prop — tailwind-merge resolves conflicts
 * with the component's own base classes.
 */

export const dialogLabelClass =
  'font-sans normal-case tracking-normal text-sm text-ink dark:text-foreground font-semibold leading-none gap-0';

export const dialogHintClass =
  'font-sans normal-case tracking-normal text-[13px] text-ink-soft dark:text-foreground/70 leading-snug';

export const dialogButtonClass =
  'font-sans normal-case tracking-normal text-[13px] font-medium h-10 px-4 gap-1.5';

/**
 * Use on `<DialogFooter>` to get the paper-deep footer strip with edge-to-edge
 * background and a hairline above (matches the mockup).
 */
export const dialogFooterClass =
  '-mx-6 -mb-6 mt-6 px-6 py-3 bg-paper-deep border-t-[0.5px] border-rule-soft dark:bg-secondary dark:border-rule-on-dark flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';
