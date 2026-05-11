import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.terms');
  return { title: t('title'), description: t('description') };
}

export default function TermsPage() {
  const md = readFileSync(
    path.join(process.cwd(), 'public/legal/terms.md'),
    'utf-8',
  );
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article className="prose prose-neutral max-w-none dark:prose-invert">
        <ReactMarkdown>{md}</ReactMarkdown>
      </article>
    </main>
  );
}
