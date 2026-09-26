'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import { dialogButtonClass, dialogFooterClass, dialogLabelClass } from '../../lib/dialog-style';
import { FormField } from '../form-field';
import { NativeSelect } from '../native-select';
import type { WhatsAppWindowDto } from './inbox-types';
import {
  EMPTY_TEMPLATE_VALUES,
  missingTemplateFields,
  renderTemplatePreview,
  splitRemaining,
  templateFields,
  templateKey,
  templateSendBody,
  whatsappWindowState,
  type TemplateValues,
  type WhatsAppTemplateOption,
  type WhatsAppWindowState,
} from './whatsapp';

const WINDOW_TICK_MS = 30_000;

export function useWhatsAppWindowState(
  windowDto: WhatsAppWindowDto | null | undefined,
): WhatsAppWindowState | null {
  const [now, setNow] = useState(() => Date.now());
  const ticking = !!windowDto?.open && !!windowDto.closesAt;
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), WINDOW_TICK_MS);
    return () => clearInterval(timer);
  }, [ticking, windowDto?.closesAt]);
  return whatsappWindowState(windowDto, now);
}

export function WhatsAppWindowNotice({
  state,
  customer,
}: {
  state: WhatsAppWindowState;
  customer: string;
}) {
  const t = useTranslations('dashboard.console.queue.whatsapp');
  const remaining = state.remainingMs !== null ? splitRemaining(state.remainingMs) : null;
  return (
    <p
      role="status"
      className={cn(
        'shrink-0 border-l-2 px-3 py-1.5 text-[12.5px] leading-snug',
        state.open
          ? 'border-verdigris text-ink-soft dark:border-verdigris-soft dark:text-foreground/80'
          : 'border-amber-500 bg-amber-50 text-ink dark:bg-amber-500/10 dark:text-foreground',
      )}
    >
      {state.open
        ? remaining
          ? t('windowOpen', remaining)
          : t('windowOpenUnknown')
        : t('windowClosed', { name: customer })}
    </p>
  );
}

interface TemplatesResponse {
  channelId: string;
  templates: WhatsAppTemplateOption[];
}

export function WhatsAppTemplateDialog({
  open,
  conversationId,
  customer,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  conversationId: string;
  customer: string;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const t = useTranslations('dashboard.console.queue.whatsapp');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [templates, setTemplates] = useState<WhatsAppTemplateOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [values, setValues] = useState<TemplateValues>(EMPTY_TEMPLATE_VALUES);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setTemplates(null);
    setLoadError(null);
    setSendError(null);
    setShowMissing(false);
    setValues(EMPTY_TEMPLATE_VALUES);
    void api<TemplatesResponse>(`/v1/conversations/${conversationId}/whatsapp-templates`)
      .then((res) => {
        if (!active) return;
        setTemplates(res.templates);
        setSelectedKey(res.templates[0] ? templateKey(res.templates[0]) : '');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(translate(err) || t('templatesLoadFailed'));
      });
    return () => {
      active = false;
    };
  }, [open, conversationId, translate, t]);

  const selected = useMemo(
    () => templates?.find((tpl) => templateKey(tpl) === selectedKey) ?? null,
    [templates, selectedKey],
  );
  const fields = selected ? templateFields(selected) : [];
  const missing = selected ? missingTemplateFields(selected, values) : [];
  const preview = selected ? renderTemplatePreview(selected, values) : null;

  async function submit() {
    if (!selected || sending) return;
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await api(`/v1/conversations/${conversationId}/whatsapp-template`, {
        method: 'POST',
        body: JSON.stringify(templateSendBody(selected, values)),
      });
      onSent();
      onOpenChange(false);
    } catch (err) {
      setSendError(translate(err) || t('templateSendFailed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('templateTitle')}</DialogTitle>
          <DialogDescription>{t('templateDescription', { name: customer })}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="-mx-1 mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
            {loadError ? (
              <p className="text-sm text-destructive" role="alert">
                {loadError}
              </p>
            ) : templates === null ? (
              <p className="text-sm text-ink-mute">{tCommon('loading')}</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-ink-mute">{t('templatesEmpty')}</p>
            ) : (
              <>
                <FormField label={t('templateLabel')} hint={t('templateHint')}>
                  <NativeSelect
                    value={selectedKey}
                    onChange={(e) => {
                      setSelectedKey(e.target.value);
                      setValues(EMPTY_TEMPLATE_VALUES);
                      setShowMissing(false);
                      setSendError(null);
                    }}
                  >
                    {templates.map((tpl) => (
                      <option key={templateKey(tpl)} value={templateKey(tpl)}>
                        {`${tpl.name} · ${tpl.language} · ${tpl.category.toLowerCase()}`}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                {fields.map((field) => {
                  const isMissing =
                    showMissing &&
                    missing.some((m) => m.scope === field.scope && m.name === field.name);
                  return (
                    <FormField
                      key={`${field.scope}:${field.name}`}
                      label={t(field.scope === 'header' ? 'headerVariable' : 'bodyVariable', {
                        name: field.name,
                      })}
                      error={isMissing ? t('variableRequired') : undefined}
                    >
                      <Input
                        value={values[field.scope][field.name] ?? ''}
                        maxLength={1024}
                        placeholder={`{{${field.name}}}`}
                        onChange={(e) => {
                          const next = e.target.value;
                          setValues((prev) => ({
                            ...prev,
                            [field.scope]: { ...prev[field.scope], [field.name]: next },
                          }));
                        }}
                      />
                    </FormField>
                  );
                })}
                {preview ? (
                  <div className="space-y-2">
                    <span className={dialogLabelClass}>{t('previewLabel')}</span>
                    <div className="rounded-bubble rounded-br-[4px] border border-ink bg-ink px-[13px] py-2.5 text-[13.5px] leading-[1.45] text-paper dark:border-paper dark:bg-paper dark:text-ink">
                      {preview.header ? (
                        <p className="mb-1.5 font-semibold [overflow-wrap:anywhere]">
                          {preview.header}
                        </p>
                      ) : null}
                      {preview.body ? (
                        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {preview.body}
                        </p>
                      ) : null}
                      {preview.footer ? (
                        <p className="mt-1.5 text-[11.5px] opacity-70 [overflow-wrap:anywhere]">
                          {preview.footer}
                        </p>
                      ) : null}
                    </div>
                    {preview.buttons.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {preview.buttons.map((label, i) => (
                          <span
                            key={`${i}-${label}`}
                            className="rounded-full border border-rule-soft px-2.5 py-0.5 text-[12px] text-ink-soft dark:border-rule-on-dark dark:text-foreground/80"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
            {sendError ? (
              <p className="text-sm text-destructive" role="alert">
                {sendError}
              </p>
            ) : null}
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button
              type="button"
              variant="outline"
              className={dialogButtonClass}
              onClick={() => onOpenChange(false)}
              disabled={sending}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              className={dialogButtonClass}
              disabled={sending || !selected}
              pending={sending}
            >
              {sending ? t('templateSending') : t('templateSubmit')}
              <span aria-hidden className="ml-1 font-mono">↵</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
