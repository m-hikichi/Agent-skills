import React from 'react';
import {Img, interpolate, useCurrentFrame} from 'remotion';
import type {SceneVisual, VideoProject} from '../shared/video-types.js';
import {DECK_FRAME, type NavigationState} from './layout.js';

export interface DeckPalette {
  gradientStart: string;
  gradientEnd: string;
  primary: string;
  dark: string;
  light: string;
  text: string;
  marker: string;
}

/** Brand-neutral defaults; a project supplies its own colors in theme.frame.palette. */
export const NEUTRAL_DECK_PALETTE: DeckPalette = {
  gradientStart: '#6A8BA8',
  gradientEnd: '#34506B',
  primary: '#2F6FA3',
  dark: '#1F3B57',
  light: '#DCE8F3',
  text: '#333333',
  marker: '#FFE699',
};

export const deckPalette = (project: Pick<VideoProject, 'theme'>): DeckPalette => ({...NEUTRAL_DECK_PALETTE, ...(project.theme.frame?.palette ?? {})});

/** CSS custom properties consumed by every deck component (set once on the frame root). */
export const deckVariables = (project: Pick<VideoProject, 'theme'>): React.CSSProperties => {
  const palette = deckPalette(project);
  return {
    '--deck-gradient-start': palette.gradientStart,
    '--deck-gradient-end': palette.gradientEnd,
    '--deck-primary': palette.primary,
    '--deck-dark': palette.dark,
    '--deck-light': palette.light,
    '--deck-text': palette.text,
    '--deck-marker': palette.marker,
  } as React.CSSProperties;
};

/** Derived tokens; all resolve through the CSS variables above. */
export const DECK = {
  text: 'var(--deck-text)',
  textSub: 'color-mix(in srgb, var(--deck-text) 70%, #ffffff)',
  main: 'var(--deck-primary)',
  dark: 'var(--deck-dark)',
  darkMid: 'color-mix(in srgb, var(--deck-dark) 80%, var(--deck-primary))',
  light: 'var(--deck-light)',
  lighter: 'color-mix(in srgb, var(--deck-light) 45%, #ffffff)',
  line: 'color-mix(in srgb, var(--deck-light) 70%, #8C9AA8)',
  marker: 'var(--deck-marker)',
  markerLine: 'color-mix(in srgb, var(--deck-marker) 55%, #C98A00)',
  gradient: 'linear-gradient(135deg, var(--deck-gradient-start) 0%, var(--deck-gradient-end) 100%)',
  rule: 'linear-gradient(90deg, var(--deck-gradient-start) 0%, var(--deck-primary) 100%)',
} as const;

const phraseWrap = {wordBreak: 'auto-phrase', lineBreak: 'strict', whiteSpace: 'pre-wrap'} as unknown as React.CSSProperties;

type SlideVisual = Extract<SceneVisual, {type: 'slide'}>;
type SlideBlock = SlideVisual['blocks'][number];

const TRANSITION_FRAMES = 8;

