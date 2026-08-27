'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button, PageSpinner } from '@getmunin/ui';
import { ConversationDetailView } from '../components/dashboard/inbox-conv-drawers';
import { useInboxData } from '../components/dashboard/inbox-data';
import { EmptyCallout } from '../components/empty-callout';
import { useRouter } from '../i18n-navigation';

export interface ConversationDetailPageProps {
  conversationId: string;
}

export function ConversationDetailPage({ conversationId }: ConversationDetailPageProps) {
  const t = useTranslations('dashboard.conversations');
  const tCommon = useTranslations('common');
  const inbox = useInboxData();
  const router = useRouter();
  const { reloadDetail } = inbox;

  useEffect(() => {
    void reloadDetail(conversationId);
  }, [conversationId, reloadDetail]);

  const detail = inbox.details[conversationId];
  const detailError = inbox.detailErrors[conversationId];
  const back = () => router.push('/dashboard/conversations');

  if (detailError && !detail) {
    return (
      <div className="px-4 py-12">
        <EmptyCallout title={t('detailFailedTitle')} body={detailError} />
        <div className="mt-4 flex justify-center gap-2">
          <Button size="sm" variant="accent" onClick={() => void reloadDetail(conversationId)}>
            {tCommon('retry')}
          </Button>
          <Button size="sm" variant="outline" onClick={back}>
            {t('backToQueue')}
          </Button>
        </div>
      </div>
    );
  }

  if (!detail) return <PageSpinner className="min-h-[70vh]" />;

  return (
    <div className="flex min-h-[calc(100vh_-_3.5rem)] flex-col md:min-h-screen">
      <ConversationDetailView
        variant="page"
        backLabel={t('backToQueue')}
        detail={detail}
        reply={inbox.reply}
        setReply={inbox.setReply}
        pending={inbox.pending}
        actionError={inbox.actionError?.conversationId === detail.id ? inbox.actionError : null}
        onSend={(body, fromDraftId) =>
          void inbox.send(detail.id, body, { fromDraftId, claim: true })
        }
        onTakeOver={() => void inbox.takeOver(detail.id)}
        onRelease={() => void inbox.release(detail.id)}
        onCloseConv={() => {
          void inbox.closeConv(detail.id).then(back);
        }}
        onClose={back}
        onClearActionError={inbox.clearActionError}
      />
    </div>
  );
}
