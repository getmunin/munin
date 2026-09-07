'use client';

import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Sheet, SheetContent, SheetTitle } from '@getmunin/ui';

export interface PaneAction {
  label: string;
  disabled?: boolean;
  run: () => void;
}

export function MoreActionsTrigger({
  disabled,
  onOpen,
}: {
  disabled?: boolean;
  onOpen: () => void;
}) {
  const tCommon = useTranslations('common');
  return (
    <Button
      variant="outline"
      onClick={onOpen}
      disabled={disabled}
      aria-label={tCommon('moreActions')}
      className="h-11 w-12 shrink-0 md:hidden"
    >
      <MoreHorizontal className="size-4" />
    </Button>
  );
}

export function MoreActionsSheet({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  actions: PaneAction[];
}) {
  const tCommon = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="md:hidden">
        <SheetTitle className="px-5 pb-2 pt-5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
          {tCommon('moreActions')}
        </SheetTitle>
        <div className="flex flex-col pb-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={() => {
                onOpenChange(false);
                action.run();
              }}
              className="border-t-[1px] border-rule-soft px-5 py-4 text-left text-[15px] text-ink disabled:opacity-50 dark:border-rule-on-dark dark:text-foreground"
            >
              {action.label}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
