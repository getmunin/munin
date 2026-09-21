'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { PageSpinner } from '@getmunin/ui';
import { contactLabel } from './inbox-helpers';
import { Markdown } from './queue-panes/shared';
import { FieldViewer, isEmpty } from './queue-panes/cms';
import { socialMediaKind } from './queue-panes/social-actions';
import { humanizeFieldName } from './queue-panes/types';
import type {
  CmsDraftDetailDto,
  CrmContactSummary,
  CrmMergeProposalDto,
  FeedbackOutboxDto,
  OutreachProposalDto,
  SocialDraftDto,
} from './queue-panes/types';
import type {
  PublishedDocument,
  ReviewDecidedController,
  ReviewDecidedItem,
} from './review-decided';

export function DecidedSection({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
          {label}
        </span>
        {note ? (
          <span className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
            {note}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Unavailable({ children }: { children: string }) {
  return (
    <p className="max-w-[62ch] text-[14.5px] leading-relaxed text-ink-soft dark:text-foreground/70">
      {children}
    </p>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="border border-ink dark:border-rule-on-dark">{children}</div>;
}

function FrameBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 bg-bone px-5 py-5 text-[14.5px] leading-[1.7] text-ink dark:bg-secondary dark:text-foreground">
      {children}
    </div>
  );
}

function EnvelopeLabel({ children }: { children: string }) {
  return (
    <span className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
      {children}
    </span>
  );
}

export function ReviewDecidedContent({
  item,
  controller,
}: {
  item: ReviewDecidedItem;
  controller: ReviewDecidedController;
}) {
  switch (item.kind) {
    case 'kb':
      return (
        <KbContent
          documentId={item.producedRef?.type === 'kb_document' ? item.producedRef.id : null}
          doc={
            item.producedRef?.type === 'kb_document'
              ? controller.publishedDocs[item.producedRef.id]
              : undefined
          }
          failed={
            item.producedRef?.type === 'kb_document' &&
            item.producedRef.id in controller.publishedDocErrors
          }
          onLoad={controller.loadPublishedDoc}
        />
      );
    case 'cms':
      return (
        <CmsContent
          entryId={item.id}
          titleFieldName={item.raw.titleFieldName}
          entry={controller.cmsEntries[item.id]}
          failed={item.id in controller.cmsEntryErrors}
          onLoad={controller.loadCmsEntry}
        />
      );
    case 'social':
      return <SocialContent draft={item.raw} />;
    case 'outreach':
      return <OutreachContent proposal={item.raw} />;
    case 'feedback':
      return <FeedbackContent feedback={item.raw} />;
    case 'crm':
      return <CrmContent proposal={item.raw} merged={item.outcome === 'approved'} />;
  }
}

function KbContent({
  documentId,
  doc,
  failed,
  onLoad,
}: {
  documentId: string | null;
  doc: PublishedDocument | undefined;
  failed: boolean;
  onLoad: (id: string) => Promise<void>;
}) {
  const t = useTranslations('dashboard.console.review');

  useEffect(() => {
    if (!documentId || doc || failed) return;
    void onLoad(documentId);
  }, [documentId, doc, failed, onLoad]);

  if (!documentId) return null;
  if (failed) {
    return (
      <DecidedSection label={t('publishedBodyLabel')}>
        <Unavailable>{t('publishedBodyUnavailable')}</Unavailable>
      </DecidedSection>
    );
  }
  if (!doc) return <PageSpinner />;

  return (
    <DecidedSection label={t('publishedBodyLabel')}>
      <div className="max-w-[62ch] text-[15px] leading-[1.65] text-ink dark:text-foreground">
        <Markdown>{doc.body}</Markdown>
      </div>
    </DecidedSection>
  );
}

function CmsContent({
  entryId,
  titleFieldName,
  entry,
  failed,
  onLoad,
}: {
  entryId: string;
  titleFieldName: string | null;
  entry: CmsDraftDetailDto | undefined;
  failed: boolean;
  onLoad: (id: string) => Promise<void>;
}) {
  const t = useTranslations('dashboard.console.review.decidedContent');
  const tDrawer = useTranslations('dashboard.overview.drawer');

  useEffect(() => {
    if (entry || failed) return;
    void onLoad(entryId);
  }, [entryId, entry, failed, onLoad]);

  if (failed) {
    return (
      <DecidedSection label={t('cmsLabel')}>
        <Unavailable>{t('cmsUnavailable')}</Unavailable>
      </DecidedSection>
    );
  }
  if (!entry) return <PageSpinner />;

  const shown = entry.fields.filter(
    (field) => field.name !== titleFieldName && !isEmpty(entry.data[field.name]),
  );

  return (
    <DecidedSection
      label={t('cmsLabel')}
      note={t('cmsMeta', { collection: entry.collectionSlug, locale: entry.locale })}
    >
      <div className="flex flex-col gap-4">
        {shown.map((field) => (
          <div key={field.name} className="flex flex-col gap-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-mute">
              {humanizeFieldName(field.name)}
            </span>
            <FieldViewer
              field={field}
              value={entry.data[field.name]}
              aspectLabel={tDrawer('cmsCoverAspect')}
              refs={entry.refs}
              entryLocale={entry.locale}
            />
          </div>
        ))}
      </div>
    </DecidedSection>
  );
}

function SocialContent({ draft }: { draft: SocialDraftDto }) {
  const t = useTranslations('dashboard.console.review.decidedContent');
  const shareUrl = draft.shareUrl ?? draft.linkUrl;
  const linkInComment = draft.linkPlacement === 'comment';
  const mediaKind = socialMediaKind(draft);

  return (
    <>
      <DecidedSection
        label={t('socialLabel')}
        note={t('socialMeta', { platform: draft.platform, chars: draft.bodyChars })}
      >
        <Frame>
          <FrameBody>
            <p className="whitespace-pre-wrap">{draft.body}</p>
            {draft.mediaUrl ? (
              <figure className="flex flex-col gap-1.5">
                {mediaKind === 'video' ? (
                  <video controls preload="metadata" className="max-h-80 w-full" src={draft.mediaUrl}>
                    {t('socialVideoUnsupported')}
                  </video>
                ) : (
                  <img
                    src={draft.mediaUrl}
                    alt={draft.mediaAltText ?? ''}
                    className="max-h-80 w-full object-contain"
                  />
                )}
                {draft.mediaAltText ? (
                  <figcaption className="text-[12.5px] text-ink-mute">
                    {draft.mediaAltText}
                  </figcaption>
                ) : null}
              </figure>
            ) : null}
          </FrameBody>
        </Frame>
      </DecidedSection>

      {shareUrl ? (
        <DecidedSection label={t('socialLinkLabel')}>
          <p className="break-all font-mono text-[12.5px] text-ink-soft dark:text-foreground/70">
            {shareUrl}
          </p>
          {linkInComment ? (
            <p className="text-[13px] text-ink-mute">{t('socialLinkInComment')}</p>
          ) : null}
        </DecidedSection>
      ) : null}

      {linkInComment && draft.linkCommentText ? (
        <DecidedSection label={t('socialLinkCommentLabel')}>
          <Frame>
            <FrameBody>
              <p className="whitespace-pre-wrap">{draft.linkCommentText}</p>
            </FrameBody>
          </Frame>
        </DecidedSection>
      ) : null}

      {draft.permalink ? (
        <a
          href={draft.permalink}
          target="_blank"
          rel="noreferrer noopener"
          className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-cobalt underline underline-offset-[3px] dark:text-cobalt-soft"
        >
          {t('socialPermalink', { platform: draft.platform })} <span aria-hidden>→</span>
        </a>
      ) : null}
    </>
  );
}

function OutreachContent({ proposal }: { proposal: OutreachProposalDto }) {
  const t = useTranslations('dashboard.console.review.decidedContent');
  const tOutreach = useTranslations('dashboard.console.review.outreach');
  const channelType = proposal.delivery?.channelType ?? 'email';
  const sender =
    [proposal.delivery?.senderName, proposal.delivery?.sender].filter(Boolean).join(' · ') ||
    tOutreach('senderUnknown');
  const recipient =
    [proposal.contact?.name, proposal.delivery?.destination ?? proposal.contact?.email]
      .filter(Boolean)
      .join(' · ') || tOutreach('contactUnknown');

  return (
    <DecidedSection
      label={t('outreachLabel')}
      note={proposal.campaign?.name ?? tOutreach('campaignUnknown')}
    >
      <Frame>
        <div className="grid grid-cols-[54px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-rule-soft bg-paper-deep px-4 py-3 dark:border-rule-on-dark dark:bg-secondary">
          <EnvelopeLabel>
            {channelType === 'voice'
              ? tOutreach('callsFrom')
              : channelType === 'sms'
                ? tOutreach('textsFrom')
                : tOutreach('from')}
          </EnvelopeLabel>
          <span className="text-[12.5px] text-ink dark:text-foreground">{sender}</span>
          <EnvelopeLabel>{tOutreach('to')}</EnvelopeLabel>
          <span className="text-[12.5px] text-ink dark:text-foreground">{recipient}</span>
          {proposal.draftSubject ? (
            <>
              <EnvelopeLabel>{tOutreach('subject')}</EnvelopeLabel>
              <span className="text-[12.5px] font-medium text-ink dark:text-foreground">
                {proposal.draftSubject}
              </span>
            </>
          ) : null}
        </div>
        <FrameBody>
          <Markdown>{proposal.draftBody}</Markdown>
        </FrameBody>
      </Frame>
    </DecidedSection>
  );
}

function FeedbackContent({ feedback }: { feedback: FeedbackOutboxDto }) {
  const t = useTranslations('dashboard.console.review.decidedContent');

  return (
    <DecidedSection
      label={t('feedbackLabel')}
      note={feedback.appScope ? feedback.appScope.toUpperCase() : undefined}
    >
      <Frame>
        <FrameBody>
          <p className="whitespace-pre-wrap">{feedback.body}</p>
        </FrameBody>
      </Frame>
    </DecidedSection>
  );
}

function CrmContent({
  proposal,
  merged,
}: {
  proposal: CrmMergeProposalDto;
  merged: boolean;
}) {
  const t = useTranslations('dashboard.console.review.decidedContent');
  const keeper =
    proposal.recommendedKeeperId === proposal.contactB.id ? proposal.contactB : proposal.contactA;
  const other = keeper === proposal.contactA ? proposal.contactB : proposal.contactA;

  return (
    <DecidedSection label={t('crmLabel')}>
      <div className="grid gap-3 md:grid-cols-2">
        <ContactCard label={merged ? t('crmKept') : t('crmProposedKeeper')} contact={keeper} />
        <ContactCard
          label={merged ? t('crmArchived') : t('crmProposedDuplicate')}
          contact={other}
        />
      </div>
    </DecidedSection>
  );
}

function ContactCard({ label, contact }: { label: string; contact: CrmContactSummary }) {
  const lines = [contact.email, contact.phone, contact.companyName].filter(
    (line): line is string => typeof line === 'string' && line.length > 0,
  );

  return (
    <div className="flex flex-col gap-1.5 border border-rule-soft px-4 py-3 dark:border-rule-on-dark">
      <span className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
        {label}
      </span>
      <span className="text-[14px] font-medium text-ink dark:text-foreground">
        {contactLabel(contact)}
      </span>
      {lines.map((line) => (
        <span key={line} className="break-all text-[12.5px] text-ink-soft dark:text-foreground/70">
          {line}
        </span>
      ))}
    </div>
  );
}
