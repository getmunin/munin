'use client';

const WIDTH = 160;
const HEIGHT = 36;
const PAD = 2;

export function Sparkline({ points }: { points: Array<{ day: string; views: number }> }) {
  const max = Math.max(0, ...points.map((p) => p.views));
  if (max === 0 || points.length < 2) {
    return (
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
        <line
          x1={0}
          y1={HEIGHT - PAD}
          x2={WIDTH}
          y2={HEIGHT - PAD}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="4 4"
          className="text-rule-soft dark:text-rule-on-dark"
        />
      </svg>
    );
  }
  const step = (WIDTH - PAD * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = PAD + i * step;
    const y = HEIGHT - PAD - (p.views / max) * (HEIGHT - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-ink-mute"
      />
    </svg>
  );
}
