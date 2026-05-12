'use client';

import type { ReactNode } from 'react';

export interface EmptyCalloutProps {
  title: string;
  body: ReactNode;
}

export function EmptyCallout({ title, body }: EmptyCalloutProps) {
  return (
    <div className="border-[0.5px] border-rule-soft dark:border-rule-on-dark py-12 px-6 text-center space-y-2">
      <h3 className="font-serif text-xl text-ink dark:text-foreground">{title}</h3>
      <p className="text-sm text-ink-soft dark:text-foreground/70 max-w-md mx-auto">{body}</p>
    </div>
  );
}
