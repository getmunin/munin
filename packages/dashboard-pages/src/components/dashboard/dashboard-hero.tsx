'use client';

import { Hero } from '@getmunin/ui';

interface DashboardHeroProps {
  orgName: string | null;
  date: Date;
  totalCount: number;
  liveCount: number;
}

export function DashboardHero({ orgName, date, totalCount, liveCount }: DashboardHeroProps) {
  const dateLabel = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const eyebrow = [orgName, dateLabel].filter(Boolean).join(' · ');
  const lede = composeLede(totalCount, liveCount);

  return (
    <Hero
      eyebrow={eyebrow}
      title={
        <>
          The day, <em>from above</em>.
        </>
      }
      lede={lede}
    />
  );
}

function composeLede(totalCount: number, liveCount: number): string {
  if (totalCount === 0) {
    return 'Nothing waiting on you. The agents are caught up; the perch is quiet.';
  }
  const things =
    totalCount === 1 ? '1 thing waiting on you' : `${totalCount} things waiting on you`;
  if (liveCount === 0) {
    return `${things}. No live conversations — review at your own pace.`;
  }
  if (liveCount === 1) {
    return `${things}, and one live conversation needs a reply.`;
  }
  return `${things}, and ${liveCount} live conversations need a reply.`;
}
