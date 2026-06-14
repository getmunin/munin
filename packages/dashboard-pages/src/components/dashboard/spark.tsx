import { cn } from '@getmunin/ui';

interface SparkProps {
  values: number[];
  className?: string;
  tone?: 'accent' | 'ink';
}

export function Spark({ values, className, tone = 'accent' }: SparkProps) {
  if (values.length < 2) {
    return <svg className={cn('block w-full h-[22px]', className)} viewBox="0 0 200 22" />;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const w = 200;
  const h = 22;
  const pad = 2;
  const range = max - min;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const t = range === 0 ? 0 : (v - min) / range;
      const y = h - pad - t * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className={cn('block w-full h-[22px]', className)}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        strokeWidth={1.2}
        points={points}
        className={
          tone === 'accent'
            ? 'stroke-cobalt dark:stroke-cobalt-soft'
            : 'stroke-ink dark:stroke-foreground'
        }
      />
    </svg>
  );
}
