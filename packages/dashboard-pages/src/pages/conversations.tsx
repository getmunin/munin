'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../api';
import { authClient } from '../auth-client';
import { isOwnerOrAdmin, useActiveRole } from '../auth/use-active-role';
import { ConversationRow } from '../components/dashboard/conversation-row';
import {
  buildQueueSections,
  firstRowId,
  type ConversationListItem,
} from '../components/dashboard/conversation-queue';
import { ConversationDetailView } from '../components/dashboard/inbox-conv-drawers';
import { useInboxData } from '../components/dashboard/inbox-data';
import { EmptyCallout } from '../components/empty-callout';
import { LoadFailed } from '../components/load-failed';
import { nativeFieldClass } from '../components/page-shell';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { useRealtime } from '../realtime';
import { useRouter } from '../i18n-navigation';

const PAGE_LIMIT = 50;

interface ConversationListResponse {
  items: ConversationListItem[];
  nextCursor: string | null;
}

interface MemberDto {
  userId: string;
  name: string | null;
  email: string;
}

export function ConversationsPage() {
  const t = useTranslations('dashboard.conversations');
  const inbox = useInboxData();
  const router = useRouter();
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const { data: session } = authClient.useSession();
  const { role } = useActiveRole();

  const [list, setList] = useState<ConversationListItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const loadList = useCallback(async () => {
    try {
      const page = await api<ConversationListResponse>(
        `/v1/conversations?status=open&limit=${PAGE_LIMIT}`,
      );
      setList(page.items);
    } catch (err) {
      console.warn('[conversations] list fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!isOwnerOrAdmin(role)) return;
    void api<MemberDto[]>('/v1/orgs/me/members')
      .then((members) => {
        setNames(
          Object.fromEntries(members.map((m) => [m.userId, m.name?.trim() || m.email])),
        );
      })
      .catch(() => setNames({}));
  }, [role]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (event.type.startsWith('conversation.')) void loadList();
  });

  const sections = useMemo(
    () => buildQueueSections({ live: inbox.items, list, query }),
    [inbox.items, list, query],
  );

  const fallbackId = firstRowId(sections);
  const paneId = selectedId ?? fallbackId;
  const { reloadDetail } = inbox;

  useEffect(() => {
    if (paneId) void reloadDetail(paneId);
  }, [paneId, reloadDetail]);

  const detail = paneId ? inbox.details[paneId] : undefined;
  const viewerUserId = session?.user.id ?? null;
  const viewerName = session?.user.name || session?.user.email || null;

  if (inbox.loadError && !inbox.hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(inbox.loadError, () => void inbox.retryLoad(), inbox.retrying)}
        />
      </div>
    );
  }

  const listColumn = (
    <div className="flex min-h-0 min-w-0 flex-col lg:border-r-[1px] lg:border-rule-soft dark:lg:border-rule-on-dark">
      <div className="shrink-0 px-4 pt-8 md:px-8">
        <p className="font-mono text-[9px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 font-serif text-[34px] font-normal leading-[1.02] tracking-tight text-ink lg:text-[40px] dark:text-foreground">
          {t.rich('title', { em: (chunks) => <em className="italic text-cobalt">{chunks}</em> })}
        </h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className={`${nativeFieldClass} mt-5 min-h-11`}
        />
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-8 md:px-8">
        {sections.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          sections.map((section) => (
            <section key={section.key}>
              <div className="flex items-baseline justify-between gap-4 border-b-[1px] border-ink pb-2 pt-5 dark:border-rule-on-dark">
                <h2 className="font-mono text-[9px] uppercase tracking-eyebrow text-ink dark:text-foreground">
                  {t(`sections.${section.key}`)} · {section.rows.length}
                </h2>
              </div>
              <ul>
                {section.rows.map((row) => (
                  <ConversationRow
                    key={row.id}
                    row={row}
                    active={row.id === paneId}
                    viewerUserId={viewerUserId}
                    viewerName={viewerName}
                    assigneeName={row.assigneeUserId ? names[row.assigneeUserId] : null}
                    onOpen={() => {
                      if (window.matchMedia('(min-width: 1024px)').matches) setSelectedId(row.id);
                      else router.push(`/dashboard/conversations/${row.id}`);
                    }}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="grid min-h-[calc(100vh_-_3.5rem)] grid-cols-1 md:min-h-screen lg:grid-cols-[1.05fr_1.4fr]">
      {listColumn}
      <div className="hidden min-h-0 min-w-0 flex-col bg-paper-deep lg:flex dark:bg-secondary">
        {detail ? (
          <ConversationDetailView
            variant="pane"
            detail={detail}
            reply={inbox.reply}
            setReply={inbox.setReply}
            pending={inbox.pending}
            actionError={
              inbox.actionError?.conversationId === detail.id ? inbox.actionError : null
            }
            onSend={(body, fromDraftId) =>
              void inbox.send(detail.id, body, { fromDraftId, claim: true })
            }
            onTakeOver={() => void inbox.takeOver(detail.id)}
            onRelease={() => void inbox.release(detail.id)}
            onCloseConv={() => void inbox.closeConv(detail.id)}
            onClose={() => setSelectedId(null)}
            onClearActionError={inbox.clearActionError}
          />
        ) : (
          <p className="px-8 py-16 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('paneEmpty')}
          </p>
        )}
      </div>
    </div>
  );
}
