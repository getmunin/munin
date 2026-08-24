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
  onDone,
}: {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: connectionName })}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{t('intro')}</p>

        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        {!loadError && !tools && <p className="text-sm text-muted-foreground">{t('loading')}</p>}

        {tools?.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}

        {tools && tools.length > 0 && (
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {tools.map((tool) => (
              <label key={tool.name} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(tool.name)}
                  onChange={() => toggle(tool.name)}
                />
                <span className="flex-1">
                  <span className="font-medium">{tool.name}</span>
                  {tool.destructive && (
                    <span className="ml-2 text-xs text-destructive">{t('notReadOnly')}</span>
                  )}
                  {tool.description && (
                    <span className="block text-xs text-muted-foreground">{tool.description}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}

        {tools && tools.length > 0 && selected.size === 0 && (
          <p className="text-xs text-muted-foreground">{t('noneSelected')}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy || !tools}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
