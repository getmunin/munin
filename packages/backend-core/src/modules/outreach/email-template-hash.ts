import { createHash } from 'node:crypto';
import { emailTemplateMjml } from './email-template-source.ts';

export async function emailTemplateHash(templateId: string | null): Promise<string | null> {
  const mjml = await emailTemplateMjml(templateId);
  if (mjml === null) return null;
  return createHash('sha256').update(mjml, 'utf8').digest('hex').slice(0, 32);
}
