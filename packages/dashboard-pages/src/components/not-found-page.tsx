import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import { Link } from '../i18n-navigation';
import { StandaloneNotice, noticeEmphasis } from './standalone-notice';

export function NotFoundPage({ logoSrc }: { logoSrc?: string }) {
  const t = useTranslations('notFound');

  return (
    <StandaloneNotice
      logoSrc={logoSrc}
      eyebrow={t('eyebrow')}
      title={t.rich('title', { em: noticeEmphasis })}
      lede={t('lede')}
      action={
        <Button size="lg" render={<Link href="/" />}>
          {t('home')}
        </Button>
      }
    />
  );
}
