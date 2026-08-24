'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';

export interface SelectableTool {
  name: string;
  description: string | null;
  destructive: boolean;
  allowed: boolean;
}

export function ChooseToolsDialog({
  connectionId,
  connectionName,
  onClose,
  onBack,
  onDone,
}: {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
  onBack?: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('integrations.tools');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [tools, setTools] = useState<SelectableTool[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { tools: list } = await api<{ tools: SelectableTool[] }>(
        `/v1/connectors/${connectionId}/mcp-tools`,
      );
      setTools(list);
      setSelected(new Set(list.filter((x) => x.allowed).map((x) => x.name)));
      setLoadError(null);
    } catch (err) {
      setLoadError(translate(err));
    }
  }, [connectionId, translate]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/v1/connectors/${connectionId}/mcp-tools`, {
        method: 'PUT',
        body: JSON.stringify({ toolNames: [...selected] }),
      });
      notify.success(t('saved', { count: selected.size }));
      await onDone();
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusy(false);
    }
  }

  const hasTools = tools !== null && tools.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[540px] gap-0 p-0">
        <DialogHeader className="space-y-2 border-b-[1px] border-rule-soft px-8 py-5 dark:border-rule-on-dark">
          <DialogTitle className="font-serif text-2xl leading-tight text-ink dark:text-foreground">
            {t('title', { name: connectionName })}
          </DialogTitle>
          <p className="text-[13px] leading-relaxed text-ink-mute">{t('intro')}</p>
        </DialogHeader>

        <div className="px-8 py-1">
          {loadError && (
            <p className="text-[13px] leading-relaxed text-destructive">{loadError}</p>
          )}

          {!loadError && tools === null && (
            <p className="text-[13px] text-ink-mute">{t('loading')}</p>
          )}

          {tools?.length === 0 && <p className="text-[13px] text-ink-mute">{t('empty')}</p>}

          {hasTools && (
            <div className="max-h-[22rem] overflow-y-auto">
              {tools.map((tool) => (
                <label
                  key={tool.name}
                  className="flex cursor-pointer items-start gap-3 border-b-[1px] border-rule-soft py-2.5 last:border-0 dark:border-rule-on-dark"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0"
                    checked={selected.has(tool.name)}
                    onChange={() => toggle(tool.name)}
                  />
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-mono text-[13px] text-ink dark:text-foreground">
                        {tool.name}
                      </span>
                      {tool.destructive && (
                        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-destructive">
                          {t('notReadOnly')}
                        </span>
                      )}
                    </span>
                    {tool.description && (
                      <span className="text-[13px] leading-snug text-ink-mute">
                        {tool.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t-[1px] border-rule-soft px-8 py-3.5 dark:border-rule-on-dark">
          <Button
            type="button"
            variant="outline"
            onClick={onBack ?? onClose}
            disabled={busy}
          >
            {onBack ? tCommon('back') : tCommon('cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy || tools === null}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
