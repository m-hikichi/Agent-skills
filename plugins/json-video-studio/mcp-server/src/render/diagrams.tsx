import React from 'react';
import {Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneVisual, VideoProject} from '../shared/video-types.js';
import {DECK, DIMMED_OPACITY} from './deck.js';
import {textUnits} from './layout.js';

/**
 * Diagram visuals whose form carries the meaning: connections and hand-offs
 * (diagram), containment (nest) and time/synchronisation (timeline). They are
 * drawn on a fixed 1640x600 stage with colors from a tone, so the same
 * component works on the deck's white card and on the dark theme background.
 */
export interface DiagramTone {
  text: string;
  sub: string;
  line: string;
  panel: string;
  panelAlt: string;
  accent: string;
  onAccent: string;
  marker: string;
  markerLine: string;
}

export const deckTone: DiagramTone = {
  text: DECK.text, sub: DECK.textSub, line: DECK.line, panel: '#FFFFFF', panelAlt: DECK.lighter,
  accent: DECK.main, onAccent: '#FFFFFF', marker: DECK.marker, markerLine: DECK.markerLine,
};

export const themeTone = (project: Pick<VideoProject, 'theme'>): DiagramTone => {
  const accent = project.theme.accentColor;
  return {
    text: project.theme.foregroundColor, sub: `color-mix(in srgb, ${project.theme.foregroundColor} 78%, transparent)`,
    line: 'rgba(255,255,255,0.32)', panel: 'rgba(10, 15, 29, 0.80)', panelAlt: 'rgba(255,255,255,0.08)',
    accent, onAccent: '#06101f', marker: `color-mix(in srgb, ${accent} 26%, transparent)`, markerLine: accent,
  };
};

export const STAGE = {width: 1640, height: 600} as const;
const TRANSITION_FRAMES = 8;
const phraseWrap = {wordBreak: 'auto-phrase', lineBreak: 'strict', whiteSpace: 'pre-wrap'} as unknown as React.CSSProperties;

/** Ease a 0..1 emphasis amount from the previous scene's state when the layout continues. */
const useAmount = (current: number, previous: number | undefined, staticPreview: boolean): number => {
  const frame = useCurrentFrame();
  if (staticPreview || previous === undefined || previous === current) return current;
  return interpolate(frame, [0, TRANSITION_FRAMES], [previous, current], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
};

const Stage = ({children, title, note, tone}: {children: React.ReactNode; title?: string | undefined; note?: string | undefined; tone: DiagramTone}) => (
  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, color: tone.text}}>
    {title ? <div lang="ja" style={{fontSize: 46, fontWeight: 900, lineHeight: 1.2, textAlign: 'center', ...phraseWrap}}>{title}</div> : null}
    {children}
    {note ? <div lang="ja" style={{fontSize: 28, color: tone.sub, textAlign: 'center', maxWidth: STAGE.width, ...phraseWrap}}>{note}</div> : null}
  </div>
);

type DiagramVisual = Extract<SceneVisual, {type: 'diagram'}>;
type NestVisual = Extract<SceneVisual, {type: 'nest'}>;
type TimelineVisual = Extract<SceneVisual, {type: 'timeline'}>;

/** Horizontal placement of the diagram nodes: equal boxes, centred, with room for the arrows between them. */
export const diagramLayout = (count: number) => {
  // Fewer nodes get wider boxes and wider gaps, so a two-node diagram still fills the stage.
  const maxNode = count <= 2 ? 480 : count === 3 ? 360 : 330;
  const maxGap = count <= 2 ? 420 : count === 3 ? 280 : 260;
  const nodeWidth = Math.min(maxNode, Math.floor((STAGE.width - 110 * (count - 1)) / count));
  const gap = count > 1 ? Math.min(maxGap, Math.floor((STAGE.width - count * nodeWidth) / (count - 1))) : 0;
  const left = (STAGE.width - (count * nodeWidth + (count - 1) * gap)) / 2;
  return {nodeWidth, gap, x: (index: number) => left + index * (nodeWidth + gap)};
};

