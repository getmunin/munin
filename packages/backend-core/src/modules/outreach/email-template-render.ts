import mjml2html from 'mjml';
import { renderMarkdownToHtml } from '../conv/email/markdown.ts';
import { htmlToText } from '../conv/email/html-text.ts';
import { OutreachInvalidError } from './outreach.service.ts';

export const EMAIL_CONTENT_FORMATS = ['markdown', 'mjml'] as const;
export type EmailContentFormat = (typeof EMAIL_CONTENT_FORMATS)[number];

export interface EmailContent {
  format: EmailContentFormat;
  body: string;
}

export interface EmailRenderValues {
  subject?: string | null;
  preheader?: string | null;
  orgName?: string | null;
  name?: string | null;
  unsubscribeUrl?: string | null;
}

export interface CompiledEmail {
  html: string;
  warnings: string[];
}

export interface RenderedEmail {
  html: string;
  text: string;
  htmlBytes: number;
  warnings: string[];
}

export const TEMPLATE_PLACEHOLDERS = [
  'content',
  'unsubscribe_url',
  'preheader',
  'subject',
  'org_name',
  'name',
] as const;

const CONTENT_PLACEHOLDERS = ['subject', 'org_name', 'name'] as const;

export const GMAIL_CLIP_WARNING_BYTES = 90_000;

const PLACEHOLDER = /\{\{\s*([^{}|\s]+)\s*(?:\|([^{}]*))?\}\}/g;
const UNSUBSCRIBE_IN_HREF = /href\s*=\s*(["'])\s*\{\{\s*unsubscribe_url\s*\}\}\s*\1/i;
const CONTENT_PROBE = '<mj-section><mj-column><mj-text>Preview</mj-text></mj-column></mj-section>';

const UNSAFE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|form|input|button|base|meta|link)\b/i,
    reason: 'contains a <$1> element, which email templates may not use',
  },
  { pattern: /<\s*mj-include\b/i, reason: 'uses <mj-include>, which is not supported; inline the markup instead' },
  { pattern: /\son[a-z]+\s*=/i, reason: 'contains an inline event handler attribute' },
  {
    pattern: /(?:=\s*["']?|url\(\s*["']?)\s*(javascript|vbscript|data)\s*:/i,
    reason: 'links to a $1: URL; host images and files somewhere public (for example as CMS assets) instead',
  },
  { pattern: /@import\b/i, reason: 'uses CSS @import; declare web fonts with <mj-font> instead' },
  { pattern: /expression\s*\(/i, reason: 'uses a CSS expression()' },
];

export async function validateEmailTemplate(mjml: string): Promise<CompiledEmail> {
  assertTemplatePlaceholders(mjml);
  assertSafeMarkup(mjml, 'template');
  return compileDocument(mjml, CONTENT_PROBE, 'probe');
}

export async function compileEmail(mjml: string, content: EmailContent): Promise<CompiledEmail> {
  assertTemplatePlaceholders(mjml);
  assertSafeMarkup(mjml, 'template');
  return compileDocument(mjml, contentToMjml(content), content.format);
}

async function compileDocument(
  mjml: string,
  fragment: string,
  format: FragmentOrigin,
): Promise<CompiledEmail> {
  const [before, after] = splitAtContent(mjml);
  const document = `${before}${fragment}${after}`;
  const contentStartLine = lineCount(before);
  const contentLines = lineCount(fragment);

  let html: string;
  try {
    const result = await mjml2html(document, {
      validationLevel: 'strict',
      ignoreIncludes: true,
      keepComments: false,
      minify: true,
    });
    html = result.html;
  } catch (err) {
    throw new OutreachInvalidError(
      describeCompileFailure(err, contentStartLine, contentLines, format),
    );
  }

  const warnings: string[] = [];
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > GMAIL_CLIP_WARNING_BYTES) {
    warnings.push(
      `rendered email is ${Math.round(htmlBytes / 1000)}KB; Gmail clips messages above 102KB, which hides the footer and its unsubscribe link`,
    );
  }
  if (/<mj-image\b(?![^>]*\balt\s*=)[^>]*>/i.test(document)) {
    warnings.push('an <mj-image> has no alt text; many clients block images by default and show only the alt');
  }
  return { html, warnings };
}

export function personalizeEmail(
  compiledHtml: string,
  values: EmailRenderValues,
): { html: string; text: string } {
  const html = compiledHtml.replace(PLACEHOLDER, (_match, rawName: string, fallback?: string) => {
    const value = placeholderValue(rawName, values);
    const chosen = value?.trim() ? value : (fallback ?? '').trim();
    return escapeHtml(chosen);
  });
  return { html, text: htmlToText(html) };
}

export async function renderEmail(
  mjml: string,
  content: EmailContent,
  values: EmailRenderValues,
): Promise<RenderedEmail> {
  const compiled = await compileEmail(mjml, content);
  const { html, text } = personalizeEmail(compiled.html, values);
  return {
    html,
    text,
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    warnings: compiled.warnings,
  };
}

function placeholderValue(name: string, values: EmailRenderValues): string | null | undefined {
  switch (name) {
    case 'unsubscribe_url':
      return values.unsubscribeUrl;
    case 'preheader':
      return values.preheader;
    case 'subject':
      return values.subject;
    case 'org_name':
      return values.orgName;
    case 'name':
      return values.name;
    default:
      return '';
  }
}

function assertTemplatePlaceholders(mjml: string): void {
  let contentCount = 0;
  for (const match of mjml.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name)) {
      throw new OutreachInvalidError(
        `unknown placeholder {{${name}}}; templates may use ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}`,
      );
    }
    if (match[2] !== undefined && name !== 'name') {
      throw new OutreachInvalidError(`only {{name}} takes a fallback; {{${name}|…}} is not supported`);
    }
    if (name === 'content') contentCount += 1;
  }
  if (contentCount !== 1) {
    throw new OutreachInvalidError(
      `a template must contain {{content}} exactly once (found ${contentCount}); it marks where each message's sections go`,
    );
  }
  if (!UNSUBSCRIBE_IN_HREF.test(mjml)) {
    throw new OutreachInvalidError(
      'a template must link to {{unsubscribe_url}} in an href, for example <a href="{{unsubscribe_url}}">Unsubscribe</a>',
    );
  }
}