/** Ease an emphasis weight (0 dimmed, 0.5 neutral, 1 highlighted) from the previous scene. */
const useWeight = (current: number, previous: number | undefined, staticPreview: boolean): number => {
  const frame = useCurrentFrame();
  if (staticPreview || previous === undefined || previous === current) return current;
  return interpolate(frame, [0, TRANSITION_FRAMES], [previous, current], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
};

const level = (selected: readonly number[] | undefined, index: number): number => {
  if (!selected?.length) return 0.5;
  return selected.includes(index) ? 1 : 0;
};
const dimOpacity = (weight: number): number => (weight >= 0.5 ? 1 : 0.5 + weight);
const strengthOf = (weight: number): number => Math.max(0, (weight - 0.5) * 2);

/** Split text into runs, marking every occurrence of the emphasized terms. */
export const markRuns = (text: string, terms: readonly string[] = []): Array<{text: string; marked: boolean}> => {
  const active = terms.filter(Boolean);
  const runs: Array<{text: string; marked: boolean}> = [];
  let cursor = 0;
  while (cursor < text.length) {
    let next: {index: number; term: string} | undefined;
    for (const term of active) {
      const index = text.indexOf(term, cursor);
      if (index >= 0 && (!next || index < next.index || (index === next.index && term.length > next.term.length))) next = {index, term};
    }
    if (!next) { runs.push({text: text.slice(cursor), marked: false}); break; }
    if (next.index > cursor) runs.push({text: text.slice(cursor, next.index), marked: false});
    runs.push({text: next.term, marked: true});
    cursor = next.index + next.term.length;
  }
  return runs;
};

const Marked = ({text, terms, previousTerms, staticPreview}: {text: string; terms?: readonly string[]; previousTerms?: readonly string[] | undefined; staticPreview: boolean}) => {
  const frame = useCurrentFrame();
  const reveal = staticPreview || previousTerms === undefined ? 1 : interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <>{markRuns(text, terms).map((run, index) => {
    if (!run.marked) return <React.Fragment key={index}>{run.text}</React.Fragment>;
    const wasMarked = previousTerms?.includes(run.text) ?? false;
    const amount = wasMarked ? 1 : reveal;
    return <span key={index} style={{color: DECK.darkMid, fontWeight: 800, backgroundImage: `linear-gradient(transparent 58%, ${DECK.marker} 58%)`, backgroundSize: `${(amount * 100).toFixed(1)}% 100%`, backgroundRepeat: 'no-repeat'}}>{run.text}</span>;
  })}</>;
};

const Label = ({children}: {children: React.ReactNode}) => (
  <span style={{display: 'inline-block', fontSize: 26, fontWeight: 800, color: '#fff', background: DECK.dark, borderRadius: 6, padding: '4px 14px', marginRight: 14, verticalAlign: 'middle'}}>{children}</span>
);

const BlockHeading = ({children}: {children: React.ReactNode}) => (
  <div style={{fontSize: 30, fontWeight: 800, color: DECK.darkMid, marginBottom: 12}}>{children}</div>
);

interface BlockProps<K extends SlideBlock['kind']> {
  block: Extract<SlideBlock, {kind: K}>;
  previous?: Extract<SlideBlock, {kind: K}> | undefined;
  staticPreview: boolean;
}

const TextBlock = ({block, previous, staticPreview}: BlockProps<'text'>) => (
  <div style={{border: `2px solid ${DECK.line}`, borderRadius: 12, padding: '22px 30px', background: '#fff', height: '100%', boxSizing: 'border-box'}}>
    {block.label || block.heading ? (
      <div style={{marginBottom: 14, display: 'flex', alignItems: 'center'}}>
        {block.label ? <Label>{block.label}</Label> : null}
        {block.heading ? <span style={{fontSize: 32, fontWeight: 800, color: DECK.darkMid}}>{block.heading}</span> : null}
      </div>
    ) : null}
    <div lang="ja" style={{fontSize: 36, lineHeight: 1.6, color: DECK.text, ...phraseWrap}}>
      <Marked text={block.text} terms={block.emphasis} previousTerms={previous ? (previous.emphasis ?? []) : undefined} staticPreview={staticPreview} />
    </div>
  </div>
);

const CalloutBlock = ({block, previous, staticPreview}: BlockProps<'callout'>) => (
  <div lang="ja" style={{background: DECK.light, borderLeft: `8px solid ${DECK.main}`, padding: '20px 32px', fontSize: 34, lineHeight: 1.6, color: DECK.text, ...phraseWrap}}>
    <Marked text={block.text} terms={block.emphasis} previousTerms={previous ? (previous.emphasis ?? []) : undefined} staticPreview={staticPreview} />
  </div>
);

const cellLevel = (rows: readonly number[] | undefined, columns: readonly number[] | undefined, row: number, column: number): number => {
  const hasRows = Boolean(rows?.length);
  const hasColumns = Boolean(columns?.length);
  if (!hasRows && !hasColumns) return 0.5;
  return (!hasRows || rows!.includes(row)) && (!hasColumns || columns!.includes(column)) ? 1 : 0;
};

const TableCell = ({children, weight, previousWeight, staticPreview, zebra, label = false}: {children: React.ReactNode; weight: number; previousWeight: number | undefined; staticPreview: boolean; zebra: boolean; label?: boolean}) => {
  const eased = useWeight(weight, previousWeight, staticPreview);
  const strength = strengthOf(eased);
  const base = zebra ? DECK.light : '#FFFFFF';
  return (
    <div lang="ja" style={{display: 'flex', alignItems: 'center', justifyContent: label ? 'flex-start' : 'center', padding: '8px 22px', minHeight: 66, boxSizing: 'border-box',
      background: strength > 0 ? `color-mix(in srgb, ${DECK.marker} ${(strength * 100).toFixed(0)}%, ${base})` : base,
      boxShadow: strength > 0 ? `inset 0 0 0 ${(strength * 3).toFixed(1)}px ${DECK.markerLine}` : 'none',
      borderBottom: `1px solid ${DECK.line}`,
      fontSize: label ? 32 : 36, fontWeight: label || strength > 0.5 ? 800 : 500,
      color: label ? DECK.darkMid : DECK.text, opacity: dimOpacity(eased), ...phraseWrap}}>
      {children}
    </div>
  );
};

const TableHeader = ({children, weight, previousWeight, staticPreview, first = false}: {children: React.ReactNode; weight: number; previousWeight: number | undefined; staticPreview: boolean; first?: boolean}) => {
  const eased = useWeight(weight, previousWeight, staticPreview);
  const strength = strengthOf(eased);
  return (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: first ? 'flex-start' : 'center', padding: '10px 22px', minHeight: 60, boxSizing: 'border-box',
      background: strength > 0 ? DECK.main : DECK.dark, color: '#fff', fontSize: 30, fontWeight: 800,
      borderLeft: first ? 'none' : '1px solid rgba(255,255,255,0.18)'}}>{children}</div>
  );
};

