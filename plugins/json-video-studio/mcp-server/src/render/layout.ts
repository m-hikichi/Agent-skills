import type {
  ProjectLock,
  ResolvedScene,
  Scene,
  SceneVisual,
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

export interface SceneContinuity {
  /** The previous scene shows the same layout, so this scene must not fade or re-enter. */
  fromPrevious: boolean;
  /** The next scene shows the same layout, so this scene must not fade out. */
  toNext: boolean;
}

/**
 * Keep the usual eight-frame fades, without invalid interpolation ranges on short scenes.
 * Edges shared with a scene that keeps the same layout stay fully opaque.
 */
export const sceneOpacity = (
  frame: number,
  durationInFrames: number,
  continuity: SceneContinuity = {fromPrevious: false, toNext: false},
): number => {
  if (durationInFrames <= 2) return 1;
  const fadeFrames = Math.min(8, Math.floor((durationInFrames - 1) / 2));
  const fadeIn = continuity.fromPrevious ? 1 : frame / fadeFrames;
  const fadeOut = continuity.toNext ? 1 : (durationInFrames - frame) / fadeFrames;
  return Math.max(0, Math.min(1, fadeIn, fadeOut));
};

/**
 * Page changes cut to the next page with a short fade-in: the outgoing page
 * stays fully readable until its last frame, and the incoming page is readable
 * within PAGE_FADE_IN_FRAMES of its narration starting. Only the final scene of
 * the video fades out.
 */
export const PAGE_FADE_IN_FRAMES = 5;
export const pageOpacity = (
  frame: number,
  durationInFrames: number,
  continuity: SceneContinuity = {fromPrevious: false, toNext: false},
  finalScene = false,
): number => {
  if (durationInFrames <= 2) return 1;
  const fadeIn = continuity.fromPrevious ? 1 : (frame + 1) / Math.min(PAGE_FADE_IN_FRAMES, Math.max(1, Math.floor((durationInFrames - 1) / 2)));
  const fadeOut = finalScene ? (durationInFrames - frame) / Math.min(8, Math.floor((durationInFrames - 1) / 2)) : 1;
  return Math.max(0, Math.min(1, fadeIn, fadeOut));
};

const EMPHASIS_KEYS = new Set(['highlight', 'highlightRows', 'highlightColumns', 'emphasis', 'highlightLines', 'active', 'cursor']);

/**
 * Layout identity of a visual: equal keys mean the same panels appear in the
 * same place and only the emphasis differs. Flow keeps its own per-step motion.
 */
export const visualLayoutKey = (visual: SceneVisual): string | undefined => {
  if (visual.type === 'flow') return undefined;
  return JSON.stringify(visual, (key, value: unknown) => (EMPHASIS_KEYS.has(key) ? undefined : value));
};

export const sceneContinuity = (scenes: readonly Pick<ResolvedScene, 'visual'>[]): SceneContinuity[] => {
  const keys = scenes.map((scene) => visualLayoutKey(scene.visual));
  return keys.map((key, index) => ({
    fromPrevious: key !== undefined && index > 0 && keys[index - 1] === key,
    toNext: key !== undefined && index < keys.length - 1 && keys[index + 1] === key,
  }));
};

/** 1-based page number of each scene: a page continues while the layout stays the same. */
export const scenePageNumbers = (scenes: readonly Pick<ResolvedScene, 'visual'>[]): number[] => {
  const continuity = sceneContinuity(scenes);
  let page = 0;
  return continuity.map((edge) => {
    if (!edge.fromPrevious) page += 1;
    return page;
  });
};

/** Geometry of the deck frame on the 1920x1080 canvas. */
export const DECK_FRAME = {
  card: {left: 44, top: 30, right: 44, bottom: 206},
  subtitleTop: 886,
  subtitleWidth: 1680,
  footerTop: 1006,
  footerHeight: 56,
  progressHeight: 8,
} as const;

export const isDeckFrame = (project: Pick<VideoProject, 'theme'>): boolean => project.theme.frame?.style === 'deck';

export type DeckFooterMode = 'full' | 'progress' | 'none';
export const deckFooterMode = (project: Pick<VideoProject, 'theme'>): DeckFooterMode => project.theme.frame?.footer ?? 'full';

/**
 * Deck geometry for the chosen footer mode. Without the footer row the card
 * and the subtitle take over its 64px instead of leaving an empty band.
 */
export const deckGeometry = (project: Pick<VideoProject, 'theme'>) => {
  const mode = deckFooterMode(project);
  const fontSize = project.theme.subtitleStyle?.fontSize ?? 48;
  const maxLines = project.theme.subtitleStyle?.maxLines ?? 2;
  // The subtitle box is sized for its font and line limit, and the card ends
  // just above it, so a larger subtitle never runs into the footer.
  const subtitleHeight = Math.ceil(fontSize * 1.25) * maxLines + 24;
  const chromeTop = mode === 'full' ? DECK_FRAME.footerTop : 1080 - DECK_FRAME.progressHeight - 6;
  const subtitleTop = chromeTop - 10 - subtitleHeight;
  return {
    mode,
    card: {...DECK_FRAME.card, bottom: 1080 - subtitleTop + 12},
    subtitleTop,
    subtitleHeight,
    subtitleWidth: DECK_FRAME.subtitleWidth,
  };
};

/** Visuals that the deck frame draws on the white card with the slide header (light tone). */
export const isDeckDiagramVisual = (visual: SceneVisual): boolean =>
  visual.type === 'diagram' || visual.type === 'nest' || visual.type === 'timeline';

export interface SubtitleCue {
  text: string;
  /** Frames relative to the scene start; endFrame is exclusive. */
  startFrame: number;
  endFrame: number;
}

/** Characters that fit one subtitle line; wide characters count 1 and ASCII 0.5 (see estimateTextLines). */
export const subtitleLineUnits = (project: Pick<VideoProject, 'theme'>): number => {
  const fontSize = project.theme.subtitleStyle?.fontSize ?? 48;
  const usableWidth = isDeckFrame(project) ? DECK_FRAME.subtitleWidth - 60 : 1540 - 68;
  return Math.max(8, Math.floor(usableWidth / fontSize));
};

/**
 * Font size of the full-screen code visual. Short snippets are drawn large
 * instead of leaving small text in an empty panel; long ones shrink to fit the
 * panel width and height. In the bundled monospace font an ASCII character is
 * about 0.6em wide and a wide character 1em; the line-number column is 2.2em.
 */
export const CODE_PANEL = {textWidth: 1400, textHeight: 650, lineHeight: 1.42, minFont: 22, maxFont: 46} as const;
export const codeFontSize = (code: string): number => {
  const lines = code.split(/\r?\n/u);
  // 0.62em per ASCII character: emphasized lines are drawn bold, which is slightly wider.
  const widest = Math.max(1, ...lines.map((line) => Array.from(line).reduce((sum, character) => sum + (/[　-ヿ㐀-鿿豈-﫿＀-￯]/u.test(character) ? 1 : 0.62), 0)));
  const byWidth = CODE_PANEL.textWidth / (widest + 2.2);
  const byHeight = CODE_PANEL.textHeight / (lines.length * CODE_PANEL.lineHeight);
  return Math.round(Math.max(CODE_PANEL.minFont, Math.min(CODE_PANEL.maxFont, byWidth, byHeight)));
};

export const textUnits = (text: string): number => Array.from(text).reduce((sum, character) => sum + (/[　-ヿ㐀-鿿豈-﫿＀-￯]/u.test(character) ? 1 : 0.5), 0);

/**
 * Split a subtitle into sentence cues when it does not fit on one line.
 * Sentences are kept whole; neighbours are merged while they still fit one
 * line, and a sentence longer than the line limit is cut at the comma nearest
 * its middle. Returns a single element when no split is needed or possible.
 */
export const splitSubtitle = (text: string, lineUnits: number, maxLines = 2): string[] => {
  const whole = text.trim();
  if (!whole || whole.includes('\n') || textUnits(whole) <= lineUnits) return [whole];
  const sentences = whole.match(/[^。！？!?]+[。！？!?]*[」』）)]*/gu)?.map((part) => part.trim()).filter(Boolean) ?? [whole];
  const pieces = sentences.flatMap((sentence) => {
    if (textUnits(sentence) <= lineUnits * maxLines) return [sentence];
    const commas = [...sentence.matchAll(/、/gu)].map((match) => match.index + 1).filter((index) => index < sentence.length);
    if (!commas.length) return [sentence];
    const middle = sentence.length / 2;
    const cut = commas.reduce((best, index) => (Math.abs(index - middle) < Math.abs(best - middle) ? index : best));
    return [sentence.slice(0, cut).trim(), sentence.slice(cut).trim()];
  });
  const cues: string[] = [];
  for (const piece of pieces) {
    const last = cues.at(-1);
    if (last !== undefined && textUnits(last) + textUnits(piece) <= lineUnits) cues[cues.length - 1] = `${last}${piece}`;
    else cues.push(piece);
  }
  return cues.length > 12 ? [whole] : cues;
};

