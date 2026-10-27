import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES, TEMPLATE_LOCALES, fillTemplate, missingParams } from './journey-templates.ts';
import { parseJourneySpec, validateJourneySpec } from './journey-validator.ts';

const refs = { segmentIds: new Set(['seg_1']), emailTemplateIds: new Set<string>(), webhookIds: new Set<string>() };

describe('built-in journey templates', () => {
  it('ships every template in nb, sv and en', () => {
    const slugs = new Set(BUILT_IN_TEMPLATES.map((t) => t.slug));
    for (const slug of slugs) {
      expect(BUILT_IN_TEMPLATES.filter((t) => t.slug === slug).map((t) => t.locale).sort()).toEqual(
        [...TEMPLATE_LOCALES].sort(),
      );
    }
  });

  it.each(BUILT_IN_TEMPLATES.map((t) => [`${t.slug}/${t.locale}`, t] as const))(
    '%s validates once its parameters are filled',
    (_name, template) => {
      const params = Object.fromEntries(template.params.map((p) => [p.key, 'seg_1']));
      const spec = fillTemplate(template.spec, params);
      expect(missingParams(spec)).toEqual([]);
      const parsed = parseJourneySpec(spec);
      expect(parsed.validation.errors).toEqual([]);
      expect(validateJourneySpec(parsed.spec!, refs).errors).toEqual([]);
    },
  );

  it('leaves merge fields alone when filling parameters', () => {
    const filled = fillTemplate({ a: 'Hei {{name}} {{param:x}}', b: ['{{param:y}}'] }, { x: '1' });
    expect(filled).toEqual({ a: 'Hei {{name}} 1', b: ['{{param:y}}'] });
    expect(missingParams(filled)).toEqual(['y']);
  });
});