const TableBlock = ({block, previous, staticPreview}: BlockProps<'table'>) => {
  const columnLevel = (columns: readonly number[] | undefined, index: number) => (columns?.length ? (columns.includes(index) ? 1 : 0) : 0.5);
  const rowLevel = (rows: readonly number[] | undefined, index: number) => (rows?.length ? (rows.includes(index) ? 1 : 0) : 0.5);
  return (
    <div>
      {block.heading ? <BlockHeading>{block.heading}</BlockHeading> : null}
      <div style={{display: 'grid', gridTemplateColumns: `minmax(220px, 1.3fr) repeat(${block.columns.length}, minmax(0, 1fr))`, border: `1px solid ${DECK.line}`, borderRadius: 4, overflow: 'hidden'}}>
        <TableHeader first weight={0.5} previousWeight={undefined} staticPreview={staticPreview}>{block.labelHeader ?? ''}</TableHeader>
        {block.columns.map((column, index) => (
          <TableHeader key={`h-${index}`} weight={columnLevel(block.highlightColumns, index) === 1 ? 1 : 0.5}
            previousWeight={previous ? (columnLevel(previous.highlightColumns, index) === 1 ? 1 : 0.5) : undefined} staticPreview={staticPreview}>{column}</TableHeader>
        ))}
        {block.rows.map((row, rowIndex) => (
          <React.Fragment key={`r-${rowIndex}`}>
            <TableCell label zebra={rowIndex % 2 === 1} staticPreview={staticPreview}
              weight={rowLevel(block.highlightRows, rowIndex)} previousWeight={previous ? rowLevel(previous.highlightRows, rowIndex) : undefined}>{row.label}</TableCell>
            {row.cells.map((cell, columnIndex) => (
              <TableCell key={`c-${rowIndex}-${columnIndex}`} zebra={rowIndex % 2 === 1} staticPreview={staticPreview}
                weight={cellLevel(block.highlightRows, block.highlightColumns, rowIndex, columnIndex)}
                previousWeight={previous ? cellLevel(previous.highlightRows, previous.highlightColumns, rowIndex, columnIndex) : undefined}>{cell}</TableCell>
            ))}
          </React.Fragment>
        ))}
      </div>
      {block.note ? <div lang="ja" style={{fontSize: 26, color: DECK.textSub, marginTop: 10, ...phraseWrap}}>{block.note}</div> : null}
    </div>
  );
};

const Card = ({item, weight, previousWeight, staticPreview}: {item: {title: string; body: string; note?: string}; weight: number; previousWeight: number | undefined; staticPreview: boolean}) => {
  const eased = useWeight(weight, previousWeight, staticPreview);
  const strength = strengthOf(eased);
  return (
    <div style={{display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', background: '#fff', opacity: dimOpacity(eased),
      // Constant border width: emphasis is an outer ring, so the text never rewraps.
      border: `2px solid ${strength > 0 ? DECK.markerLine : DECK.line}`,
      boxShadow: strength > 0 ? `0 0 0 ${(strength * 3).toFixed(1)}px ${DECK.markerLine}, 0 10px 26px rgba(0, 0, 0, ${(0.25 * strength).toFixed(2)})` : 'none'}}>
      <div style={{background: DECK.dark, color: '#fff', fontSize: 32, fontWeight: 800, textAlign: 'center', padding: '14px 18px'}}>{item.title}</div>
      <div lang="ja" style={{padding: '20px 26px', fontSize: 33, lineHeight: 1.55, color: DECK.text, flex: 1, ...phraseWrap}}>{item.body}</div>
      {item.note ? <div lang="ja" style={{margin: '0 18px 18px', background: DECK.lighter, borderRadius: 8, padding: '12px 16px', fontSize: 26, color: DECK.darkMid, fontWeight: 700, ...phraseWrap}}>{item.note}</div> : null}
    </div>
  );
};

