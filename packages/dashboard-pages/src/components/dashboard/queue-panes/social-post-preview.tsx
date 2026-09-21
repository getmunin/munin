'use client';

import { useEffect, useState } from 'react';
import {
  Globe,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { initialsOf } from '../../../lib/initials';
import { socialMediaKind } from './social-actions';
import {
  composePreviewBody,
  composePreviewComment,
  foldPreviewBody,
  linkHost,
  previewLink,
  splitUrls,
} from './social-preview';
import type { SocialDraftDto } from './types';

export function SocialPostPreview({
  draft,
  authorName,
  authorKind,
}: {
  draft: SocialDraftDto;
  authorName: string | null;
  authorKind: 'member' | 'org_page' | null;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => setExpanded(false), [draft.id]);

  const facebook = draft.platform === 'facebook';
  const body = composePreviewBody(draft);
  const fold = foldPreviewBody(draft.platform, body);
  const comment = composePreviewComment(draft);
  const link = previewLink(draft);
  const host = link ? linkHost(link) : null;
  const showCard = !draft.mediaUrl && draft.linkPlacement !== 'comment' && host !== null;
  const name = authorName?.trim() || t('socialPreviewAuthorUnknown');
  const post = {
    draft,
    name,
    authorKind,
    body,
    fold,
    comment,
    expanded,
    onExpand: () => setExpanded(true),
    host: showCard ? host : null,
  };

  return (
    <section className="space-y-2">
      <div className="munin-light-locked px-0 py-0">
        {facebook ? <FacebookPost {...post} /> : <LinkedInPost {...post} />}
      </div>

      {draft.mediaUrl && link && draft.linkPlacement !== 'comment' ? (
        <p className="text-xs text-ink-mute">{t('socialPreviewNoteMedia')}</p>
      ) : showCard ? (
        <p className="text-xs text-ink-mute">{t('socialPreviewNoteLink')}</p>
      ) : null}
      <p className="text-xs text-ink-mute">{t('socialPreviewNoteLayout')}</p>
    </section>
  );
}

interface PostProps {
  draft: SocialDraftDto;
  name: string;
  authorKind: 'member' | 'org_page' | null;
  body: string;
  fold: { head: string; folded: boolean };
  comment: string | null;
  expanded: boolean;
  onExpand: () => void;
  host: string | null;
}

function LinkedInPost({
  draft,
  name,
  authorKind,
  body,
  fold,
  comment,
  expanded,
  onExpand,
  host,
}: PostProps) {
  const t = useTranslations('dashboard.overview.drawer');
  return (
    <div className="bg-[#F4F2EE] px-3 py-5 md:px-6">
      <article className="mx-auto w-full max-w-[555px] overflow-hidden rounded-[8px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_3px_rgba(0,0,0,0.06)]">
        <div className="flex items-start gap-2 px-4 pt-3">
          <Avatar
            name={name}
            size={48}
            round={authorKind !== 'org_page'}
            className="bg-[#0F1419] text-white"
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[14px] font-semibold leading-[20px] text-black/90">
              {name}
            </p>
            <p className="flex items-center gap-1 text-[12px] leading-[16px] text-black/60">
              {t('socialPreviewMetaNow')}
              <Globe className="size-3" aria-hidden />
            </p>
          </div>
          <MoreHorizontal className="size-5 shrink-0 text-black/60" aria-hidden />
        </div>

        <PostBody
          body={body}
          fold={fold}
          expanded={expanded}
          onExpand={onExpand}
          seeMore={t('socialPreviewSeeMore')}
          className="px-4 pb-2 pt-2 text-[14px] leading-[20px] text-black/90"
          linkClassName="text-[#0a66c2]"
          seeMoreClassName="text-black/60 hover:text-[#0a66c2] hover:underline"
        />

        <Media draft={draft} className="bg-[#EDEBE8]" />

        {host ? (
          <div className="border-t-[1px] border-black/10">
            <CardImage label={t('socialPreviewCardImage')} className="bg-[#E4E1DB] text-black/45" />
            <div className="bg-[#F3F2EF] px-3 py-2">
              <p className="text-[14px] font-semibold leading-[20px] text-black/90">
                {t('socialPreviewCardTitle')}
              </p>
              <p className="truncate text-[12px] leading-[16px] text-black/60">{host}</p>
            </div>
          </div>
        ) : null}

        <div className="mx-4 mt-1 border-t-[1px] border-black/10" />
        <div className="flex items-center px-2 py-1">
          <ActionButton icon={<ThumbsUp className="size-[18px]" aria-hidden />}>
            {t('socialPreviewLike')}
          </ActionButton>
          <ActionButton icon={<MessageSquare className="size-[18px]" aria-hidden />}>
            {t('socialPreviewComment')}
          </ActionButton>
          <ActionButton icon={<Repeat2 className="size-[18px]" aria-hidden />}>
            {t('socialPreviewRepost')}
          </ActionButton>
          <ActionButton icon={<Send className="size-[18px]" aria-hidden />}>
            {t('socialPreviewSend')}
          </ActionButton>
        </div>

        {comment ? (
          <div className="flex items-start gap-2 px-4 pb-4 pt-1">
            <Avatar
              name={name}
              size={32}
              round={authorKind !== 'org_page'}
              className="bg-[#0F1419] text-white"
            />
            <div className="min-w-0 flex-1">
              <div className="rounded-[8px] bg-[#F3F2EF] px-3 py-2">
                <p className="truncate text-[13px] font-semibold leading-[18px] text-black/90">
                  {name}
                </p>
                <p className="whitespace-pre-wrap break-words text-[14px] leading-[20px] text-black/90">
                  <Linkified text={comment} className="text-[#0a66c2]" />
                </p>
              </div>
              <p className="mt-1 px-3 text-[12px] font-semibold text-black/60">
                {t('socialPreviewCommentMeta')}
              </p>
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}

function FacebookPost({
  draft,
  name,
  body,
  fold,
  comment,
  expanded,
  onExpand,
  host,
}: PostProps) {
  const t = useTranslations('dashboard.overview.drawer');
  return (
    <div className="bg-[#F0F2F5] px-3 py-5 md:px-6">
      <article className="mx-auto w-full max-w-[500px] overflow-hidden rounded-[8px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
        <div className="flex items-start gap-2 px-4 pt-3">
          <Avatar name={name} size={40} round className="bg-[#0F1419] text-white" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-[20px] text-[#080809]">
              {name}
            </p>
            <p className="flex items-center gap-1 text-[13px] leading-[18px] text-[#65676B]">
              {t('socialPreviewMetaNow')}
              <span aria-hidden>·</span>
              <Globe className="size-3" aria-hidden />
            </p>
          </div>
          <MoreHorizontal className="size-5 shrink-0 text-[#65676B]" aria-hidden />
        </div>

        <PostBody
          body={body}
          fold={fold}
          expanded={expanded}
          onExpand={onExpand}
          seeMore={t('socialPreviewSeeMore')}
          className="px-4 pb-3 pt-2 text-[15px] leading-[20px] text-[#050505]"
          linkClassName="text-[#216fdb]"
          seeMoreClassName="text-[#65676B] hover:underline"
        />

        <Media draft={draft} className="bg-[#F0F2F5]" />

        {host ? (
          <div className="border-y-[1px] border-[#CED0D4]">
            <CardImage
              label={t('socialPreviewCardImage')}
              className="bg-[#E4E6EB] text-[#65676B]"
            />
            <div className="bg-[#F2F3F5] px-3 py-2">
              <p className="truncate text-[12px] uppercase leading-[16px] tracking-[0.02em] text-[#65676B]">
                {host}
              </p>
              <p className="text-[17px] font-semibold leading-[20px] text-[#050505]">
                {t('socialPreviewCardTitle')}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mx-3 mt-1 border-t-[1px] border-[#CED0D4]" />
        <div className="flex items-center px-2 py-1">
          <ActionButton
            icon={<ThumbsUp className="size-5" aria-hidden />}
            className="text-[#65676B]"
          >
            {t('socialPreviewLike')}
          </ActionButton>
          <ActionButton
            icon={<MessageCircle className="size-5" aria-hidden />}
            className="text-[#65676B]"
          >
            {t('socialPreviewComment')}
          </ActionButton>
          <ActionButton icon={<Share2 className="size-5" aria-hidden />} className="text-[#65676B]">
            {t('socialPreviewShare')}
          </ActionButton>
        </div>

        {comment ? (
          <div className="flex items-start gap-2 px-4 pb-4 pt-1">
            <Avatar name={name} size={32} round className="bg-[#0F1419] text-white" />
            <div className="min-w-0 flex-1">
              <div className="inline-block max-w-full rounded-[18px] bg-[#F0F2F5] px-3 py-2">
                <p className="truncate text-[13px] font-semibold leading-[18px] text-[#050505]">
                  {name}
                </p>
                <p className="whitespace-pre-wrap break-words text-[15px] leading-[20px] text-[#050505]">
                  <Linkified text={comment} className="text-[#216fdb]" />
                </p>
              </div>
              <p className="mt-1 px-3 text-[12px] font-semibold text-[#65676B]">
                {t('socialPreviewCommentMeta')}
              </p>
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}

function PostBody({
  body,
  fold,
  expanded,
  onExpand,
  seeMore,
  className,
  linkClassName,
  seeMoreClassName,
}: {
  body: string;
  fold: { head: string; folded: boolean };
  expanded: boolean;
  onExpand: () => void;
  seeMore: string;
  className: string;
  linkClassName: string;
  seeMoreClassName: string;
}) {
  const shown = expanded || !fold.folded ? body : fold.head;
  return (
    <p className={cn('whitespace-pre-wrap break-words', className)}>
      <Linkified text={shown} className={linkClassName} />
      {fold.folded && !expanded ? (
        <>
          {' …'}
          <button type="button" onClick={onExpand} className={seeMoreClassName}>
            {seeMore}
          </button>
        </>
      ) : null}
    </p>
  );
}

function Linkified({ text, className }: { text: string; className: string }) {
  return (
    <>
      {splitUrls(text).map((part, i) =>
        part.url ? (
          <span key={i} className={className}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Media({ draft, className }: { draft: SocialDraftDto; className: string }) {
  const t = useTranslations('dashboard.overview.drawer');
  if (!draft.mediaUrl) return null;
  return (
    <div className={className}>
      {socialMediaKind(draft) === 'video' ? (
        <video controls preload="metadata" className="max-h-[520px] w-full" src={draft.mediaUrl}>
          {t('socialMediaVideoUnsupported')}
        </video>
      ) : (
        <img
          src={draft.mediaUrl}
          alt={draft.mediaAltText ?? ''}
          className="max-h-[520px] w-full object-contain"
        />
      )}
    </div>
  );
}

function CardImage({ label, className }: { label: string; className: string }) {
  return (
    <div className={cn('flex aspect-[1.91/1] items-center justify-center', className)}>
      <p className="px-4 text-center font-mono text-[10px] font-medium uppercase tracking-eyebrow">
        {label}
      </p>
    </div>
  );
}

function ActionButton({
  icon,
  children,
  className,
}: {
  icon: React.ReactNode;
  children: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-[4px] px-2 py-2.5 text-[14px] font-semibold text-black/60',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function Avatar({
  name,
  size,
  round,
  className,
}: {
  name: string;
  size: 32 | 40 | 48;
  round?: boolean;
  className: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center font-mono font-medium',
        size === 48 && 'size-12 text-sm',
        size === 40 && 'size-10 text-[13px]',
        size === 32 && 'size-8 text-[10px]',
        round ? 'rounded-full' : 'rounded-[4px]',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
