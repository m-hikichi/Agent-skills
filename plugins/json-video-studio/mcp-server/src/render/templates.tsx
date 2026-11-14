import React from 'react';
import {Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneVisual, VideoAsset, VideoProject} from '../shared/video-types.js';
import {CODE_PANEL, codeFontSize, metricPolylinePoints, type NavigationState} from './layout.js';
import {flowProgress} from './flow.js';
import {DiagramVisualTemplate, themeTone} from './diagrams.js';

export interface TemplateProps {
  visual: SceneVisual;
  project: VideoProject;
  assetUrls: Record<string, string>;
  staticPreview?: boolean;
  /** The previous scene showed the same layout: keep it in place and animate only emphasis. */
  continuing?: boolean;
  /** Visual of the previous scene when continuing, used to ease emphasis changes. */
  previousVisual?: SceneVisual;
}

const EMPHASIS_TRANSITION_FRAMES = 8;

/**
 * Break Japanese body text between phrases (Chromium's auto-phrase segmentation)
 * instead of in the middle of a word. Requires lang="ja" on the element.
 */
const phraseWrap = {wordBreak: 'auto-phrase', lineBreak: 'strict'} as unknown as React.CSSProperties;

/** Ease an emphasis weight from the previous scene's state to this scene's state. */
const useEmphasisWeight = (current: number, previous: number | undefined, staticPreview = false): number => {
  const frame = useCurrentFrame();
  if (staticPreview || previous === undefined || previous === current) return current;
  return interpolate(frame, [0, EMPHASIS_TRANSITION_FRAMES], [previous, current], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
};

/** 0 = dimmed, 0.5 = normal (nothing highlighted), 1 = highlighted. */
const emphasisLevel = (selected: readonly number[] | undefined, index: number): number => {
  if (!selected?.length) return 0.5;
  return selected.includes(index) ? 1 : 0;
};

// Items outside the emphasis stay readable (0.72 keeps light text on the dark panels well above 4.5:1).
const emphasisOpacity = (weight: number): number => (weight >= 0.5 ? 1 : 0.72 + weight * 0.56);
const emphasisStrength = (weight: number): number => Math.max(0, (weight - 0.5) * 2);

const withAlpha = (hex: string, alpha: number): string => {
  const value = hex.replace('#', '').slice(0, 6);
  const channel = (offset: number) => Number.parseInt(value.slice(offset, offset + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
};

const panel: React.CSSProperties = {
  background: 'rgba(10, 15, 29, 0.80)',
  border: '2px solid rgba(255,255,255,0.14)',
  borderRadius: 32,
  boxShadow: '0 28px 80px rgba(0,0,0,.28)',
};

const useEntrance = (staticPreview = false, continuing = false): React.CSSProperties => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (staticPreview || continuing) return {opacity: 1, transform: 'none'};
  const value = spring({frame, fps, config: {damping: 18, stiffness: 120}});
  return {
    opacity: interpolate(value, [0, 1], [0, 1]),
    transform: `translateY(${interpolate(value, [0, 1], [36, 0])}px)`,
  };
};

const Heading = ({children}: {children: React.ReactNode}) => (
  <h1 style={{fontSize: 78, lineHeight: 1.14, margin: 0, letterSpacing: '-0.035em'}}>{children}</h1>
);

const TitleTemplate = ({visual, staticPreview, continuing}: TemplateProps) => {
  if (visual.type !== 'title') return null;
  const entrance = useEntrance(staticPreview, continuing);
  return (
    <div style={{...entrance, textAlign: 'center', maxWidth: 1500}}>
      {/* No fixed brand line: the title page belongs to the video being made, not to this tool. */}
      <Heading>{visual.title}</Heading>
      {visual.subtitle ? <p style={{fontSize: 38, opacity: 0.8, margin: '28px 0 0'}}>{visual.subtitle}</p> : null}
    </div>
  );
};

const BulletItem = ({item, index, weight, previousWeight, entrance, project, staticPreview}: {item: string; index: number; weight: number; previousWeight: number | undefined; entrance: number; project: VideoProject; staticPreview?: boolean}) => {
  const eased = useEmphasisWeight(weight, previousWeight, staticPreview);
  const strength = emphasisStrength(eased);
  const accent = project.theme.accentColor;
  return (
    <div style={{...panel, opacity: entrance * emphasisOpacity(eased), display: 'flex', gap: 24, alignItems: 'center', padding: '22px 30px', fontSize: 38,
      border: `${2 + strength * 2}px solid ${strength > 0 ? withAlpha(accent, 0.25 + strength * 0.75) : 'rgba(255,255,255,0.14)'}`,
      background: strength > 0 ? withAlpha(accent, 0.08 + strength * 0.1) : panel.background}}>
      <span style={{display: 'grid', placeItems: 'center', flex: '0 0 auto', width: 48, height: 48, borderRadius: 24, background: accent, color: '#06101f', fontWeight: 900}}>{index + 1}</span>
      <span lang="ja" style={{fontWeight: strength > 0.5 ? 800 : 400, ...phraseWrap}}>{item}</span>
    </div>
  );
};

const BulletsTemplate = ({visual, project, staticPreview, continuing, previousVisual}: TemplateProps) => {
  if (visual.type !== 'bullets') return null;
  const frame = useCurrentFrame();
  const previous = continuing && previousVisual?.type === 'bullets' ? previousVisual : undefined;
  return (
    <div style={{width: 1500}}>
      {visual.title ? <Heading>{visual.title}</Heading> : null}
      <div style={{display: 'grid', gap: 20, marginTop: 46}}>
        {visual.items.map((item, index) => {
          const entrance = staticPreview || continuing ? 1 : interpolate(frame, [index * 5, index * 5 + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return <BulletItem key={`${index}-${item}`} item={item} index={index} entrance={entrance} project={project} staticPreview={staticPreview}
            weight={emphasisLevel(visual.highlight, index)} previousWeight={previous ? emphasisLevel(previous.highlight, index) : undefined} />;
        })}
      </div>
    </div>
  );
};

const SplitTemplate = ({visual, project, staticPreview, continuing}: TemplateProps) => {
  if (visual.type !== 'split') return null;
  const entrance = useEntrance(staticPreview, continuing);
  return (
    <div style={{...entrance, width: 1560, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 34}}>
      {[
        {title: visual.leftTitle ?? 'A', body: visual.left},
        {title: visual.rightTitle ?? 'B', body: visual.right},
      ].map((side, index) => (
        <div key={side.title} style={{...panel, padding: 44, minHeight: 480, borderTop: `8px solid ${index === 0 ? project.theme.accentColor : project.theme.foregroundColor}`}}>
          <h2 style={{fontSize: 40, margin: '0 0 26px', opacity: 0.78}}>{side.title}</h2>
          <div lang="ja" style={{fontSize: 42, lineHeight: 1.55, whiteSpace: 'pre-wrap', ...phraseWrap}}>{side.body}</div>
        </div>
      ))}
    </div>
  );
};

const resolveAsset = (project: VideoProject, assetId: string): VideoAsset | undefined =>
  project.assets.find((asset) => asset.id === assetId);

const MediaTemplate = ({visual, project, assetUrls}: TemplateProps) => {
  if (visual.type !== 'media') return null;
  const asset = resolveAsset(project, visual.assetId);
  const src = assetUrls[visual.assetId];
  const mediaStyle: React.CSSProperties = {width: '100%', height: '100%', objectFit: visual.fit ?? 'contain'};
  return (
    <div style={{...panel, width: 1500, height: 720, overflow: 'hidden', position: 'relative'}}>
      {src && asset?.type === 'video' ? <OffthreadVideo muted src={src} style={mediaStyle} /> : null}
      {src && asset?.type !== 'video' ? <Img src={src} style={mediaStyle} /> : null}
      {!src ? <div style={{display: 'grid', height: '100%', placeItems: 'center', fontSize: 42, opacity: 0.65}}>素材が見つかりません: {visual.assetId}</div> : null}
      {visual.caption ? <div style={{position: 'absolute', inset: 'auto 0 0', padding: '22px 34px', background: 'rgba(0,0,0,.72)', fontSize: 30}}>{visual.caption}</div> : null}
    </div>
  );
};

const CodeLine = ({line, number, variant, weight, previousWeight, accent, staticPreview}: {line: string; number: number; variant: string; weight: number; previousWeight: number | undefined; accent: string; staticPreview?: boolean}) => {
  const eased = useEmphasisWeight(weight, previousWeight, staticPreview);
  const strength = emphasisStrength(eased);
  return (
    <div style={{color: variant === 'diff' && line.startsWith('+') ? '#8ce99a' : variant === 'diff' && line.startsWith('-') ? '#ffa8a8' : undefined,
      opacity: emphasisOpacity(eased), fontWeight: strength > 0.5 ? 800 : undefined,
      background: strength > 0 ? withAlpha(accent, 0.22 * strength) : undefined,
      // The bar sits in the left padding of the block, so it never covers the line number.
      boxShadow: strength > 0 ? `${(-10 * strength).toFixed(1)}px 0 0 ${accent}` : undefined}}>
      <span style={{display: 'inline-block', width: '2.2em', opacity: 0.5, userSelect: 'none'}}>{number}</span>{line}
    </div>
  );
};

const CodeTemplate = ({visual, project, staticPreview, continuing, previousVisual}: TemplateProps) => {
  if (visual.type !== 'code') return null;
  const lines = visual.code.split(/\r?\n/u);
  const previous = continuing && previousVisual?.type === 'code' ? previousVisual : undefined;
  const lineLevel = (selected: readonly number[] | undefined, index: number) => emphasisLevel(selected?.map((value) => value - 1), index);
  return (
    <div style={{...panel, width: 1500, overflow: 'hidden'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '20px 30px', borderBottom: '1px solid rgba(255,255,255,.14)'}}>
        <span style={{width: 17, height: 17, borderRadius: 9, background: '#ff6b6b'}} />
        <span style={{width: 17, height: 17, borderRadius: 9, background: '#ffd43b'}} />
        <span style={{width: 17, height: 17, borderRadius: 9, background: '#69db7c'}} />
        <strong style={{marginLeft: 18, opacity: 0.74}}>{visual.title ?? visual.variant}</strong>
      </div>
      <pre style={{margin: 0, padding: '32px 40px', fontSize: codeFontSize(visual.code), lineHeight: CODE_PANEL.lineHeight, maxHeight: CODE_PANEL.textHeight, overflow: 'hidden', color: project.theme.foregroundColor}}>
        {lines.map((line, index) => (
          <CodeLine key={index} line={line} number={index + 1} variant={visual.variant} accent={project.theme.accentColor} staticPreview={staticPreview}
            weight={lineLevel(visual.highlightLines, index)} previousWeight={previous ? lineLevel(previous.highlightLines, index) : undefined} />
        ))}
      </pre>
    </div>
  );
};

const QuoteTemplate = ({visual, project, staticPreview, continuing}: TemplateProps) => {
  if (visual.type !== 'quote') return null;
  const entrance = useEntrance(staticPreview, continuing);
  return (
    <figure style={{...panel, ...entrance, maxWidth: 1450, padding: '70px 86px', margin: 0, borderLeft: `12px solid ${project.theme.accentColor}`}}>
      <blockquote style={{fontSize: 60, lineHeight: 1.42, margin: 0}}>“{visual.quote}”</blockquote>
      {visual.attribution ? <figcaption style={{fontSize: 30, opacity: 0.68, marginTop: 36, textAlign: 'right'}}>— {visual.attribution}</figcaption> : null}
    </figure>
  );
};

const MetricTemplate = ({visual, project}: TemplateProps) => {
  if (visual.type !== 'metric') return null;
  const values: number[] = Array.isArray(visual.values)
    ? visual.values.filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];
  return (
    <div style={{...panel, width: 1450, minHeight: 600, padding: 58}}>
      <h2 style={{fontSize: 42, opacity: 0.72, margin: 0}}>{visual.label}</h2>
      {visual.variant === 'number' ? <div style={{fontSize: 180, fontWeight: 900, color: project.theme.accentColor, marginTop: 70}}>{visual.value ?? '—'}</div> : null}
      {visual.variant === 'bar' ? (
        <div style={{display: 'flex', alignItems: 'end', gap: 26, height: 390, marginTop: 36}}>
          {values.map((value, index) => {
            const max = Math.max(1, ...values);
            return <div key={index} style={{flex: 1, height: `${Math.max(3, value / max * 100)}%`, background: project.theme.accentColor, borderRadius: '14px 14px 0 0', position: 'relative'}}><span style={{position: 'absolute', bottom: -42, width: '100%', textAlign: 'center', fontSize: 24}}>{visual.labels?.[index] ?? value}</span></div>;
          })}
        </div>
      ) : null}
      {visual.variant === 'line' ? (
        <svg width="1320" height="400" viewBox="0 0 1320 400" style={{marginTop: 42, overflow: 'visible'}}>
          <polyline points={metricPolylinePoints(values, 1320, 380)} fill="none" stroke={project.theme.accentColor} strokeWidth="12" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : null}
    </div>
  );
};

const OutroTemplate = ({visual, project, staticPreview, continuing}: TemplateProps) => {
  if (visual.type !== 'outro') return null;
  const entrance = useEntrance(staticPreview, continuing);
  return (
    <div style={{...entrance, textAlign: 'center', maxWidth: 1500}}>
      <div style={{width: 120, height: 10, background: project.theme.accentColor, borderRadius: 5, margin: '0 auto 45px'}} />
      <Heading>{visual.title}</Heading>
      {visual.subtitle ? <p style={{fontSize: 40, opacity: 0.74}}>{visual.subtitle}</p> : null}
    </div>
  );
};

const FlowTemplate = ({visual, project, staticPreview}: TemplateProps) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (visual.type !== 'flow') return null;
  const {progress, arrival} = flowProgress(frame, fps, staticPreview);
  const width = 1560;
  const nodeWidth = 300;
  const stride = (width - nodeWidth) / (visual.steps.length - 1);
  const center = (index: number) => nodeWidth / 2 + index * stride;
  const active = visual.activeStep;
  const accent = project.theme.accentColor;
  const tokenX = active === 0 ? center(0) : center(active - 1) + stride * progress;
  const tokenY = active === 0 ? 78 + 72 * progress : 150;
  const status = (index: number) => index < active ? '完了' : index === active ? (progress < 1 ? '受け取り中' : '処理中') : '待機';
  return (
    <div style={{width, height: 700, position: 'relative'}}>
      {visual.title ? <h1 style={{fontSize: 44, lineHeight: 1.2, margin: 0, textAlign: 'center'}}>{visual.title}</h1> : null}
      <svg width={width} height={220} style={{position: 'absolute', top: 0, left: 0, overflow: 'visible'}}>
        {visual.steps.slice(1).map((_, index) => {
          const start = center(index);
          const end = center(index + 1);
          const filled = index + 1 < active ? 1 : index + 1 === active ? progress : 0;
          return <g key={index}>
            <path d={`M ${start} 150 H ${end}`} fill="none" stroke="#64748B" strokeWidth={5} />
            <path d={`M ${end - 14} 140 L ${end} 150 L ${end - 14} 160`} fill="none" stroke="#94A3B8" strokeWidth={4} />
            {filled > 0 ? <path d={`M ${start} 150 H ${start + (end - start) * filled}`} fill="none" stroke={accent} strokeWidth={7} strokeLinecap="round" /> : null}
          </g>;
        })}
        {visual.steps.map((_, index) => <path key={index} d={`M ${center(index)} 150 V 210`} stroke={index <= active ? accent : '#64748B'} strokeWidth={4} fill="none" />)}
      </svg>
      <div style={{position: 'absolute', left: tokenX - 58, top: tokenY - 24, width: 116, height: 48, borderRadius: 12, background: '#F8FAFC', color: '#0F172A', border: `3px solid ${accent}`, display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 900, opacity: active === 0 ? Math.min(1, progress * 5) : 1, boxShadow: `0 0 ${12 + arrival * 18}px ${accent}`}}>データ</div>
      {visual.steps.map((step, index) => {
        const isActive = index === active;
        const complete = index < active;
        return <div key={index} style={{...panel, position: 'absolute', top: 210, left: index * stride, width: nodeWidth, height: 400, padding: '24px 24px', boxSizing: 'border-box', border: `3px solid ${isActive || complete ? accent : '#64748B'}`, background: isActive ? '#162B40' : '#0A0F1D', boxShadow: isActive ? `0 0 ${12 + arrival * 22}px ${accent}55` : 'none'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18}}>
            <span style={{fontSize: 28, fontWeight: 900, color: isActive || complete ? accent : '#CBD5E1'}}>{complete ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <span style={{fontSize: 23, color: '#E2E8F0'}}>{status(index)}</span>
          </div>
          <h2 style={{fontSize: 30, lineHeight: 1.3, margin: '0 0 14px', color: '#F8FAFC', overflowWrap: 'anywhere'}}>{step.title}</h2>
          {step.detail ? <div style={{fontSize: 23, lineHeight: 1.4, color: '#CBD5E1', overflowWrap: 'anywhere'}}>{step.detail}</div> : null}
        </div>;
      })}
      <div style={{position: 'absolute', top: 640, width: '100%', textAlign: 'center', fontSize: 30, color: '#E2E8F0'}}>
        {active === 0 ? '入力データを受け取る' : `${visual.steps[active - 1]!.title} → ${visual.steps[active]!.title}`}
      </div>
    </div>
  );
};

const TableCell = ({children, weight, previousWeight, header, project, staticPreview, align = 'center'}: {children: React.ReactNode; weight: number; previousWeight: number | undefined; header?: boolean; project: VideoProject; staticPreview?: boolean; align?: 'left' | 'center'}) => {
  const eased = useEmphasisWeight(weight, previousWeight, staticPreview);
  const strength = emphasisStrength(eased);
  const accent = project.theme.accentColor;
  return (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : 'center', padding: '0 22px', minHeight: header ? 74 : 88, borderRadius: 14,
      fontSize: header ? 32 : 38, fontWeight: header || strength > 0.5 ? 800 : 500, opacity: emphasisOpacity(eased), overflowWrap: 'anywhere', lineHeight: 1.25,
      color: header && strength > 0.5 ? '#06101f' : project.theme.foregroundColor,
      background: header ? (strength > 0 ? withAlpha(accent, 0.35 + strength * 0.65) : 'rgba(255,255,255,0.10)') : (strength > 0 ? withAlpha(accent, 0.12 + strength * 0.18) : 'rgba(10, 15, 29, 0.80)'),
      boxShadow: !header && strength > 0 ? `inset 0 0 0 ${2 + strength}px ${withAlpha(accent, 0.4 + strength * 0.6)}` : 'inset 0 0 0 1px rgba(255,255,255,0.10)'}}>
      {children}
    </div>
  );
};

/** A cell is emphasized when it lies on every highlighted axis that is specified. */
const tableCellLevel = (rows: readonly number[] | undefined, columns: readonly number[] | undefined, row: number, column: number): number => {
  const hasRows = Boolean(rows?.length);
  const hasColumns = Boolean(columns?.length);
  if (!hasRows && !hasColumns) return 0.5;
  const rowMatch = !hasRows || rows!.includes(row);
  const columnMatch = !hasColumns || columns!.includes(column);
  return rowMatch && columnMatch ? 1 : 0;
};

const TableTemplate = ({visual, project, staticPreview, continuing, previousVisual}: TemplateProps) => {
  if (visual.type !== 'table') return null;
  const entrance = useEntrance(staticPreview, continuing);
  const previous = continuing && previousVisual?.type === 'table' ? previousVisual : undefined;
  const headerLevel = (rows: readonly number[] | undefined, columns: readonly number[] | undefined, column: number) =>
    columns?.length ? (columns.includes(column) ? 1 : 0) : rows?.length ? 0.5 : 0.5;
  const labelLevel = (rows: readonly number[] | undefined, row: number) => (rows?.length ? (rows.includes(row) ? 1 : 0) : 0.5);
  const template = `minmax(260px, 1.25fr) repeat(${visual.columns.length}, minmax(0, 1fr))`;
  return (
    <div style={{...entrance, width: 1560}}>
      {visual.title ? <Heading>{visual.title}</Heading> : null}
      <div style={{display: 'grid', gridTemplateColumns: template, gap: 10, marginTop: visual.title ? 40 : 0}}>
        <div />
        {visual.columns.map((column, columnIndex) => (
          <TableCell key={`h-${columnIndex}`} header project={project} staticPreview={staticPreview}
            weight={headerLevel(visual.highlightRows, visual.highlightColumns, columnIndex)}
            previousWeight={previous ? headerLevel(previous.highlightRows, previous.highlightColumns, columnIndex) : undefined}>{column}</TableCell>
        ))}
        {visual.rows.map((row, rowIndex) => (
          <React.Fragment key={`r-${rowIndex}`}>
            <TableCell project={project} staticPreview={staticPreview} align="left"
              weight={labelLevel(visual.highlightRows, rowIndex)}
              previousWeight={previous ? labelLevel(previous.highlightRows, rowIndex) : undefined}>
              <span style={{fontSize: 32}}>{row.label}</span>
            </TableCell>
            {row.cells.map((cell, columnIndex) => (
              <TableCell key={`c-${rowIndex}-${columnIndex}`} project={project} staticPreview={staticPreview}
                weight={tableCellLevel(visual.highlightRows, visual.highlightColumns, rowIndex, columnIndex)}
                previousWeight={previous ? tableCellLevel(previous.highlightRows, previous.highlightColumns, rowIndex, columnIndex) : undefined}>{cell}</TableCell>
            ))}
          </React.Fragment>
        ))}
      </div>
      {visual.note ? <div style={{fontSize: 30, opacity: 0.78, marginTop: 26}}>{visual.note}</div> : null}
    </div>
  );
};

/** Split text into plain and emphasized runs; the first listed match wins at each position. */
export const emphasisRuns = (text: string, emphasis: readonly string[] = []): Array<{text: string; emphasized: boolean}> => {
  const terms = emphasis.filter((term) => term.length > 0);
  const runs: Array<{text: string; emphasized: boolean}> = [];
  let cursor = 0;
  while (cursor < text.length) {
    let next: {index: number; term: string} | undefined;
    for (const term of terms) {
      const index = text.indexOf(term, cursor);
      if (index >= 0 && (!next || index < next.index || (index === next.index && term.length > next.term.length))) next = {index, term};
    }
    if (!next) {
      runs.push({text: text.slice(cursor), emphasized: false});
      break;
    }
    if (next.index > cursor) runs.push({text: text.slice(cursor, next.index), emphasized: false});
    runs.push({text: next.term, emphasized: true});
    cursor = next.index + next.term.length;
  }
  return runs;
};

const StatementTemplate = ({visual, project, staticPreview, continuing}: TemplateProps) => {
  if (visual.type !== 'statement') return null;
  const entrance = useEntrance(staticPreview, continuing);
  const accent = project.theme.accentColor;
  return (
    <div style={{...panel, ...entrance, width: 1500, padding: '56px 72px', boxSizing: 'border-box', borderLeft: `14px solid ${accent}`}}>
      {visual.label || visual.title ? (
        <div style={{display: 'flex', alignItems: 'center', gap: 24, marginBottom: 34}}>
          {visual.label ? <span style={{fontSize: 30, fontWeight: 900, color: '#06101f', background: accent, borderRadius: 999, padding: '8px 26px'}}>{visual.label}</span> : null}
          {visual.title ? <span style={{fontSize: 46, fontWeight: 900}}>{visual.title}</span> : null}
        </div>
      ) : null}
      <div lang="ja" style={{fontSize: 52, lineHeight: 1.6, fontWeight: 500, ...phraseWrap}}>
        {emphasisRuns(visual.text, visual.emphasis).map((run, index) => run.emphasized
          ? <span key={index} style={{color: accent, fontWeight: 900}}>{run.text}</span>
          : <React.Fragment key={index}>{run.text}</React.Fragment>)}
      </div>
    </div>
  );
};

export const NavigationBar = ({state, project}: {state: NavigationState; project: VideoProject}) => {
  const accent = project.theme.accentColor;
  return (
    <div style={{position: 'absolute', left: 140, right: 140, top: 26, display: 'grid', gap: 12}}>
      <div style={{display: 'grid', gridTemplateColumns: `repeat(${state.groups.length}, minmax(0, 1fr))`, gap: 12}}>
        {state.groups.map((group, index) => {
          const current = group.status === 'current';
          const done = group.status === 'done';
          return (
            <div key={`${index}-${group.title}`} style={{display: 'flex', alignItems: 'center', gap: 12, height: 56, padding: '0 18px', borderRadius: 14, boxSizing: 'border-box',
              background: current ? accent : done ? 'rgba(255,255,255,0.10)' : 'rgba(10, 15, 29, 0.80)',
              border: `2px solid ${current ? accent : 'rgba(255,255,255,0.16)'}`,
              color: current ? '#06101f' : project.theme.foregroundColor, opacity: current ? 1 : done ? 0.82 : 0.62}}>
              <span style={{flex: '0 0 auto', display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 16, fontSize: 20, fontWeight: 900,
                background: current ? '#06101f' : done ? accent : 'rgba(255,255,255,0.16)', color: current ? accent : '#06101f'}}>{done ? '✓' : index + 1}</span>
              <span style={{fontSize: 24, fontWeight: current ? 900 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'clip'}}>{group.title}</span>
            </div>
          );
        })}
      </div>
      <div style={{height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.14)', overflow: 'hidden'}}>
        <div style={{width: `${(state.progress * 100).toFixed(2)}%`, height: '100%', background: accent}} />
      </div>
    </div>
  );
};

export const VisualTemplate = (props: TemplateProps) => {
  switch (props.visual.type) {
    case 'title': return <TitleTemplate {...props} />;
    case 'bullets': return <BulletsTemplate {...props} />;
    case 'split': return <SplitTemplate {...props} />;
    case 'media': return <MediaTemplate {...props} />;
    case 'code': return <CodeTemplate {...props} />;
    case 'quote': return <QuoteTemplate {...props} />;
    case 'metric': return <MetricTemplate {...props} />;
    case 'outro': return <OutroTemplate {...props} />;
    case 'flow': return <FlowTemplate {...props} />;
    case 'table': return <TableTemplate {...props} />;
    case 'statement': return <StatementTemplate {...props} />;
    case 'diagram':
    case 'nest':
    case 'timeline':
      return <DiagramVisualTemplate visual={props.visual} tone={themeTone(props.project)} staticPreview={props.staticPreview ?? false} previousVisual={props.continuing ? props.previousVisual : undefined} />;
    case 'slide': return null;
  }
};