const CardsBlock = ({block, previous, staticPreview}: BlockProps<'cards'>) => (
  <div style={{display: 'grid', gridTemplateColumns: `repeat(${block.items.length}, minmax(0, 1fr))`, gap: 24, height: '100%'}}>
    {block.items.map((item, index) => <Card key={index} item={item} staticPreview={staticPreview} weight={level(block.highlight, index)} previousWeight={previous ? level(previous.highlight, index) : undefined} />)}
  </div>
);

const Kpi = ({item, weight, previousWeight, staticPreview}: {item: {label: string; value: string; note?: string}; weight: number; previousWeight: number | undefined; staticPreview: boolean}) => {
  const eased = useWeight(weight, previousWeight, staticPreview);
  const strength = strengthOf(eased);
  return (
    <div style={{background: DECK.lighter, borderRadius: 10, padding: '22px 28px', opacity: dimOpacity(eased), boxShadow: strength > 0 ? `inset 0 0 0 ${(strength * 4).toFixed(1)}px ${DECK.markerLine}` : 'none'}}>
      <div lang="ja" style={{fontSize: 28, fontWeight: 800, color: DECK.darkMid, ...phraseWrap}}>{item.label}</div>
      <div lang="ja" style={{fontSize: 58, fontWeight: 900, color: DECK.text, lineHeight: 1.25, marginTop: 6, ...phraseWrap}}>{item.value}</div>
      {item.note ? <div lang="ja" style={{fontSize: 27, color: DECK.textSub, marginTop: 6, ...phraseWrap}}>{item.note}</div> : null}
    </div>
  );
};

const KpisBlock = ({block, previous, staticPreview}: BlockProps<'kpis'>) => (
  <div style={{display: 'grid', gridTemplateColumns: `repeat(${block.items.length}, minmax(0, 1fr))`, gap: 20}}>
    {block.items.map((item, index) => <Kpi key={index} item={item} staticPreview={staticPreview} weight={level(block.highlight, index)} previousWeight={previous ? level(previous.highlight, index) : undefined} />)}
  </div>
);

const ListItem = ({text, weight, previousWeight, staticPreview}: {text: string; weight: number; previousWeight: number | undefined; staticPreview: boolean}) => {
  const eased = useWeight(weight, previousWeight, staticPreview);
  const strength = strengthOf(eased);
  return (
    <div style={{display: 'flex', gap: 16, alignItems: 'baseline', padding: '8px 14px', borderRadius: 8, opacity: dimOpacity(eased),
      background: strength > 0 ? `color-mix(in srgb, ${DECK.marker} ${(strength * 100).toFixed(0)}%, transparent)` : 'transparent'}}>
      <span style={{flex: '0 0 auto', width: 12, height: 12, borderRadius: 6, background: DECK.main, transform: 'translateY(-4px)'}} />
      <span lang="ja" style={{fontSize: 34, lineHeight: 1.5, color: DECK.text, fontWeight: strength > 0.5 ? 800 : 500, ...phraseWrap}}>{text}</span>
    </div>
  );
};

const ListBlock = ({block, previous, staticPreview}: BlockProps<'list'>) => (
  <div style={{background: DECK.lighter, borderRadius: 12, padding: '22px 24px', height: '100%', boxSizing: 'border-box'}}>
    {block.heading ? <BlockHeading>{block.heading}</BlockHeading> : null}
    <div style={{display: 'grid', gap: 4}}>
      {block.items.map((item, index) => <ListItem key={index} text={item} staticPreview={staticPreview} weight={level(block.highlight, index)} previousWeight={previous ? level(previous.highlight, index) : undefined} />)}
    </div>
  </div>
);

