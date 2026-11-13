'use client';

import { useEffect, useMemo, useState } from 'react';
import { CmsQueuePane, type CmsPaneGroup } from './queue-panes/cms';
import type { CmsGroupAction, InboxController } from './inbox-types';
import {
  nextAfterDecisions,
  nextWaitingSibling,
  type CmsQueueItem,
  type ReviewDecisionOutcome,
  type ReviewGroup,
} from './review-queue';

export interface ReviewDecideOptions {
  next?: string | null;
  withinGroup?: boolean;
  title?: string;
  languages?: number;
}

export type ReviewDecide = (
  outcome: ReviewDecisionOutcome,
  run: () => Promise<boolean>,
  options?: ReviewDecideOptions,
) => Promise<boolean>;

export function ReviewCmsGroupPane({
  group,
  item,
  controller,
  waitingIds,
  decide,
  onSelect,
}: {
  group: ReviewGroup;
  item: CmsQueueItem;
  controller: InboxController;
  waitingIds: readonly string[];
  decide: ReviewDecide;
  onSelect: (id: string) => void;
}) {
  const {
    isPending,
    cmsDetails,
    cmsPreviewLinks,
    reloadCmsPreviewLink,
    queueDetailErrors,
    reloadQueueDetail,
    queueActionError,
    clearQueueActionError,
    approveQueue,
    dismissQueue,
    saveCmsDraft,
    uploadCmsAsset,
    focusCmsEntries,
    approveCmsGroup,
    dismissCmsGroup,
    scheduleCmsGroup,
  } = controller;

  const [peek, setPeek] = useState<{ anchorId: string; id: string } | null>(null);
  const peeked =
    peek && peek.anchorId === item.id
      ? group.translations.find((tr) => tr.id === peek.id && tr.status !== 'draft')
      : undefined;
  const openId = peeked?.id ?? item.id;
  const referenceId = group.lead.id === openId ? null : group.lead.id;

  useEffect(() => {
    focusCmsEntries(openId, referenceId);
  }, [focusCmsEntries, openId, referenceId]);

  useEffect(() => () => focusCmsEntries(null, null), [focusCmsEntries]);

  const memberIds = useMemo(() => group.members.map((member) => member.id), [group.members]);
  const pending = memberIds.some((id) => isPending(id));

  const paneItem = peeked
    ? {
        id: peeked.id,
        title: peeked.title,
        createdAt: item.createdAt,
        raw: {
          ...item.raw,
          id: peeked.id,
          locale: peeked.locale,
          title: peeked.title,
          version: peeked.version,
        },
      }
    : item;

  const action = (): CmsGroupAction => ({
    groupId: group.groupId,
    anchorId: openId,
    members: group.members.map((member) => ({ id: member.id, version: member.raw.version })),
  });
  const afterGroup = {
    next: nextAfterDecisions(waitingIds, memberIds),
    title: group.lead.title,
    languages: group.members.length,
  };
  const sibling = nextWaitingSibling(memberIds, item.id);
  const afterOne: ReviewDecideOptions = sibling ? { next: sibling, withinGroup: true } : {};

  const paneGroup: CmsPaneGroup = {
    translations: group.translations.map((tr) => ({
      id: tr.id,
      locale: tr.locale,
      status: tr.status,
    })),
    yoursId: group.leadIsViewerLanguage ? group.lead.id : null,
    openPending: !peeked,
    waitingLocales: group.members.map((member) => member.raw.locale),
    reference: referenceId
      ? {
          locale: group.lead.locale,
          yours: group.leadIsViewerLanguage,
          detail: cmsDetails[referenceId],
          loadError: queueDetailErrors[referenceId],
        }
      : null,
    onOpen: (id) => {
      if (memberIds.includes(id)) {
        setPeek(null);
        if (id !== item.id) onSelect(id);
        return;
      }
      setPeek({ anchorId: item.id, id });
    },
    onApproveAll: () => void decide('approved', () => approveCmsGroup(action()), afterGroup),
    onDismissAll: () => void decide('dismissed', () => dismissCmsGroup(action()), afterGroup),
    onScheduleAll: async (scheduledAt) => {
      await decide(
        'scheduled',
        () => scheduleCmsGroup(action(), scheduledAt).then(() => true),
        afterGroup,
      );
    },
  };

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-paper dark:bg-background">
      <CmsQueuePane
        item={paneItem}
        detail={cmsDetails[openId]}
        loadError={queueDetailErrors[openId]}
        onRetry={() => reloadQueueDetail(openId)}
        pending={pending}
        onApprove={() => void decide('approved', () => approveQueue(item), afterOne)}
        onDismiss={() => void decide('dismissed', () => dismissQueue(item), afterOne)}
        onSaveData={(data) => saveCmsDraft(item, data)}
        onUploadAsset={(file) => uploadCmsAsset(item, file)}
        onSchedule={(scheduledAt) => paneGroup.onScheduleAll(scheduledAt)}
        previewLink={cmsPreviewLinks[openId]}
        onRetryPreview={() => void reloadCmsPreviewLink(openId)}
        actionError={queueActionError}
        onClearActionError={clearQueueActionError}
        hideHeaderOnMobile
        group={paneGroup}
      />
    </section>
  );
}
