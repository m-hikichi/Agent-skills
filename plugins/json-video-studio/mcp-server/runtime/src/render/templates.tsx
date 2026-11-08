import React from 'react';
import {Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneVisual, VideoAsset, VideoProject} from '../shared/video-types.js';
import {metricPolylinePoints} from './layout.js';
import {flowProgress} from './flow.js';

export interface TemplateProps {
  visual: SceneVisual;
  project: VideoProject;
  assetUrls: Record<string, string>;
  staticPreview?: boolean;
}

const panel: React.CSSProperties = {
  background: 'rgba(10, 15, 29, 0.80)',
  border: '2px solid rgba(255,255,255,0.14)',
  borderRadius: 32,
  boxShadow: '0 28px 80px rgba(0,0,0,.28)',
};

const useEntrance = (staticPreview = false): React.CSSProperties => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (staticPreview) return {opacity: 1, transform: 'none'};
  const value = spring({frame, fps, config: {damping: 18, stiffness: 120}});
  return {
    opacity: interpolate(value, [0, 1], [0, 1]),
    transform: `translateY(${interpolate(value, [0, 1], [36, 0])}px)`,
  };
};

const Heading = ({children}: {children: React.ReactNode}) => (
  <h1 style={{fontSize: 78, lineHeight: 1.14, margin: 0, letterSpacing: '-0.035em'}}>{children}</h1>
);

const TitleTemplate = ({visual, staticPreview}: TemplateProps) => {
  if (visual.type !== 'title') return null;
  const entrance = useEntrance(staticPreview);
  return (
    <div style={{...entrance, textAlign: 'center', maxWidth: 1500}}>
      <div style={{fontSize: 24, fontWeight: 800, letterSpacing: '.22em', opacity: 0.7}}>JSON VIDEO STUDIO</div>
      <Heading>{visual.title}</Heading>
      {visual.subtitle ? <p style={{fontSize: 38, opacity: 0.8, margin: '28px 0 0'}}>{visual.subtitle}</p> : null}
    </div>
  );
};

const BulletsTemplate = ({visual, project, staticPreview}: TemplateProps) => {
  if (visual.type !== 'bullets') return null;
  const frame = useCurrentFrame();
  return (
    <div style={{width: 1500}}>
      {visual.title ? <Heading>{visual.title}</Heading> : null}
      <div style={{display: 'grid', gap: 20, marginTop: 46}}>
        {visual.items.map((item, index) => {
          const opacity = staticPreview ? 1 : interpolate(frame, [index * 5, index * 5 + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return (
            <div key={`${index}-${item}`} style={{...panel, opacity, display: 'flex', gap: 24, alignItems: 'center', padding: '22px 30px', fontSize: 38}}>
              <span style={{display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: 24, background: project.theme.accentColor, color: '#06101f', fontWeight: 900}}>{index + 1}</span>
              <span>{item}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SplitTemplate = ({visual, project, staticPreview}: TemplateProps) => {
  if (visual.type !== 'split') return null;
  const entrance = useEntrance(staticPreview);
  return (
    <div style={{...entrance, width: 1560, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 34}}>
      {[
        {title: visual.leftTitle ?? 'A', body: visual.left},
        {title: visual.rightTitle ?? 'B', body: visual.right},
      ].map((side, index) => (
        <div key={side.title} style={{...panel, padding: 44, minHeight: 480, borderTop: `8px solid ${index === 0 ? project.theme.accentColor : project.theme.foregroundColor}`}}>
          <h2 style={{fontSize: 40, margin: '0 0 26px', opacity: 0.78}}>{side.title}</h2>
          <div style={{fontSize: 42, lineHeight: 1.55, whiteSpace: 'pre-wrap'}}>{side.body}</div>
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

const CodeTemplate = ({visual, project}: TemplateProps) => {
  if (visual.type !== 'code') return null;
  const lines = visual.code.split(/\r?\n/u);
  return (
    <div style={{...panel, width: 1500, overflow: 'hidden'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '20px 30px', borderBottom: '1px solid rgba(255,255,255,.14)'}}>
        <span style={{width: 17, height: 17, borderRadius: 9, background: '#ff6b6b'}} />
        <span style={{width: 17, height: 17, borderRadius: 9, background: '#ffd43b'}} />
        <span style={{width: 17, height: 17, borderRadius: 9, background: '#69db7c'}} />
        <strong style={{marginLeft: 18, opacity: 0.74}}>{visual.title ?? visual.variant}</strong>
      </div>
      <pre style={{margin: 0, padding: '32px 40px', fontSize: 29, lineHeight: 1.42, maxHeight: 650, overflow: 'hidden', color: project.theme.foregroundColor}}>
        {lines.map((line, index) => (
          <div key={index} style={{color: visual.variant === 'diff' && line.startsWith('+') ? '#8ce99a' : visual.variant === 'diff' && line.startsWith('-') ? '#ffa8a8' : undefined}}>
            <span style={{display: 'inline-block', width: 52, opacity: 0.34, userSelect: 'none'}}>{index + 1}</span>{line}
          </div>
        ))}
      </pre>
    </div>
  );
};

const QuoteTemplate = ({visual, project, staticPreview}: TemplateProps) => {
  if (visual.type !== 'quote') return null;
  const entrance = useEntrance(staticPreview);
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

const OutroTemplate = ({visual, project, staticPreview}: TemplateProps) => {
  if (visual.type !== 'outro') return null;
  const entrance = useEntrance(staticPreview);
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
  }
};