const Step = ({item, index, weight, previousWeight, staticPreview}: {item: {title: string; detail?: string}; index: number; weight: number; previousWeight: number | undefined; staticPreview: boolean}) => {
  const eased = useWeight(weight, previousWeight, staticPreview);
  const strength = strengthOf(eased);
  const filled = strength > 0.5;
  return (
    <div style={{border: `2px solid ${filled ? DECK.main : DECK.line}`, borderRadius: 10, padding: '14px 18px', opacity: dimOpacity(eased),
      background: filled ? DECK.main : '#fff', color: filled ? '#fff' : DECK.text}}>
      <div style={{fontSize: 31, fontWeight: 900, color: filled ? '#fff' : DECK.darkMid}}>
        <span style={{fontSize: 24, marginRight: 10, opacity: 0.85}}>第{index + 1}章</span>{item.title}
      </div>
      {item.detail ? <div lang="ja" style={{fontSize: 26, marginTop: 6, ...phraseWrap}}>{item.detail}</div> : null}
    </div>
  );
};

const StepsBlock = ({block, previous, staticPreview}: BlockProps<'steps'>) => (
  <div style={{display: 'grid', gridTemplateColumns: `repeat(${Math.min(block.items.length, 3)}, minmax(0, 1fr))`, gap: 16}}>
    {block.items.map((item, index) => <Step key={index} item={item} index={index} staticPreview={staticPreview} weight={level(block.highlight, index)} previousWeight={previous ? level(previous.highlight, index) : undefined} />)}
  </div>
);

const SlideBlockView = ({block, previous, staticPreview}: {block: SlideBlock; previous: SlideBlock | undefined; staticPreview: boolean}) => {
  const same = previous?.kind === block.kind ? previous : undefined;
  switch (block.kind) {
    case 'text': return <TextBlock block={block} previous={same as typeof block | undefined} staticPreview={staticPreview} />;
    case 'callout': return <CalloutBlock block={block} previous={same as typeof block | undefined} staticPreview={staticPreview} />;
    case 'table': return <TableBlock block={block} previous={same as typeof block | undefined} staticPreview={staticPreview} />;
    case 'cards': return <CardsBlock block={block} previous={same as typeof block | undefined} staticPreview={staticPreview} />;
    case 'kpis': return <KpisBlock block={block} previous={same as typeof block | undefined} staticPreview={staticPreview} />;
    case 'list': return <ListBlock block={block} previous={same as typeof block | undefined} staticPreview={staticPreview} />;
    case 'steps': return <StepsBlock block={block} previous={same as typeof block | undefined} staticPreview={staticPreview} />;
  }
};

/** Header (tag chip + title + gradient rule) and the 12-column block grid of a slide page. */
export const SlideTemplate = ({visual, previousVisual, staticPreview = false}: {visual: SceneVisual; previousVisual?: SceneVisual | undefined; staticPreview?: boolean}) => {
  if (visual.type !== 'slide') return null;
  const previous = previousVisual?.type === 'slide' ? previousVisual : undefined;
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: 'inherit', color: DECK.text}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 22, padding: '20px 40px 16px'}}>
        {visual.tag ? <span style={{flex: '0 0 auto', fontSize: 32, fontWeight: 800, color: '#fff', background: DECK.darkMid, borderRadius: 6, padding: '6px 20px'}}>{visual.tag}</span> : null}
        <span lang="ja" style={{fontSize: 46, fontWeight: 900, color: DECK.text, lineHeight: 1.2, letterSpacing: '-0.01em', ...phraseWrap}}>{visual.title}</span>
      </div>
      <div style={{height: 4, background: DECK.rule}} />
      <div style={{flex: 1, padding: '26px 40px 26px', display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 24, alignContent: 'start', alignItems: 'stretch'}}>
        {visual.blocks.map((block, index) => (
          <div key={index} style={{gridColumn: `span ${block.span ?? 12}`, minWidth: 0}}>
            <SlideBlockView block={block} previous={previous?.blocks[index]} staticPreview={staticPreview} />
          </div>
        ))}
      </div>
    </div>
  );
};

