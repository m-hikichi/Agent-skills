import {readFile, rm} from 'node:fs/promises';
import {runProcess} from '../core/process.js';
import type {ResolvedScene, VideoProject} from '../shared/video-types.js';
import {deckGeometry, isCoverVisual, isDeckFrame} from './layout.js';

/**
 * Measured use of the deck card in a rendered storyboard still. The card is
 * white, so the last row that contains anything else is where the content
 * ends; everything below it is empty card.
 */
export interface LayoutMetric {
  sceneId: string;
  /** Share of the card height below the last drawn element (0 = filled to the bottom). */
  blankBottomRatio: number;
  /** Empty pixels at the bottom of the card on the 1080p canvas. */
  blankBottomPx: number;
}

/**
 * Reported when more than this share of the card is empty below the content.
 * In the reference sample the pages reviewers called half-empty measured
 * 0.33-0.45 and the pages they accepted stayed below 0.2.
 */
export const BLANK_BOTTOM_WARNING_RATIO = 0.3;

const SHRINK = 4;
const ffmpeg = () => process.env.FFMPEG_PATH ?? 'ffmpeg';

/** Last row (from the top) that is not blank card, or -1 for an entirely blank image. */
export const lastInkRow = (gray: Uint8Array, width: number, height: number): number => {
  // Averaged tints of light panels are about 250; pure card is 255.
  const inked = (value: number) => value < 253;
  for (let row = height - 1; row >= 0; row -= 1) {
    let count = 0;
    for (let column = 0; column < width; column += 1) if (inked(gray[row * width + column]!)) count += 1;
    // More than a few pixels, so a stray antialiased dot does not count as content.
    if (count >= 3) return row;
  }
  return -1;
};

export const measureDeckLayout = async (
  project: VideoProject,
  scenes: ReadonlyArray<Pick<ResolvedScene, 'id' | 'visual'>>,
  stills: readonly string[],
  signal?: AbortSignal,
): Promise<LayoutMetric[]> => {
  if (!isDeckFrame(project)) return [];
  const {card} = deckGeometry(project);
  // Stay inside the rounded corners and the drop shadow of the card.
  const inset = 16;
  const region = {x: card.left + inset, y: card.top + inset, width: 1920 - card.left - card.right - inset * 2, height: 1080 - card.top - card.bottom - inset * 2};
  const width = Math.floor(region.width / SHRINK);
  const height = Math.floor(region.height / SHRINK);
  const metrics: LayoutMetric[] = [];
  for (const [index, scene] of scenes.entries()) {
    const still = stills[index];
    if (!still || isCoverVisual(scene.visual)) continue;
    const raw = `${still}.gray`;
    try {
      await runProcess(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', still, '-vf', `crop=${region.width}:${region.height}:${region.x}:${region.y},scale=${width}:${height}:flags=area,format=gray`, '-frames:v', '1', '-f', 'rawvideo', raw], {
        timeoutMs: 60_000, category: 'render', ...(signal === undefined ? {} : {signal}),
      });
      const gray = await readFile(raw);
      if (gray.length < width * height) continue;
      const last = lastInkRow(gray, width, height);
      const blankRows = height - 1 - last;
      metrics.push({sceneId: scene.id, blankBottomRatio: Math.round((blankRows / height) * 1000) / 1000, blankBottomPx: blankRows * SHRINK});
    } finally {
      await rm(raw, {force: true});
    }
  }
  return metrics;
};

/** One finding per page that leaves a large part of the card empty. */
export const blankLayoutWarnings = (metrics: readonly LayoutMetric[]): Array<{sceneId: string; field: string; message: string; severity: 'warning'}> =>
  metrics.filter((metric) => metric.blankBottomRatio > BLANK_BOTTOM_WARNING_RATIO).map((metric) => ({
    sceneId: metric.sceneId,
    field: 'visual',
    severity: 'warning' as const,
    message: `カードの下${Math.round(metric.blankBottomRatio * 100)}%（約${metric.blankBottomPx}px）が空白です。slideのscale/alignで拡大・中央寄せにするか、図解に置き換える、関連内容を統合する、のいずれかで主役に面積を与えてください`,
  }));
