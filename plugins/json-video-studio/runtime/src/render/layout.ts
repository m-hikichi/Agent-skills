import type {
  ProjectLock,
  ResolvedScene,
  Scene,
  VideoProject,
} from '../shared/video-types.js';
import type {CSSProperties} from 'react';

export interface LayoutWarning {
  sceneId: string;
  field: string;
  message: string;
  severity: 'warning' | 'error';
}

export type PreviewScene = ResolvedScene;

/** Keep the usual eight-frame fades, without invalid interpolation ranges on short scenes. */
export const sceneOpacity = (frame: number, durationInFrames: number): number => {
  if (durationInFrames <= 2) return 1;
  const fadeFrames = Math.min(8, Math.floor((durationInFrames - 1) / 2));
  return Math.max(0, Math.min(1, frame / fadeFrames, (durationInFrames - frame) / fadeFrames));
};

/** Fit the full 16:9 image below a separate label in each of the twelve cells. */
export const storyboardCellLayout = (width: number, height: number) => {
  const cellWidth = (width - 56 - 36) / 3;
  const cellHeight = (height - 56 - 54) / 4;
  const labelHeight = 30;
  const scale = Math.min(cellWidth / 1920, (cellHeight - labelHeight) / 1080);
  return {cellWidth, cellHeight, labelHeight, scale, left: (cellWidth - 1920 * scale) / 2, top: labelHeight + (cellHeight - labelHeight - 1080 * scale) / 2};
};

export interface SubtitleLayoutStyles {
  box: CSSProperties;
  text: CSSProperties;
  minBoxHeightPx: number;
  maxBoxHeightPx: number;
  textHeightPx: number;
}

/**
 * Produces the exact bounded subtitle styles used by the Remotion renderer.
 * The outer box keeps the legacy one-line dimensions, grows only as far as
 * the configured line limit, and clips paint. The inner box wraps long tokens
 * and applies Chromium's line clamp as a second containment boundary.
 */
export const createSubtitleLayoutStyles = (
  fontSizePx: number,
  maxLines: 1 | 2,
): SubtitleLayoutStyles => {
  const lineHeightPx = Math.ceil(fontSizePx * 1.25);
  const textHeightPx = lineHeightPx * maxLines;
  const verticalPaddingPx = 36;
  // The previous renderer used a 92px content-box minimum plus 36px padding.
  // Preserve that 128px one-line footprint so existing golden frames remain
  // stable while giving a two-line subtitle a strict upper boundary.
  const minBoxHeightPx = 92 + verticalPaddingPx;
  const maxBoxHeightPx = Math.max(minBoxHeightPx, textHeightPx + verticalPaddingPx);

  return {
    minBoxHeightPx,
    maxBoxHeightPx,
    textHeightPx,
    box: {
      minHeight: minBoxHeightPx,
      maxHeight: maxBoxHeightPx,
      padding: '18px 34px',
      boxSizing: 'border-box',
      display: 'grid',
      placeItems: 'center',
      overflow: 'hidden',
      contain: 'paint',
    },
    text: {
      width: '100%',
      maxWidth: '100%',
      maxHeight: textHeightPx,
      display: '-webkit-box',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: maxLines,
      overflow: 'hidden',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
      whiteSpace: 'pre-wrap',
      textOverflow: 'clip',
      lineHeight: `${lineHeightPx}px`,
    },
  };
};

const JAPANESE_WIDE_CHARACTER = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;

export const estimateTextLines = (
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
): number => {
  if (text.length === 0) return 0;
  const averageCharacterWidth = fontSizePx * 0.56;
  const explicitLines = text.split(/\r?\n/u);
  return explicitLines.reduce((total, line) => {
    const units = Array.from(line).reduce(
      (sum, character) => sum + (JAPANESE_WIDE_CHARACTER.test(character) ? 1 : 0.5),
      0,
    );
    return total + Math.max(1, Math.ceil((units * fontSizePx) / Math.max(maxWidthPx, averageCharacterWidth)));
  }, 0);
};

export const collectLayoutWarnings = (project: VideoProject): LayoutWarning[] => {
  const warnings: LayoutWarning[] = [];
  const subtitleFontSize = project.theme.subtitleStyle?.fontSize ?? 48;
  const subtitleMaxLines = project.theme.subtitleStyle?.maxLines ?? 2;

  for (const section of project.sections) {
    for (const scene of section.scenes) {
      const subtitle = scene.subtitle ?? scene.text ?? '';
      if (estimateTextLines(subtitle, 1540, subtitleFontSize) > subtitleMaxLines) {
        warnings.push({
          sceneId: scene.id,
          field: 'subtitle',
          message: `字幕が${subtitleMaxLines}行を超える可能性があります`,
          severity: 'warning',
        });
      }

      const visual = scene.visual;
      if ('title' in visual && typeof visual.title === 'string' && estimateTextLines(visual.title, 1500, 86) > 3) {
        warnings.push({
          sceneId: scene.id,
          field: 'visual.title',
          message: 'タイトルが3行を超える可能性があります',
          severity: 'warning',
        });
      }
      if (visual.type === 'bullets' && visual.items.length > 7) {
        warnings.push({
          sceneId: scene.id,
          field: 'visual.items',
          message: '箇条書きは7項目以下を推奨します',
          severity: 'warning',
        });
      }
      if (visual.type === 'code' && visual.code.split(/\r?\n/u).length > 24) {
        warnings.push({
          sceneId: scene.id,
          field: 'visual.code',
          message: 'コードが24行を超え、画面からはみ出す可能性があります',
          severity: 'warning',
        });
      }
    }
  }
  return warnings;
};

const previewDuration = (scene: Scene, fps: number): number => {
  const milliseconds = scene.durationMs ?? Math.max(2_500, (scene.text?.length ?? 8) * 150);
  return Math.max(1, Math.ceil(((milliseconds + (scene.holdAfterMs ?? 0)) / 1_000) * fps));
};

export const buildPreviewScenes = (project: VideoProject): PreviewScene[] => {
  let startFrame = 0;
  return project.sections.flatMap((section) =>
    section.scenes.map((scene) => {
      const durationInFrames = previewDuration(scene, project.canvas.fps);
      const resolved: PreviewScene = {
        ...scene,
        sectionId: section.id,
        sectionTitle: section.title,
        startFrame,
        durationInFrames,
        audioDurationMs: scene.durationMs ?? 0,
        subtitleText: scene.subtitle ?? scene.text ?? '',
        ...(scene.audioAssetId ? {resolvedAudioAssetId: scene.audioAssetId} : {}),
      };
      startFrame += durationInFrames;
      return resolved;
    }),
  );
};

export const effectiveScenes = (project: VideoProject, lock?: ProjectLock): ResolvedScene[] =>
  lock?.scenes.length ? lock.scenes : buildPreviewScenes(project);

export const effectiveDurationInFrames = (project: VideoProject, lock?: ProjectLock): number => {
  if (lock && lock.totalFrames > 0) return lock.totalFrames;
  const scenes = buildPreviewScenes(project);
  const finalScene = scenes.at(-1);
  return finalScene ? finalScene.startFrame + finalScene.durationInFrames : 1;
};

export const clampVolume = (volume: number | undefined, fallback = 1): number =>
  Math.max(0, Math.min(1, volume ?? fallback));

export const metricPolylinePoints = (
  values: number[],
  width: number,
  height: number,
): string => {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
};