/** Cover page: gradient with the title, and a white band at the bottom for the logo. */
export const DeckCover = ({visual, project, assetUrls}: {visual: SceneVisual; project: VideoProject; assetUrls: Record<string, string>}) => {
  if (visual.type !== 'title' && visual.type !== 'outro') return null;
  const frame = project.theme.frame;
  const mark = frame?.coverMarkAssetId ? assetUrls[frame.coverMarkAssetId] : undefined;
  const logo = frame?.coverLogoAssetId ? assetUrls[frame.coverLogoAssetId] : undefined;
  return (
    <div style={{position: 'absolute', inset: 0}}>
      <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: '85.66%', background: DECK.gradient}} />
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: '14.34%', background: '#fff'}} />
      {mark ? <Img src={mark} style={{position: 'absolute', left: 84, top: 72, height: 96}} /> : null}
      {logo ? <Img src={logo} style={{position: 'absolute', right: 70, bottom: 26, height: 100}} /> : null}
      <div style={{position: 'absolute', left: 120, right: 120, top: 250, textAlign: 'center', color: '#fff'}}>
        <div lang="ja" style={{fontSize: 84, fontWeight: 900, lineHeight: 1.25, ...phraseWrap}}>{visual.title}</div>
        {visual.subtitle ? <div lang="ja" style={{fontSize: 40, fontWeight: 700, marginTop: 30, opacity: 0.96, ...phraseWrap}}>{visual.subtitle}</div> : null}
        {frame?.coverCaption ? <div lang="ja" style={{fontSize: 30, marginTop: 44, opacity: 0.9}}>{frame.coverCaption}</div> : null}
      </div>
    </div>
  );
};

/** Bottom chrome: logo + copyright (left), chapter chips (center), page number (right) and a progress line. */
export const DeckFooter = ({project, assetUrls, navigation, page, progress}: {project: VideoProject; assetUrls: Record<string, string>; navigation?: NavigationState | undefined; page: number; progress: number}) => {
  const frame = project.theme.frame;
  const logo = frame?.footerLogoAssetId ? assetUrls[frame.footerLogoAssetId] : undefined;
  const {footerTop, footerHeight, progressHeight} = DECK_FRAME;
  return (
    <>
      <div style={{position: 'absolute', left: 44, right: 44, top: footerTop, height: footerHeight, display: 'flex', alignItems: 'center', gap: 24, color: '#fff'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 16, flex: '0 0 auto', width: 470}}>
          {logo ? <Img src={logo} style={{height: 34}} /> : null}
          {frame?.footerText ? <span style={{fontSize: 21, whiteSpace: 'nowrap'}}>{frame.footerText}</span> : null}
        </div>
        <div style={{flex: 1, display: 'flex', gap: 8, justifyContent: 'center'}}>
          {navigation?.groups.map((group, index) => {
            const current = group.status === 'current';
            const done = group.status === 'done';
            return (
              <div key={`${index}-${group.title}`} style={{display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 14px', borderRadius: 20, boxSizing: 'border-box',
                background: current ? '#fff' : done ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)',
                color: current ? DECK.dark : '#fff', fontSize: 20, fontWeight: current ? 900 : 700, opacity: current || done ? 1 : 0.8, whiteSpace: 'nowrap'}}>
                <span>{done ? '✓' : index + 1}</span>
                <span>{group.title}</span>
              </div>
            );
          })}
        </div>
        <div style={{flex: '0 0 auto', width: 120, textAlign: 'right', fontSize: 34, fontWeight: 800}}>{page}</div>
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: progressHeight, background: 'rgba(0,0,0,0.22)'}}>
        <div style={{width: `${(progress * 100).toFixed(2)}%`, height: '100%', background: '#fff'}} />
      </div>
    </>
  );
};

/** 1280x720 thumbnail in the cover style: gradient, white text lines and the cover logo on a white band. */
export const DeckThumbnail = ({project, assetUrls}: {project: VideoProject; assetUrls: Record<string, string>}) => {
  const frame = project.theme.frame;
  const logo = frame?.coverLogoAssetId ? assetUrls[frame.coverLogoAssetId] : undefined;
  const mark = frame?.coverMarkAssetId ? assetUrls[frame.coverMarkAssetId] : undefined;
  return (
    <div style={{position: 'absolute', inset: 0, fontFamily: 'Noto Sans CJK JP', ...deckVariables(project)}}>
      <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: '82%', background: DECK.gradient}} />
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: '18%', background: '#fff'}} />
      {mark ? <Img src={mark} style={{position: 'absolute', left: 46, top: 40, height: 70}} /> : null}
      {logo ? <Img src={logo} style={{position: 'absolute', right: 44, bottom: 22, height: 84}} /> : null}
      <div style={{position: 'absolute', left: 60, right: 60, top: 150, bottom: '20%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', color: '#fff'}}>
        {project.thumbnail.textLines.map((line, index) => (
          <div key={line} lang="ja" style={{fontSize: index === 0 ? 64 : 96, fontWeight: 900, lineHeight: 1.15, marginTop: index ? 18 : 0,
            color: index === 0 ? DECK.marker : '#fff', textShadow: '0 6px 24px rgba(0, 0, 0, 0.35)', ...phraseWrap}}>{line}</div>
        ))}
      </div>
    </div>
  );
};
