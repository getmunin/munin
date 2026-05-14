'use client';

import { useTranslations } from 'next-intl';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';
import type { SkillDto } from './types';

interface BackgroundSkillCardProps {
  skill: SkillDto;
}

export function BackgroundSkillCard({ skill }: BackgroundSkillCardProps) {
  const t = useTranslations('assistants.list.background');
  const lastRun = skill.lastRunAt ? formatRelative(skill.lastRunAt) : t('neverRan');
  const statusLabel = skill.lastRunStatus
    ? t('statuses.' + skill.lastRunStatus, { defaultValue: skill.lastRunStatus })
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <CardTitle>{skill.name}</CardTitle>
            <CardDescription className="mt-1">{skill.description}</CardDescription>
          </div>
          <span className="font-mono text-xs uppercase tracking-eyebrow text-muted-foreground">
            {t('tierLabel', { tier: skill.tier })}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {lastRun}
          {statusLabel ? <span className="ml-2">· {statusLabel}</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(then).toLocaleDateString();
}
