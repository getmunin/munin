'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Mail, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@getmunin/ui';
import { api, ApiError } from '../api';

interface CampaignDto {
  id: string;
  name: string;
  brief: string;
  segmentId: string;
  channelId: string;
  cadenceRules: {
    maxPerWeekPerContact?: number;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    blackoutDates?: string[];
  };
  ctaUrl: string | null;
  enabled: boolean;
  unsubscribeRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SegmentDto {
  id: string;
  name: string;
}

interface ChannelDto {
  id: string;
  type: string;
  name: string;
  active: boolean;
}

export function OutreachCampaignsPage() {
  const t = useTranslations('dashboard.outreach');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const [campaigns, setCampaigns] = useState<CampaignDto[] | null>(null);
  const [segments, setSegments] = useState<SegmentDto[]>([]);
  const [emailChannels, setEmailChannels] = useState<ChannelDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const [campaignsRes, segmentsRes, channelsRes] = await Promise.all([
        api<{ items: CampaignDto[] }>('/api/outreach/campaigns'),
        api<{ items: SegmentDto[] }>('/api/crm/segments').catch(() => ({ items: [] })),
        api<{ items: ChannelDto[] }>('/api/conv/channels').catch(() => ({ items: [] })),
      ]);
      setCampaigns(campaignsRes.items);
      setSegments(segmentsRes.items);
      setEmailChannels(channelsRes.items.filter((c) => c.type === 'email' && c.active));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.load'));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleEnabled(id: string, enabled: boolean) {
    setBusyId(id);
    try {
      await api(`/api/outreach/campaigns/${id}`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.update'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} disabled={emailChannels.length === 0 || segments.length === 0}>
            <Plus className="size-4" />
            {t('addCampaign')}
          </Button>
        </header>

        {error && (
          <Card>
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {(emailChannels.length === 0 || segments.length === 0) && (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              {emailChannels.length === 0 ? t('needsEmailChannel') : t('needsSegment')}
            </CardContent>
          </Card>
        )}

        {campaigns === null ? (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        ) : campaigns.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('emptyTitle')}</CardTitle>
              <CardDescription>{t('emptyBody')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="space-y-3">
            {campaigns.map((c) => {
              const segmentName = segments.find((s) => s.id === c.segmentId)?.name ?? c.segmentId;
              const channelName =
                emailChannels.find((ch) => ch.id === c.channelId)?.name ?? c.channelId;
              const updatedLabel = format.dateTime(new Date(c.updatedAt), {
                dateStyle: 'medium',
              });
              return (
                <Card key={c.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <Mail className="size-4 text-muted-foreground" />
                          <CardTitle className="text-base">{c.name}</CardTitle>
                          {c.enabled ? (
                            <Badge variant="success">{t('enabled')}</Badge>
                          ) : (
                            <Badge variant="outline">{t('disabled')}</Badge>
                          )}
                        </div>
                        <CardDescription className="line-clamp-2">{c.brief}</CardDescription>
                        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {t('segment')}: <strong className="font-medium">{segmentName}</strong>
                          </span>
                          <span>
                            {t('channel')}: <strong className="font-medium">{channelName}</strong>
                          </span>
                          <span>{updatedLabel}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant={c.enabled ? 'outline' : 'default'}
                          disabled={busyId === c.id}
                          onClick={() => void toggleEnabled(c.id, !c.enabled)}
                        >
                          {c.enabled ? t('disable') : t('enable')}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </ul>
        )}
      </div>

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        segments={segments}
        emailChannels={emailChannels}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />
    </>
  );
}

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segments: SegmentDto[];
  emailChannels: ChannelDto[];
  onCreated: () => void;
}

function CreateCampaignDialog({ open, onOpenChange, segments, emailChannels, onCreated }: CreateDialogProps) {
  const t = useTranslations('dashboard.outreach');
  const tCommon = useTranslations('common');
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setBrief('');
      setSegmentId(segments[0]?.id ?? '');
      setChannelId(emailChannels[0]?.id ?? '');
      setCtaUrl('');
      setErr(null);
      setSubmitting(false);
    }
  }, [open, segments, emailChannels]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    void (async () => {
      try {
        await api('/api/outreach/campaigns', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            brief: brief.trim(),
            segmentId,
            channelId,
            ctaUrl: ctaUrl.trim() || null,
          }),
        });
        onCreated();
      } catch (e2) {
        setErr(e2 instanceof ApiError ? e2.message : t('errors.create'));
      } finally {
        setSubmitting(false);
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="campaign-name">{t('nameLabel')}</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder={t('namePlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="campaign-brief">{t('briefLabel')}</Label>
            <textarea
              id="campaign-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              required
              rows={5}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder={t('briefPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('briefHint')}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="campaign-segment">{t('segmentLabel')}</Label>
            <select
              id="campaign-segment"
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="campaign-channel">{t('channelLabel')}</Label>
            <select
              id="campaign-channel"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {emailChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="campaign-cta">{t('ctaLabel')}</Label>
            <Input
              id="campaign-cta"
              type="url"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !name.trim() || !brief.trim()}>
              {submitting ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