function assertContentPlaceholders(body: string): void {
  for (const match of body.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!(CONTENT_PLACEHOLDERS as readonly string[]).includes(name)) {
      throw new OutreachInvalidError(
        `content may not use {{${name}}}; content placeholders are ${CONTENT_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}`,
      );
    }
    if (match[2] !== undefined && name !== 'name') {
      throw new OutreachInvalidError(`only {{name}} takes a fallback; {{${name}|…}} is not supported`);
    }
  }
}

function contentToMjml(content: EmailContent): string {
  if (!content.body.trim()) throw new OutreachInvalidError('content must be non-empty');
  assertContentPlaceholders(content.body);
  if (content.format === 'markdown') {
    return `<mj-section><mj-column><mj-text>${renderMarkdownToHtml(content.body)}</mj-text></mj-column></mj-section>`;
  }
  assertSafeMarkup(content.body, 'content');
  if (/<\s*\/?\s*(mjml|mj-head|mj-body)\b/i.test(content.body)) {
    throw new OutreachInvalidError(
      'mjml content is a fragment of <mj-section> or <mj-wrapper> elements; leave out <mjml>, <mj-head> and <mj-body>, which the template provides',
    );
  }
  return content.body;
}

function splitAtContent(mjml: string): [string, string] {
  const match = /\{\{\s*content\s*\}\}/.exec(mjml)!;
  return [mjml.slice(0, match.index), mjml.slice(match.index + match[0].length)];
}

function assertSafeMarkup(source: string, label: 'template' | 'content'): void {
  for (const candidate of [source, decodeNumericEntities(source)]) {
    for (const { pattern, reason } of UNSAFE_PATTERNS) {
      const match = pattern.exec(candidate);
      if (match) {
        throw new OutreachInvalidError(
          `${label} ${reason.replace('$1', (match[1] ?? '').toLowerCase())}`,
        );
      }
    }
  }
}

type FragmentOrigin = EmailContentFormat | 'probe';

interface MjmlValidationError {
  line?: number;
  message?: string;
}

function describeCompileFailure(
  err: unknown,
  contentStartLine: number,
  contentLines: number,
  format: FragmentOrigin,
): string {
  const errors = (err as { errors?: MjmlValidationError[] }).errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return `template does not compile: ${stripPaths(err instanceof Error ? err.message : String(err))}`;
  }
  const described = errors.slice(0, 5).map((e) => {
    const where = locate(e.line, contentStartLine, contentLines, format);
    return `${where}${stripPaths(e.message ?? 'invalid markup')}`;
  });
  const more = errors.length > 5 ? ` (and ${errors.length - 5} more)` : '';
  return `MJML validation failed: ${described.join('; ')}${more}`;
}

function locate(
  line: number | undefined,
  contentStartLine: number,
  contentLines: number,
  format: FragmentOrigin,
): string {
  if (!line) return '';
  const contentEndLine = contentStartLine + contentLines - 1;
  if (line < contentStartLine) return `template line ${line}: `;
  if (line > contentEndLine) return `template line ${line - contentLines + 1}: `;
  if (format === 'probe') return `template line ${contentStartLine} ({{content}}): `;
  if (format === 'markdown') return 'content: ';
  return `content line ${line - contentStartLine + 1}: `;
}

function lineCount(value: string): number {
  return value.split('\n').length;
}

function stripPaths(message: string): string {
  return message.replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/()]+)+/g, '…').trim();
}

function decodeNumericEntities(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|\d+);?/gi, (whole, ref: string) => {
    const code = ref[0] === 'x' || ref[0] === 'X' ? parseInt(ref.slice(1), 16) : parseInt(ref, 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
