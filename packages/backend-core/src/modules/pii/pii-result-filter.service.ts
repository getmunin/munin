import { Injectable } from '@nestjs/common';
import {
  emptyPiiStats,
  getCurrentContext,
  pseudonymizeText,
  pseudonymizeValue,
  resolvePseudonyms,
  type ActorIdentity,
  type Audience,
  type PiiStats,
} from '@getmunin/core';
import type { FilteredToolResult, ToolDataFilter } from '@getmunin/mcp-toolkit';
import { PiiAnnotationsService } from './pii-annotations.service.ts';
import { PiiLexiconService } from './pii-lexicon.service.ts';
import { isPiiNerEnabled } from './pii-config.ts';
import { decidePiiMode } from './pii-policy.ts';
import { DEFAULT_PII_ORG_POLICY, readPiiOrgPolicy } from './pii-org-policy.ts';
import { collectSubjectIds, withholdUncheckedText } from './withhold.ts';

export type PiiCoverage = 'complete' | 'pending';

export type PiiLayer = 'deterministic' | 'directory' | 'ner';

export interface PiiResultMeta {
  mode: 'pseudonymized';
  coverage: PiiCoverage;
  layers: PiiLayer[];
  tokenized: number;
  masked: PiiStats['masked'];
  withholdUncheckedText: boolean;
  withheld: number;
}

export interface PseudonymizeOptions {
  withholdUncheckedText: boolean;
}

export const PII_META_KEY = 'munin/pii';

@Injectable()
export class PiiResultFilterService {
  constructor(
    private readonly lexicons: PiiLexiconService,
    private readonly annotations: PiiAnnotationsService,
  ) {}

  async filterFor(actor: ActorIdentity, audience: Audience): Promise<ToolDataFilter | undefined> {
    const policy = actor.orgId
      ? await readPiiOrgPolicy(getCurrentContext().db, actor.orgId)
      : DEFAULT_PII_ORG_POLICY;
    if (decidePiiMode(actor, audience, policy).mode === 'raw') return undefined;
    return this.pseudonymizingFilter({ withholdUncheckedText: policy.withholdUncheckedText });
  }

  pseudonymizingFilter(options: PseudonymizeOptions = { withholdUncheckedText: false }): ToolDataFilter {
    return {
      refuse: (tool) => (tool.rawDataOnly ? rawOnlyRefusal(tool.name) : null),
      input: (_tool, args) => this.resolve(args),
      output: (_tool, value) => this.pseudonymize(value, options),
      error: async (message) => pseudonymizeText(message, await this.lexicons.forCurrentOrg()),
    };
  }

  async pseudonymize(
    value: unknown,
    options: PseudonymizeOptions = { withholdUncheckedText: false },
  ): Promise<FilteredToolResult> {
    const ner = isPiiNerEnabled();
    const strict = options.withholdUncheckedText;
    let source = value;
    let withheld = 0;
    let coverage: PiiCoverage = 'complete';
    if (ner || strict) {
      const ids = collectSubjectIds(value);
      const unchecked = await this.annotations.uncheckedSubjects(
        ids.messages,
        strict ? ids.conversations : [],
      );
      if (ner && unchecked.messages.size > 0) coverage = 'pending';
      if (strict) ({ value: source, withheld } = withholdUncheckedText(value, unchecked));
    }
    const lexicon = await this.lexicons.forCurrentOrg();
    const stats = emptyPiiStats();
    const out = pseudonymizeValue(source, lexicon, stats);
    const meta: PiiResultMeta = {
      mode: 'pseudonymized',
      coverage,
      layers: ner ? ['deterministic', 'directory', 'ner'] : ['deterministic', 'directory'],
      tokenized: stats.tokenized,
      masked: stats.masked,
      withholdUncheckedText: strict,
      withheld,
    };
    return { value: out, notice: describeResult(meta), meta: { [PII_META_KEY]: meta } };
  }

  async resolve(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { value } = resolvePseudonyms(args, await this.lexicons.forCurrentOrg());
    return isRecord(value) ? value : args;
  }

}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function describeResult(meta: PiiResultMeta): string {
  const pending = meta.withholdUncheckedText
    ? meta.withheld > 0
      ? ` The text of ${meta.withheld} message(s) is withheld until name detection has checked it; the rest has been checked.`
      : ''
    : meta.coverage === 'pending'
      ? ' Some messages here have not been through name detection yet, so a third party mentioned in their text may still appear by name; known contacts, emails, phone numbers and ID numbers are already replaced.'
      : '';
  return (
    `Personal data in this result is pseudonymized (coverage: ${meta.coverage}).` +
    ' [Contact …] tokens and contact-…@pseudonym.invalid addresses stand for one person each, consistently across results,' +
    ' and can be passed back as tool input, where the server swaps in the real value;' +
    ' [NAME], [EMAIL], [PHONE] and the other bracketed masks hide data that is not linked to a known contact.' +
    pending
  );
}

function rawOnlyRefusal(toolName: string): string {
  return (
    `${toolName} exports this org's records in bulk for moving them to another server, ` +
    'and is not available on a connection that pseudonymizes personal data: the export would carry ' +
    'placeholder tokens into whatever imports it. Migrations need a connection granted the pii:raw scope.'
  );
}