const NODE = {top: 150, height: 270} as const;
/** Height of the diagram area: arcs and group label above the nodes, link labels of narrow gaps below. */
const DIAGRAM_HEIGHT = NODE.top + NODE.height + 110;
/** Gaps at least this wide carry the link label beside its arrow; narrower ones list it under the nodes. */
const INLINE_LABEL_GAP = 190;

interface LinkGeometry {
  point: (t: number) => {x: number; y: number};
  path: string;
  arrow: string;
  label: {x: number; y: number; width: number};
}

/**
 * Geometry of one link. Adjacent nodes are joined by a straight arrow in the
 * gap (two links between the same pair are stacked); other pairs arc over the
 * top of the row. Labels sit under the gap where there is room for text.
 */
export const linkGeometry = (fromIndex: number, toIndex: number, count: number, lane: number, lanes: number, labelWidth?: number): LinkGeometry => {
  const layout = diagramLayout(count);
  const forward = toIndex > fromIndex;
  if (Math.abs(toIndex - fromIndex) === 1) {
    const leftIndex = Math.min(fromIndex, toIndex);
    const x1 = layout.x(leftIndex) + layout.nodeWidth;
    const x2 = layout.x(leftIndex + 1);
    const y = NODE.top + NODE.height / 2 + (lane - (lanes - 1) / 2) * 96;
    // A label stays beside its own arrow whenever it fits the gap; only a label too wide for it moves below the nodes.
    const inline = layout.gap >= INLINE_LABEL_GAP || (labelWidth !== undefined && labelWidth <= layout.gap - 12);
    const start = forward ? x1 + 6 : x2 - 6;
    const end = forward ? x2 - 6 : x1 + 6;
    const head = forward ? -1 : 1;
    return {
      point: (t) => ({x: start + (end - start) * t, y}),
      path: `M ${start} ${y} H ${end}`,
      arrow: `M ${end + head * 18} ${y - 12} L ${end} ${y} L ${end + head * 18} ${y + 12}`,
      // Beside the arrow: above the first lane, below the others, so stacked links keep their own label.
      label: inline
        // Clear of the packet (52px tall, centred on the line) that comes to rest at the end of the arrow.
        ? {x: (x1 + x2) / 2, y: lane === 0 ? y - 72 : y + 32, width: layout.gap - 12}
        : {x: (x1 + x2) / 2, y: NODE.top + NODE.height + 40 + lane * 40, width: layout.gap + 200},
    };
  }
  const sx = layout.x(fromIndex) + layout.nodeWidth / 2;
  const ex = layout.x(toIndex) + layout.nodeWidth / 2;
  // High enough that the arc clears the top edge of a group frame (NODE.top - 78) instead of running along it.
  const top = NODE.top - 150 - lane * 26;
  const bezier = (t: number, a: number, b: number, c: number, d: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
  // A cubic with both control points at `top` peaks three quarters of the way up to them.
  const peak = (NODE.top - 6) + 0.75 * (top - (NODE.top - 6));
  return {
    point: (t) => ({x: bezier(t, sx, sx, ex, ex), y: bezier(t, NODE.top - 6, top, top, NODE.top - 6)}),
    path: `M ${sx} ${NODE.top - 6} C ${sx} ${top}, ${ex} ${top}, ${ex} ${NODE.top - 6}`,
    arrow: `M ${ex - 12} ${NODE.top - 24} L ${ex} ${NODE.top - 6} L ${ex + 12} ${NODE.top - 24}`,
    label: {x: (sx + ex) / 2, y: peak - 44, width: Math.abs(ex - sx)},
  };
};

/**
 * Width in text units (a wide character is 1) available to the label of a link
 * between adjacent nodes; longer labels run into the nodes.
 */
export const linkLabelUnits = (count: number): number => {
  const layout = diagramLayout(count);
  return Math.floor((layout.gap >= INLINE_LABEL_GAP ? layout.gap - 12 : layout.gap + 200) / 30);
};

/**
 * Centre of a packet `width` px wide at travel `t`. On a straight link it stays
 * inside the gap, so it rests beside the receiving node instead of covering it.
 */
export const packetPosition = (geometry: Pick<LinkGeometry, 'point'>, t: number, width: number, straight: boolean): {x: number; y: number} => {
  if (!straight) return geometry.point(t);
  const start = geometry.point(0);
  const end = geometry.point(1);
  const length = Math.abs(end.x - start.x);
  const inset = Math.min(width / 2 + 6, length / 2);
  const direction = Math.sign(end.x - start.x) || 1;
  return {x: start.x + direction * (inset + (length - inset * 2) * t), y: start.y};
};

/** Lane of each link among the links joining the same pair of nodes. */
export const linkLanes = (links: ReadonlyArray<{from: string; to: string}>): Array<{lane: number; lanes: number}> => {
  const key = (link: {from: string; to: string}) => [link.from, link.to].sort().join('\u0000');
  const totals = new Map<string, number>();
  for (const link of links) totals.set(key(link), (totals.get(key(link)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return links.map((link) => {
    const lane = seen.get(key(link)) ?? 0;
    seen.set(key(link), lane + 1);
    return {lane, lanes: totals.get(key(link))!};
  });
};

const DiagramNode = ({node, x, width, amount, previousAmount, anyActive, tone, staticPreview}: {node: DiagramVisual['nodes'][number]; x: number; width: number; amount: number; previousAmount: number | undefined; anyActive: number; tone: DiagramTone; staticPreview: boolean}) => {
  const eased = useAmount(amount, previousAmount, staticPreview);
  return (
    <div style={{position: 'absolute', left: x, top: NODE.top, width, height: NODE.height, boxSizing: 'border-box', borderRadius: 18, padding: '18px 18px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 8,
      background: eased > 0 ? `color-mix(in srgb, ${tone.marker} ${(eased * 100).toFixed(0)}%, ${tone.panel})` : tone.panel,
      // Constant border width so the text never rewraps; emphasis is an outer ring.
      border: `3px solid ${eased > 0.5 ? tone.markerLine : tone.line}`,
      boxShadow: eased > 0 ? `0 0 0 ${(eased * 3).toFixed(1)}px ${tone.markerLine}, 0 12px 30px rgba(0, 0, 0, ${(0.22 * eased).toFixed(2)})` : 'none',
      opacity: 1 - (1 - DIMMED_OPACITY) * anyActive * (1 - eased)}}>
      <div lang="ja" style={{fontSize: width < 280 ? 36 : 46, fontWeight: 900, lineHeight: 1.2, color: tone.text, ...phraseWrap}}>{node.label}</div>
      {node.detail ? <div lang="ja" style={{fontSize: width < 280 ? 26 : 31, lineHeight: 1.35, color: tone.sub, ...phraseWrap}}>{node.detail}</div> : null}
    </div>
  );
};

/** Frame around adjacent nodes; emphasis turns the dashed outline solid and tints it. */
const DiagramGroup = ({label, left, width, amount, previousAmount, tone, staticPreview}: {label: string; left: number; width: number; amount: number; previousAmount: number | undefined; tone: DiagramTone; staticPreview: boolean}) => {
  const eased = useAmount(amount, previousAmount, staticPreview);
  return (
    <div style={{position: 'absolute', left, width, top: NODE.top - 78, height: NODE.height + 104, boxSizing: 'border-box', borderRadius: 24,
      border: `3px ${eased > 0.5 ? 'solid' : 'dashed'} ${eased > 0.5 ? tone.markerLine : tone.accent}`,
      boxShadow: eased > 0 ? `0 0 0 ${(eased * 3).toFixed(1)}px ${tone.markerLine}` : 'none',
      background: eased > 0 ? `color-mix(in srgb, ${tone.marker} ${(eased * 45).toFixed(0)}%, transparent)` : `color-mix(in srgb, ${tone.accent} 7%, transparent)`}}>
      <div lang="ja" style={{position: 'absolute', left: 22, top: 10, fontSize: 32, fontWeight: eased > 0.5 ? 900 : 800, color: eased > 0.5 ? tone.text : tone.accent}}>{label}</div>
    </div>
  );
};

export const DiagramTemplate = ({visual, previousVisual, tone, staticPreview = false, showTitle = true}: {visual: DiagramVisual; previousVisual?: SceneVisual | undefined; tone: DiagramTone; staticPreview?: boolean; showTitle?: boolean}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const previous = previousVisual?.type === 'diagram' ? previousVisual : undefined;
  const count = visual.nodes.length;
  const layout = diagramLayout(count);
  const indexOf = (id: string) => visual.nodes.findIndex((node) => node.id === id);
  const lanes = linkLanes(visual.links);
  const activeNodes = new Set(visual.active?.nodes ?? []);
  const previousNodes = previous ? new Set(previous.active?.nodes ?? []) : undefined;
  const activeLinks = new Set([...(visual.active?.links ?? []), ...(visual.active?.packet ? [visual.active.packet.link] : [])]);
  const anyActive = useAmount(activeNodes.size > 0 ? 1 : 0, previous ? ((previous.active?.nodes?.length ?? 0) > 0 ? 1 : 0) : undefined, staticPreview);
  const packet = visual.active?.packet;
  // The packet leaves as the scene starts and arrives within a second, then rests on the receiving side.
  const travel = staticPreview ? 1 : interpolate(frame, [4, 4 + Math.round(fps * 0.9)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const groups = (visual.groups ?? []).flatMap((group) => {
    const members = visual.nodes.map((node, index) => (node.group === group.id ? index : -1)).filter((index) => index >= 0);
    if (!members.length) return [];
    const first = Math.min(...members);
    const last = Math.max(...members);
    return [{...group, left: layout.x(first) - 26, right: layout.x(last) + layout.nodeWidth + 26}];
  });
  const activeGroups = new Set(visual.active?.groups ?? []);
  const previousGroups = previous ? new Set(previous.active?.groups ?? []) : undefined;
  // Arrows that are not emphasized stay at least 3:1 against the panel (a plain light line measured about 1.5:1).
  const idleLine = `color-mix(in srgb, ${tone.text} 55%, ${tone.panel})`;
  const labelWidth = (label: string | undefined) => (label ? Math.ceil(textUnits(label) * 30) : undefined);
  const geometryOf = (index: number) => {
    const link = visual.links[index]!;
    return linkGeometry(indexOf(link.from), indexOf(link.to), count, lanes[index]!.lane, lanes[index]!.lanes, labelWidth(link.label));
  };
  return (
    <Stage title={showTitle ? visual.title : undefined} note={visual.note} tone={tone}>
      <div style={{position: 'relative', width: STAGE.width, height: DIAGRAM_HEIGHT}}>
        {groups.map((group) => (
          <DiagramGroup key={group.id} label={group.label} left={group.left} width={group.right - group.left} tone={tone} staticPreview={staticPreview}
            amount={activeGroups.has(group.id) ? 1 : 0} previousAmount={previousGroups ? (previousGroups.has(group.id) ? 1 : 0) : undefined} />
        ))}
        <svg width={STAGE.width} height={DIAGRAM_HEIGHT} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
          {visual.links.map((link, index) => {
            const geometry = geometryOf(index);
            const on = activeLinks.has(index);
            return (
              <g key={index} opacity={activeLinks.size > 0 && !on ? DIMMED_OPACITY : 1}>
                <path d={geometry.path} fill="none" stroke={on ? tone.markerLine : idleLine} strokeWidth={on ? 7 : 4} strokeLinecap="round" />
                <path d={geometry.arrow} fill="none" stroke={on ? tone.markerLine : idleLine} strokeWidth={on ? 7 : 4} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })}
        </svg>
        {visual.nodes.map((node, index) => (
          <DiagramNode key={node.id} node={node} x={layout.x(index)} width={layout.nodeWidth} tone={tone} staticPreview={staticPreview} anyActive={anyActive}
            amount={activeNodes.has(node.id) ? 1 : 0} previousAmount={previousNodes ? (previousNodes.has(node.id) ? 1 : 0) : undefined} />
        ))}
        {visual.links.map((link, index) => {
          if (!link.label) return null;
          const geometry = geometryOf(index);
          const on = activeLinks.has(index);
          return (
            <div key={`label-${index}`} lang="ja" style={{position: 'absolute', left: geometry.label.x - geometry.label.width / 2, width: geometry.label.width, top: geometry.label.y, textAlign: 'center',
              fontSize: 30, lineHeight: 1.3, whiteSpace: 'nowrap', fontWeight: on ? 900 : 600, color: on ? tone.text : tone.sub, opacity: activeLinks.size > 0 && !on ? DIMMED_OPACITY : 1}}>
              {/* An opaque backing keeps the label readable where a group frame's edge runs through the gap. */}
              <span style={{background: tone.panel, borderRadius: 6, padding: '0 6px'}}>{link.label}</span>
            </div>
          );
        })}
        {packet && visual.links[packet.link] ? (() => {
          const link = visual.links[packet.link]!;
          const geometry = geometryOf(packet.link);
          const label = packet.label ?? '';
          const width = Math.max(64, 34 + Array.from(label).length * 26);
          const position = packetPosition(geometry, packet.reverse ? 1 - travel : travel, width, Math.abs(indexOf(link.from) - indexOf(link.to)) === 1);
          return (
            <div style={{position: 'absolute', left: position.x - width / 2, top: position.y - 26, width, height: 52, boxSizing: 'border-box', borderRadius: 26, display: 'grid', placeItems: 'center',
              background: tone.accent, color: tone.onAccent, fontSize: 25, fontWeight: 900, whiteSpace: 'nowrap', border: `3px solid ${tone.panel}`, boxShadow: `0 6px 18px rgba(0,0,0,0.3)`}}>{label}</div>
          );
        })() : null}
      </div>
    </Stage>
  );
};

interface NestItem {id: string; label: string; detail?: string; children?: NestItem[]}

const NestBox = ({item, depth, highlight, previousHighlight, tone, staticPreview}: {item: NestItem; depth: number; highlight: ReadonlySet<string>; previousHighlight: ReadonlySet<string> | undefined; tone: DiagramTone; staticPreview: boolean}) => {
  const amount = useAmount(highlight.has(item.id) ? 1 : 0, previousHighlight ? (previousHighlight.has(item.id) ? 1 : 0) : undefined, staticPreview);
  const labelSize = [46, 40, 34][depth] ?? 34;
  const detailSize = [31, 28, 26][depth] ?? 26;
  const children = item.children ?? [];
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: depth === 2 ? 4 : 14, boxSizing: 'border-box', minWidth: 0, borderRadius: 20 - depth * 4, padding: depth === 2 ? '26px 20px' : '22px 26px 26px', justifyContent: depth === 2 ? 'center' : 'flex-start',
      // Containment is drawn with nesting and borders; emphasis adds a ring and a tint without fading the rest.
      border: `3px solid ${amount > 0.5 ? tone.markerLine : depth === 0 ? tone.accent : tone.line}`,
      background: amount > 0 ? `color-mix(in srgb, ${tone.marker} ${(amount * 100).toFixed(0)}%, ${depth % 2 === 0 ? tone.panelAlt : tone.panel})` : (depth % 2 === 0 ? tone.panelAlt : tone.panel),
      boxShadow: amount > 0 ? `0 0 0 ${(amount * 3).toFixed(1)}px ${tone.markerLine}, 0 10px 26px rgba(0,0,0,${(0.2 * amount).toFixed(2)})` : 'none'}}>
      <div style={{display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap'}}>
        <span lang="ja" style={{fontSize: labelSize, fontWeight: 900, color: tone.text, lineHeight: 1.25}}>{item.label}</span>
        {item.detail ? <span lang="ja" style={{fontSize: detailSize, color: tone.sub, lineHeight: 1.35, ...phraseWrap}}>{item.detail}</span> : null}
      </div>
      {children.length ? (
        <div style={{display: 'grid', gridTemplateColumns: `repeat(${children.length}, minmax(0, 1fr))`, gap: 18 - depth * 4, flex: 1}}>
          {children.map((child) => <NestBox key={child.id} item={child} depth={depth + 1} highlight={highlight} previousHighlight={previousHighlight} tone={tone} staticPreview={staticPreview} />)}
        </div>
      ) : null}
    </div>
  );
};

export const NestTemplate = ({visual, previousVisual, tone, staticPreview = false, showTitle = true}: {visual: NestVisual; previousVisual?: SceneVisual | undefined; tone: DiagramTone; staticPreview?: boolean; showTitle?: boolean}) => {
  const previous = previousVisual?.type === 'nest' ? previousVisual : undefined;
  return (
    <Stage title={showTitle ? visual.title : undefined} note={visual.note} tone={tone}>
      <div style={{width: STAGE.width}}>
        <NestBox item={visual.root} depth={0} tone={tone} staticPreview={staticPreview} highlight={new Set(visual.highlight ?? [])} previousHighlight={previous ? new Set(previous.highlight ?? []) : undefined} />
      </div>
    </Stage>
  );
};

const TRACK = {labelWidth: 210, height: 124, gap: 22} as const;

const TimelineSegment = ({segment, left, width, amount, previousAmount, anyHighlight, shade, tone, staticPreview}: {segment: TimelineVisual['tracks'][number]['segments'][number]; left: number; width: number; amount: number; previousAmount: number | undefined; anyHighlight: number; shade: number; tone: DiagramTone; staticPreview: boolean}) => {
  const eased = useAmount(amount, previousAmount, staticPreview);
  const base = `color-mix(in srgb, ${tone.accent} ${shade}%, ${tone.panel})`;
  return (
    <div style={{position: 'absolute', left: left + 2, width: Math.max(8, width - 4), top: 0, bottom: 0, boxSizing: 'border-box', borderRadius: 12, display: 'grid', placeItems: 'center', overflow: 'hidden', padding: '0 8px',
      background: eased > 0 ? `color-mix(in srgb, ${tone.marker} ${(eased * 100).toFixed(0)}%, ${base})` : base,
      border: `2px solid ${eased > 0.5 ? tone.markerLine : tone.line}`,
      boxShadow: eased > 0 ? `inset 0 0 0 ${(eased * 3).toFixed(1)}px ${tone.markerLine}` : 'none',
      opacity: 1 - (1 - DIMMED_OPACITY) * anyHighlight * (1 - eased)}}>
      <span lang="ja" style={{fontSize: 33, fontWeight: eased > 0.5 ? 900 : 700, color: tone.text, whiteSpace: 'nowrap'}}>{segment.label}</span>
    </div>
  );
};

/** Tick positions: the given ones, or every segment boundary when none are given. */
export const timelineTicks = (visual: Pick<TimelineVisual, 'ticks' | 'tracks' | 'end'>): number[] => {
  const values = visual.ticks?.length ? visual.ticks : visual.tracks.flatMap((track) => track.segments.flatMap((segment) => [segment.start, segment.end]));
  return [...new Set(values)].filter((value) => value >= 0 && value <= visual.end).sort((a, b) => a - b).slice(0, 12);
};

export const TimelineTemplate = ({visual, previousVisual, tone, staticPreview = false, showTitle = true}: {visual: TimelineVisual; previousVisual?: SceneVisual | undefined; tone: DiagramTone; staticPreview?: boolean; showTitle?: boolean}) => {
  const frame = useCurrentFrame();
  const previous = previousVisual?.type === 'timeline' ? previousVisual : undefined;
  const axisWidth = STAGE.width - TRACK.labelWidth;
  const scale = (value: number) => (Math.max(0, Math.min(visual.end, value)) / visual.end) * axisWidth;
  const highlight = new Set(visual.highlight ?? []);
  const previousHighlight = previous ? new Set(previous.highlight ?? []) : undefined;
  const anyHighlight = useAmount(highlight.size > 0 ? 1 : 0, previous ? ((previous.highlight?.length ?? 0) > 0 ? 1 : 0) : undefined, staticPreview);
  const tracksHeight = visual.tracks.length * TRACK.height + (visual.tracks.length - 1) * TRACK.gap;
  const ticks = timelineTicks(visual);
  const cursorFrom = previous?.cursor ?? visual.cursor;
  const cursor = visual.cursor === undefined ? undefined
    : staticPreview || cursorFrom === undefined ? visual.cursor
    : interpolate(frame, [0, 14], [cursorFrom, visual.cursor], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const format = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}${visual.unit ?? ''}`;
  return (
    <Stage title={showTitle ? visual.title : undefined} note={visual.note} tone={tone}>
      {/* The top margin always leaves room for the cursor label, so a page keeps its layout when the cursor appears. */}
      <div style={{position: 'relative', width: STAGE.width, height: tracksHeight + 86, marginTop: 86}}>
        {visual.tracks.map((track, trackIndex) => (
          <div key={trackIndex} style={{position: 'absolute', left: 0, right: 0, top: trackIndex * (TRACK.height + TRACK.gap), height: TRACK.height}}>
            <div lang="ja" style={{position: 'absolute', left: 0, width: TRACK.labelWidth - 20, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 38, fontWeight: 900, color: tone.text}}>{track.label}</div>
            <div style={{position: 'absolute', left: TRACK.labelWidth, right: 0, top: 0, bottom: 0, borderRadius: 12, background: tone.panelAlt}}>
              {track.segments.map((segment) => (
                <TimelineSegment key={segment.id} segment={segment} tone={tone} staticPreview={staticPreview} anyHighlight={anyHighlight} shade={14 + (trackIndex % 3) * 9}
                  left={scale(segment.start)} width={scale(segment.end) - scale(segment.start)}
                  amount={highlight.has(segment.id) ? 1 : 0} previousAmount={previousHighlight ? (previousHighlight.has(segment.id) ? 1 : 0) : undefined} />
              ))}
            </div>
          </div>
        ))}
        <div style={{position: 'absolute', left: TRACK.labelWidth, right: 0, top: tracksHeight + 14, height: 3, background: tone.line}} />
        {ticks.map((tick) => (
          <React.Fragment key={tick}>
            <div style={{position: 'absolute', left: TRACK.labelWidth + scale(tick) - 1, top: -8, height: tracksHeight + 30, width: 2, background: tone.line, opacity: 0.7}} />
            <div style={{position: 'absolute', left: TRACK.labelWidth + scale(tick) - 80, width: 160, top: tracksHeight + 28, textAlign: 'center', fontSize: 28, fontWeight: 700, color: tone.text}}>{format(tick)}</div>
          </React.Fragment>
        ))}
        {cursor === undefined ? null : (
          <>
            <div style={{position: 'absolute', left: TRACK.labelWidth + scale(cursor) - 3, top: -40, height: tracksHeight + 62, width: 6, borderRadius: 3, background: tone.markerLine, opacity: 0.75}} />
            <div style={{position: 'absolute', left: TRACK.labelWidth + scale(cursor) - 90, width: 180, top: -78, textAlign: 'center', fontSize: 28, fontWeight: 900, color: tone.text}}>
              <span style={{background: tone.marker, borderRadius: 8, padding: '2px 12px', border: `2px solid ${tone.markerLine}`}}>{format(Math.round(cursor * 10) / 10)}</span>
            </div>
          </>
        )}
      </div>
    </Stage>
  );
};

/** Dispatch for the three diagram visuals. */
export const DiagramVisualTemplate = ({visual, previousVisual, tone, staticPreview = false, showTitle = true}: {visual: SceneVisual; previousVisual?: SceneVisual | undefined; tone: DiagramTone; staticPreview?: boolean; showTitle?: boolean}) => {
  switch (visual.type) {
    case 'diagram': return <DiagramTemplate visual={visual} previousVisual={previousVisual} tone={tone} staticPreview={staticPreview} showTitle={showTitle} />;
    case 'nest': return <NestTemplate visual={visual} previousVisual={previousVisual} tone={tone} staticPreview={staticPreview} showTitle={showTitle} />;
    case 'timeline': return <TimelineTemplate visual={visual} previousVisual={previousVisual} tone={tone} staticPreview={staticPreview} showTitle={showTitle} />;
    default: return null;
  }
};
