'use client';

import { useState } from 'react';
import {
  Button,
  Eyebrow,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@getmunin/ui';
import type { Recipe } from '../../data/recipes';

interface RecipeDrawerProps {
  recipe: Recipe | null;
  onClose: () => void;
}

export function RecipeDrawer({ recipe, onClose }: RecipeDrawerProps) {
  const [copied, setCopied] = useState(false);

  function copyPrompt() {
    if (!recipe) return;
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(recipe.prompt).catch(() => {});
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Sheet
      open={recipe !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full max-w-[640px]">
        {recipe && (
          <>
            <SheetHeader>
              <Eyebrow tone="muted" size="sm">
                Recipe · {recipe.cadence}
              </Eyebrow>
              <SheetTitle>{recipe.name}</SheetTitle>
              <SheetDescription>{recipe.summary}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
              <section>
                <Eyebrow tone="muted" size="sm" className="block mb-2.5">
                  Tools
                </Eyebrow>
                <ul className="list-none m-0 p-0 space-y-1">
                  {recipe.tools.map((t) => (
                    <li key={t} className="font-mono text-xs">
                      <code className="bg-paper-deep border-[0.5px] border-rule-soft px-2 py-1 inline-block dark:bg-secondary dark:border-rule-on-dark">
                        {t}
                      </code>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <Eyebrow tone="muted" size="sm" className="block mb-2.5">
                  System prompt · paste this verbatim
                </Eyebrow>
                <pre className="bg-paper-deep border-[0.5px] border-ink p-5 m-0 font-mono text-xs leading-[1.65] text-ink whitespace-pre-wrap break-words max-h-[480px] overflow-y-auto dark:bg-card dark:border-rule-on-dark dark:text-foreground">
                  <code>{recipe.prompt}</code>
                </pre>
              </section>
            </div>

            <footer className="px-6 py-3.5 border-t-[0.5px] border-ink flex gap-3 items-center bg-paper dark:bg-card dark:border-rule-on-dark">
              <Button onClick={copyPrompt}>{copied ? 'Copied ✓' : 'Copy prompt'}</Button>
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                After pasting, point the agent's MCP at <code className="text-cobalt">munin</code>
              </span>
            </footer>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
