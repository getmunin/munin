'use client';

import { journeyNodeEdges, JourneySpecSchema, type JourneyNode } from '@getmunin/types';
import { cn } from '@getmunin/ui';

const NODE_W = 168;
const NODE_H = 52;
const GAP_X = 56;
const GAP_Y = 44;
const PAD = 16;
const BACK_MARGIN = 96;

export interface LaidOutNode {
  node: JourneyNode;
  x: number;
  y: number;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  label: string;
  back: boolean;
}

export interface JourneyLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export function layoutJourney(spec: unknown): JourneyLayout | null {
  const parsed = JourneySpecSchema.safeParse(spec);
  if (!parsed.success) return null;
  const { nodes, start } = parsed.data;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const backEdges = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const edge of journeyNodeEdges(byId.get(id)!)) {
      if (!byId.has(edge.to)) continue;
      const seen = state.get(edge.to);
      if (seen === 'open') backEdges.add(`${id}|${edge.label}`);
      else if (!seen) visit(edge.to);
    }
    state.set(id, 'done');
  };
  if (byId.has(start)) visit(start);
  const reachable = new Set(state.keys());
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);

  const depth = new Map<string, number>();
  const depthOf = (id: string, trail: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    let d = 0;
    for (const parent of nodes) {
      for (const edge of journeyNodeEdges(parent)) {
        if (edge.to !== id || backEdges.has(`${parent.id}|${edge.label}`) || trail.has(parent.id)) continue;
        d = Math.max(d, depthOf(parent.id, new Set([...trail, id])) + 1);
      }
    }
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) depthOf(n.id, new Set());
  if (byId.has(start)) depth.set(start, 0);
  const lastReachable = Math.max(0, ...[...reachable].map((id) => depth.get(id)!));
  for (const n of nodes) {
    if (!reachable.has(n.id)) depth.set(n.id, lastReachable + 1 + depth.get(n.id)!);
  }

  const layers = new Map<number, JourneyNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    layers.set(d, [...(layers.get(d) ?? []), n]);
  }
  const widest = Math.max(...[...layers.values()].map((l) => l.length));
  const width = PAD * 2 + widest * NODE_W + (widest - 1) * GAP_X + BACK_MARGIN;
  const laidOut: LaidOutNode[] = [];
  for (const [d, layer] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    const rowWidth = layer.length * NODE_W + (layer.length - 1) * GAP_X;
    const offset = (width - BACK_MARGIN - rowWidth) / 2;
    layer.forEach((node, i) => {
      laidOut.push({ node, x: offset + i * (NODE_W + GAP_X), y: PAD + d * (NODE_H + GAP_Y) });
    });
  }
  const edges: LaidOutEdge[] = [];
  for (const n of nodes) {
    for (const edge of journeyNodeEdges(n)) {
      if (!byId.has(edge.to)) continue;
      edges.push({ from: n.id, to: edge.to, label: edge.label, back: backEdges.has(`${n.id}|${edge.label}`) });
    }
  }
  const height = PAD * 2 + (Math.max(...depth.values()) + 1) * (NODE_H + GAP_Y) - GAP_Y;
  return { nodes: laidOut, edges, width, height };
}

export function JourneyGraph({
  spec,
  counts,
  highlight,
  emptyLabel,
}: {
  spec: unknown;
  counts?: Record<string, number>;
  highlight?: string | null;
  emptyLabel: string;
}) {
  const layout = layoutJourney(spec);
  if (!layout) {
    return <p className="font-mono text-xs text-ink-mute">{emptyLabel}</p>;
  }
  const at = new Map(layout.nodes.map((n) => [n.node.id, n]));
  return (
    <div className="overflow-x-auto rounded-card border-[1px] border-rule-soft bg-paper-deep/40 dark:border-rule-on-dark dark:bg-secondary/40">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="journey graph"
        className="mx-auto block"
      >
        <defs>
          <marker id="journey-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="fill-ink-mute" />
          </marker>
        </defs>
        {layout.edges.map((edge, i) => {
          const from = at.get(edge.from)!;
          const to = at.get(edge.to)!;
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = edge.back ? to.y + NODE_H : to.y;
          const path = edge.back
            ? `M${from.x + NODE_W},${from.y + NODE_H / 2} C${from.x + NODE_W + 60},${from.y + NODE_H / 2} ${to.x + NODE_W + 60},${to.y + NODE_H / 2} ${to.x + NODE_W},${to.y + NODE_H / 2}`
            : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
          return (
            <g key={`${edge.from}-${edge.label}-${i}`}>
              <path
                d={path}
                fill="none"
                strokeWidth={1.25}
                strokeDasharray={edge.back ? '4 3' : undefined}
                markerEnd="url(#journey-arrow)"
                className="stroke-ink-mute"
              />
              {edge.label !== 'next' && (
                <text
                  x={edge.back ? from.x + NODE_W + 8 : (x1 + x2) / 2 + 4}
                  y={edge.back ? from.y + NODE_H / 2 - 6 : (y1 + y2) / 2}
                  className="fill-ink-mute font-mono text-[10px]"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
        {layout.nodes.map(({ node, x, y }) => {
          const count = counts?.[node.id];
          return (
            <g key={node.id} transform={`translate(${x},${y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={6}
                strokeWidth={highlight === node.id ? 2 : 1}
                className={cn(
                  'fill-paper dark:fill-card',
                  highlight === node.id ? 'stroke-cobalt' : 'stroke-rule-soft dark:stroke-rule-on-dark',
                )}
              />
              <text x={10} y={18} className="fill-ink-label font-mono text-[10px] uppercase tracking-eyebrow">
                {node.type.replace('_', ' ')}
              </text>
              <text x={10} y={36} className="fill-ink font-mono text-[11px] dark:fill-foreground">
                {truncate(node.label ?? nodeTitle(node), 22)}
              </text>
              {count !== undefined && (
                <text x={NODE_W - 10} y={18} textAnchor="end" className="fill-cobalt font-mono text-[10px]">
                  {count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function nodeTitle(node: JourneyNode): string {
  switch (node.type) {
    case 'message': {
      const mark = node.draftBy === 'agent' ? '✎ ' : '';
      if (node.channel === 'sms') return `${mark}SMS · ${node.content.body.length > 40 ? `${node.content.body.slice(0, 39)}…` : node.content.body}`;
      if (node.channel === 'chat') return `${mark}Chat · ${node.content.body.length > 40 ? `${node.content.body.slice(0, 39)}…` : node.content.body}`;
      if (node.channel === 'voice') return `${mark}Call · ${node.content.body.length > 40 ? `${node.content.body.slice(0, 39)}…` : node.content.body}`;
      const subject = node.content.subject ?? node.id;
      return node.draftBy === 'agent' ? `✎ ${subject}` : subject;
    }
    case 'action':
      return node.action;
    case 'wait':
      return node.duration ?? node.until ?? node.untilField?.field ?? node.id;
    case 'wait_for':
      return node.event;
    case 'exit':
      return node.reason;
    case 'goal':
      return node.name;
    case 'agent':
      return node.mode === 'decide'
        ? `decide: ${Object.keys(node.edges ?? {}).join(' / ')}`
        : `enrich: ${(node.fields ?? []).map((f) => f.key).join(', ')}`;
    case 'approval':
      return `approve: ${node.title}`;
    case 'sub_journey':
      return `${node.await ? 'run' : 'enter'} ${node.journeyId}`;
    default:
      return node.id;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
