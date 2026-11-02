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
import { ApiError } from '../../../api';
import { Link } from '../../../i18n-navigation';
import { useTranslateError } from '../../../i18n/translate-error';
import { currentReturnPath, platformName, startSocialConnect } from '../../../lib/social-connect';

export function SocialConnectDialog({
  platform,
  open,
  onClose,
}: {
  platform: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; appMissing: boolean } | null>(null);
  const name = platformName(platform);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
  }, [open]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await startSocialConnect(platform, currentReturnPath());
    } catch (err) {
      setError({
        message: translate(err),
        appMissing: err instanceof ApiError && err.code === 'social_app_missing',
      });
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('socialConnectTitle', { platform: name })}</DialogTitle>
          <DialogDescription>{t('socialConnectLede', { platform: name })}</DialogDescription>
        </DialogHeader>
        {error && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{error.message}</p>
            {error.appMissing && (
              <Link
                href="/dashboard/settings/integrations"
                className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-cobalt underline dark:text-cobalt-soft"
              >
                {t('socialConnectOpenIntegrations')}
              </Link>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={() => void connect()}
            disabled={busy || error?.appMissing === true}
          >
            {busy
              ? t('socialConnectRedirecting', { platform: name })
              : t('socialConnectAction', { platform: name })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