/**
 * Time cues inside the spoken part of a scene in proportion to their weights
 * (measured speech length when available, otherwise character count).
 */
export const timeSubtitleCues = (texts: readonly string[], weights: readonly number[], speakingFrames: number): SubtitleCue[] | undefined => {
  if (texts.length < 2 || speakingFrames < texts.length * 6) return undefined;
  const safe = texts.map((text, index) => Math.max(1e-6, Number.isFinite(weights[index]) && weights[index]! > 0 ? weights[index]! : textUnits(text)));
  const total = safe.reduce((sum, value) => sum + value, 0);
  let consumed = 0;
  let start = 0;
  return texts.map((text, index) => {
    consumed += safe[index]!;
    const end = index === texts.length - 1 ? speakingFrames : Math.max(start + 1, Math.round((consumed / total) * speakingFrames));
    const cue = {text, startFrame: start, endFrame: end};
    start = end;
    return cue;
  });
};

/** Subtitle text to show at a frame of the scene; the last cue stays until the scene ends. */
export const subtitleAtFrame = (scene: Pick<ResolvedScene, 'subtitleText'> & {subtitleCues?: readonly SubtitleCue[] | undefined}, frame: number, staticPreview = false): string => {
  const cues = scene.subtitleCues;
  if (!cues?.length) return scene.subtitleText;
  // A still preview shows the longest cue: that is the one most likely to overflow.
  if (staticPreview) return cues.reduce((longest, cue) => (textUnits(cue.text) > textUnits(longest.text) ? cue : longest)).text;
  return (cues.find((cue) => frame < cue.endFrame) ?? cues.at(-1)!).text;
};

