'use client';

import { useState } from 'react';
import { ImageOff, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import type { MessageAttachment } from './inbox-types';

export function MessageAttachments({
  attachments,
  onDelete,
}: {
  attachments: MessageAttachment[];
  onDelete?: (attachment: MessageAttachment) => void;
}) {
  const t = useTranslations('dashboard.overview.drawer.attachments');
  const [lightbox, setLightbox] = useState<MessageAttachment | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <div className="mt-1 flex flex-wrap gap-2">
        {attachments.map((a) =>
          a.deleted || !a.url ? (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-ink-mute"
            >
              <ImageOff aria-hidden className="size-3.5 shrink-0" />
              <span className="max-w-[14rem] truncate">{t('removed', { name: a.name })}</span>
            </div>
          ) : (
            <div key={a.id} className="group relative">
              <button
                type="button"
                onClick={() => setLightbox(a)}
                className="block overflow-hidden rounded-lg border border-line focus-visible:outline focus-visible:outline-2"
                aria-label={t('open', { name: a.name })}
              >
                <img
                  src={a.thumbnailUrl ?? a.url}
                  alt={a.name}
                  loading="lazy"
                  className="max-h-40 max-w-[14rem] object-cover"
                />
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(a)}
                  aria-label={t('delete', { name: a.name })}
                  className={cn(
                    'absolute right-1 top-1 rounded-md bg-paper/90 px-1.5 py-0.5 text-[11px] text-ink-mute shadow-sm',
                    'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
                  )}
                >
                  <X aria-hidden className="size-3" />
                </button>
              )}
            </div>
          ),
        )}
      </div>
      {lightbox?.url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.name}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        >
          <img
            src={lightbox.url}
            alt={lightbox.name}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </>
  );
}
