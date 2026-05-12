'use client';

import { Link } from '../../i18n-navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn, Eyebrow } from '@getmunin/ui';
import { MCP_SETUPS, type McpSetup } from '../../data/mcp-setups';
import { RECIPES, type Recipe } from '../../data/recipes';
import { RecipeDrawer } from './recipe-drawer';

export function GetStarted() {
  const t = useTranslations('dashboard.getStarted');
  const [activeId, setActiveId] = useState<McpSetup['id']>('claude');
  const [openRecipe, setOpenRecipe] = useState<Recipe | null>(null);
  const [copied, setCopied] = useState(false);

  const setup = MCP_SETUPS.find((s) => s.id === activeId) ?? MCP_SETUPS[0]!;

  function copySnippet() {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(setup.snippet).catch(() => {});
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className="border-t-[0.5px] border-rule-soft pt-14 dark:border-rule-on-dark">
      <header className="mb-8 max-w-xl space-y-2">
        <Eyebrow tone="muted">{t('eyebrow')}</Eyebrow>
        <h2 className="font-serif text-3xl md:text-4xl leading-[1.0] font-normal tracking-tight text-ink dark:text-foreground">
          {t.rich('title', {
            em: (chunks) => (
              <em className="italic text-cobalt dark:text-cobalt-soft">{chunks}</em>
            ),
          })}
        </h2>
        <p className="text-sm text-ink-soft max-w-lg leading-[1.55] dark:text-foreground/80">
          {t('lede')}
        </p>
      </header>

      <div className="grid gap-9 md:grid-cols-[1.05fr_1fr] items-start">
        {/* MCP setup column */}
        <div>
          <div className="flex justify-between items-baseline border-b-[0.5px] border-ink pb-2.5 mb-4 dark:border-foreground">
            <Eyebrow tone="ink" size="sm" className="font-medium">
              {t('connectMcp')}
            </Eyebrow>
            <Eyebrow tone="muted" size="sm">
              {t('pickClient')}
            </Eyebrow>
          </div>

          <div className="flex border-[0.5px] border-ink mb-3.5 dark:border-foreground">
            {MCP_SETUPS.map((s) => {
              const active = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setActiveId(s.id);
                    setCopied(false);
                  }}
                  className={cn(
                    'flex-1 cursor-pointer px-3.5 py-2.5 flex flex-col items-start gap-0.5 border-r-[0.5px] border-rule-soft last:border-r-0 transition-colors duration-fast ease-munin',
                    active
                      ? 'bg-ink text-paper dark:bg-foreground dark:text-background'
                      : 'bg-paper hover:bg-paper-deep dark:bg-card dark:hover:bg-secondary',
                  )}
                >
                  <span className="text-[13px] font-medium">{s.label}</span>
                  <span
                    className={cn(
                      'font-mono text-[9px] uppercase tracking-eyebrow',
                      active ? 'text-paper/55' : 'text-ink-mute',
                    )}
                  >
                    {s.sublabel}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="bg-paper-deep border-[0.5px] border-ink dark:bg-card dark:border-rule-on-dark">
            <pre className="m-0 px-4 py-4 overflow-x-auto font-mono text-xs leading-[1.6] text-ink dark:text-foreground">
              <code>{setup.snippet}</code>
            </pre>
            <div className="flex justify-between items-center px-3.5 py-2 border-t-[0.5px] border-rule-soft bg-paper dark:bg-secondary dark:border-rule-on-dark">
              <a
                href={setup.docsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute hover:text-cobalt transition-colors duration-fast"
              >
                {setup.docsLabel} ↗
              </a>
              <button
                type="button"
                onClick={copySnippet}
                className="font-mono text-[10px] uppercase tracking-eyebrow bg-ink text-paper border-0 px-3 py-1.5 cursor-pointer hover:bg-black dark:bg-foreground dark:text-background"
              >
                {copied ? t('copied') : t('copy')}
              </button>
            </div>
          </div>

          <div className="mt-4 px-4 py-3.5 bg-paper-deep border-l-[0.5px] border-cobalt text-[13px] leading-[1.55] text-ink-soft dark:bg-secondary dark:text-foreground/80">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute mr-2">
              {t('then')}
            </span>
            {t.rich('apiKeyHint', {
              link: (chunks) => (
                <Link
                  href="/dashboard/settings/api-keys"
                  className="text-cobalt no-underline border-b-[0.5px] border-current dark:text-cobalt-soft"
                >
                  {chunks}
                </Link>
              ),
            })}
          </div>
        </div>

        {/* Recipes column */}
        <div>
          <div className="flex justify-between items-baseline border-b-[0.5px] border-ink pb-2.5 mb-4 dark:border-foreground">
            <Eyebrow tone="ink" size="sm" className="font-medium">
              {t('recipesEyebrow')}
            </Eyebrow>
            <Eyebrow tone="muted" size="sm">
              {t('recipesCount', { count: RECIPES.length })}
            </Eyebrow>
          </div>

          <ul className="list-none m-0 p-0 border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
            {RECIPES.map((r) => (
              <li
                key={r.id}
                tabIndex={0}
                role="button"
                onClick={() => setOpenRecipe(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenRecipe(r);
                  }
                }}
                className="grid grid-cols-[1fr_auto] gap-5 items-center px-1.5 py-3.5 border-b-[0.5px] border-rule-soft cursor-pointer transition-[padding,background] duration-fast ease-munin hover:bg-paper-deep hover:pl-3 focus:outline-none focus:bg-paper-deep dark:border-rule-on-dark dark:hover:bg-secondary dark:focus:bg-secondary"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink dark:text-foreground">{r.name}</div>
                  <div className="text-[13px] text-ink-soft mt-0.5 leading-[1.45] dark:text-foreground/75">
                    {r.summary}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 whitespace-nowrap">
                  <span className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
                    {r.cadence}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
                    {t('viewPrompt')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <RecipeDrawer recipe={openRecipe} onClose={() => setOpenRecipe(null)} />
    </section>
  );
}
