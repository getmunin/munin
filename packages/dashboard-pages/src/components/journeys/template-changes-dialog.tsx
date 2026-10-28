'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import { notify } from '../../lib/notify';
import type { TemplateChangesDto } from './journey-types';

interface PreviewNode {
  nodeId: string;
  subject: string | null;
  body: string;
  format: 'markdown' | 'mjml';
}

export function TemplateChangesDialog({
  journeyId,
  changes,
  nodes,
  open,
  onClose,
  onApproved,
}: {
  journeyId: string;
  changes: TemplateChangesDto;
  nodes: PreviewNode[];
  open: boolean;
  onClose: () => void;
  onApproved: () => void;
}) {
  const t = useTranslations('dashboard.journeys.templateChanges');
  const translate = useTranslateError();
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreviews({});
    for (const change of changes.changes) {
      if (change.deleted) continue;
      const node = nodes.find((n) => n.nodeId === change.nodeId);
      void api<{ html: string }>('/v1/outreach/email-templates/preview', {
        method: 'POST',
        body: JSON.stringify({
          ...(change.templateId ? { templateId: change.templateId } : {}),
          content: { format: node?.format ?? 'markdown', body: node?.body || '…' },
          subject: node?.subject ?? null,
        }),
      })
        .then((r) => r.html)
        .catch(() => '')
        .then((html) => {
          if (!cancelled) setPreviews((p) => ({ ...p, [`${change.version}:${change.nodeId}`]: html }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open, changes, nodes]);

  const blocked = changes.changes.some((c) => c.deleted);

  async function approve() {
    if (!changes.fingerprint) return;
    setPending(true);
    try {
      const result = await api<TemplateChangesDto>(`/v1/journeys/${journeyId}/template-changes/reapprove`, {
        method: 'POST',
        body: JSON.stringify({ fingerprint: changes.fingerprint }),
      });
      notify.success(t('approved', { count: result.released ?? 0 }));
      onApproved();
    } catch (err) {
      notify.error(translate(err) || t('approveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { count: changes.heldMessages })}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 max-h-[60vh] space-y-5 overflow-y-auto pr-1 text-sm">
          {changes.changes.map((change) => {
            const html = previews[`${change.version}:${change.nodeId}`];
            return (
              <section key={`${change.version}:${change.nodeId}`}>
                <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">
                  {t('step', {
                    node: change.nodeId,
                    version: change.version,
                    template: change.templateName ?? (change.templateId ? change.templateId : t('builtIn')),
                  })}
                </h3>
                {change.deleted ? (
                  <p className="mt-1 text-destructive">{t('deleted')}</p>
                ) : html === '' ? (
                  <p className="mt-1 font-mono text-xs text-ink-mute">{t('noPreview')}</p>
                ) : html ? (
                  <iframe
                    title={t('previewFrame', { node: change.nodeId })}
                    sandbox=""
                    srcDoc={html}
                    className="mt-2 h-72 w-full rounded-card border-[1px] border-rule-soft bg-white dark:border-rule-on-dark"
                  />
                ) : (
                  <p className="mt-1 font-mono text-xs text-ink-mute">{t('loadingPreview')}</p>
                )}
              </section>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="accent" pending={pending} disabled={blocked || !changes.fingerprint} onClick={() => void approve()}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