/** Cover pages use the full gradient instead of the white card. */
export const isCoverVisual = (visual: SceneVisual): boolean => visual.type === 'title' || visual.type === 'outro';

export interface NavigationState {
  groups: Array<{title: string; status: 'done' | 'current' | 'upcoming'}>;
  /** 0..1 position of the frame within the whole video. */
  progress: number;
}

/** Vertical space reserved above the visual area when the chapter bar is shown. */
export const NAVIGATION_BAR_HEIGHT = 112;

export const navigationState = (
  project: VideoProject,
  sectionId: string,
  frame: number,
  totalFrames: number,
): NavigationState | undefined => {
  const groups = project.navigation?.groups;
  if (!groups?.length) return undefined;
  const sectionOrder = project.sections.map((section) => section.id);
  const position = sectionOrder.indexOf(sectionId);
  const currentGroup = groups.findIndex((group) => group.sectionIds.includes(sectionId));
  return {
    groups: groups.map((group, index) => {
      if (index === currentGroup) return {title: group.title, status: 'current' as const};
      const starts = group.sectionIds.map((id) => sectionOrder.indexOf(id)).filter((value) => value >= 0);
      const groupStart = starts.length ? Math.min(...starts) : Number.POSITIVE_INFINITY;
      return {title: group.title, status: groupStart < position ? 'done' as const : 'upcoming' as const};
    }),
    progress: totalFrames > 0 ? Math.max(0, Math.min(1, frame / totalFrames)) : 0,
  };
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
      // A subtitle that is split into cues is judged by its longest cue, as it is shown.
      const shown = (project.theme.subtitleStyle?.split ?? 'auto') === 'auto' ? splitSubtitle(subtitle, subtitleLineUnits(project), subtitleMaxLines) : [subtitle];
      if (shown.some((cue) => estimateTextLines(cue, 1540, subtitleFontSize) > subtitleMaxLines)) {
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
  warnings.push(...shortPageWarnings(project));
  return warnings;
};

/** Pages (runs of scenes sharing one layout) shorter than this read as hurried flipping. */
export const MIN_PAGE_SECONDS = 10;

/**
 * Warn about pages that would stay on screen only briefly. Durations are
 * estimated from the narration length like the preview timeline, so this runs
 * before resolve; cover pages (title/outro) are exempt.
 */
export const shortPageWarnings = (project: VideoProject): LayoutWarning[] => {
  // The 20-40 second page guideline is for deck (document-style) videos; a short
  // how-to or a scene-by-scene video changes its picture more often on purpose.
  if (!isDeckFrame(project)) return [];
  const scenes = buildPreviewScenes(project);
  const continuity = sceneContinuity(scenes);
  const warnings: LayoutWarning[] = [];
  let pageStart = 0;
  for (let index = 0; index < scenes.length; index += 1) {
    if (continuity[index]?.toNext) continue;
    const first = scenes[pageStart]!;
    const frames = scenes.slice(pageStart, index + 1).reduce((sum, scene) => sum + scene.durationInFrames, 0);
    const seconds = frames / project.canvas.fps;
    if (!isCoverVisual(first.visual) && seconds < MIN_PAGE_SECONDS) {
      warnings.push({
        sceneId: first.id,
        field: 'visual',
        message: `このページの表示は約${Math.round(seconds)}秒です。関連する内容を1ページにまとめ、sceneごとに強調だけを切り替えてください（目安20〜40秒）`,
        severity: 'warning',
      });
    }
    pageStart = index + 1;
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
