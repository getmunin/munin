import { Injectable } from '@nestjs/common';
import {
  emptyPiiStats,
  pseudonymizeText,
  pseudonymizeValue,
  type ActorIdentity,
  type Audience,
  type PiiStats,
} from '@getmunin/core';
import type { FilteredToolResult, ToolDataFilter } from '@getmunin/mcp-toolkit';
import { PiiAnnotationsService } from './pii-annotations.service.ts';
import { PiiLexiconService } from './pii-lexicon.service.ts';
import { isPiiNerEnabled } from './pii-config.ts';
import { decidePiiMode } from './pii-policy.ts';

export type PiiCoverage = 'complete' | 'pending';

export type PiiLayer = 'deterministic' | 'directory' | 'ner';

export interface PiiResultMeta {
  mode: 'pseudonymized';
  coverage: PiiCoverage;
  layers: PiiLayer[];
  tokenized: number;
  masked: PiiStats['masked'];
}

export const PII_META_KEY = 'munin/pii';

const MESSAGE_ID = /^cvm_[0-9a-z]{22}$/;

@Injectable()
export class PiiResultFilterService {
  constructor(
    private readonly lexicons: PiiLexiconService,
    private readonly annotations: PiiAnnotationsService,
  ) {}

  filterFor(actor: ActorIdentity, audience: Audience): Promise<ToolDataFilter | undefined> {
    if (decidePiiMode(actor, audience).mode === 'raw') return Promise.resolve(undefined);
    return Promise.resolve(this.pseudonymizingFilter());
  }

  pseudonymizingFilter(): ToolDataFilter {
    return {
      refuse: (tool) => (tool.rawDataOnly ? rawOnlyRefusal(tool.name) : null),
      output: (_tool, value) => this.pseudonymize(value),
      error: async (message) => pseudonymizeText(message, await this.lexicons.forCurrentOrg()),
    };
  }

  async pseudonymize(value: unknown): Promise<FilteredToolResult> {
    const lexicon = await this.lexicons.forCurrentOrg();
    const stats = emptyPiiStats();
    const out = pseudonymizeValue(value, lexicon, stats);
    const ner = isPiiNerEnabled();
    const coverage = ner ? await this.coverageOf(value) : 'complete';
    const meta: PiiResultMeta = {
      mode: 'pseudonymized',
      coverage,
      layers: ner ? ['deterministic', 'directory', 'ner'] : ['deterministic', 'directory'],
      tokenized: stats.tokenized,
      masked: stats.masked,
    };
    return { value: out, notice: describeResult(meta), meta: { [PII_META_KEY]: meta } };
  }

  private async coverageOf(value: unknown): Promise<PiiCoverage> {
    const ids = collectMessageIds(value);
    if (ids.length === 0) return 'complete';
    const { total, annotated } = await this.annotations.coverage(ids);
    return annotated >= total ? 'complete' : 'pending';
  }
}

export function collectMessageIds(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (MESSAGE_ID.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectMessageIds(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectMessageIds(item, out);
  }
  return out;
}

export function describeResult(meta: PiiResultMeta): string {
  const pending =
    meta.coverage === 'pending'
      ? ' Some messages here have not been through name detection yet, so a third party mentioned in their text may still appear by name; known contacts, emails, phone numbers and ID numbers are already replaced.'
      : '';
  return (
    `Personal data in this result is pseudonymized (coverage: ${meta.coverage}).` +
    ' [Contact …] tokens and contact-…@pseudonym.invalid addresses stand for one person each, consistently across results;' +
    ' [NAME], [EMAIL], [PHONE] and the other bracketed masks hide data that is not linked to a known contact.' +
    pending
  );
}

function rawOnlyRefusal(toolName: string): string {
  return (
    `${toolName} exports this org's records in bulk for moving them to another server, ` +
    'and is not available on a connection that pseudonymizes personal data: the export would carry ' +
    'placeholder tokens into whatever imports it. Use a connection with raw access for migrations.'
  );
}
