import {access, copyFile, mkdir, mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import type {ProjectLock} from '../shared/video-types.js';
import {sceneContinuity} from '../render/layout.js';
import {AppError} from './errors.js';
import {readJson} from './fs-safe.js';
import {runProcess} from './process.js';

/** Frames sampled inside each scene: shortly after entry, the middle, and shortly before the end. */
export const sceneSampleFrames = (startFrame: number, durationInFrames: number): [number, number, number] => {
  const last = startFrame + Math.max(0, durationInFrames - 1);
  const clamp = (frame: number) => Math.min(last, Math.max(startFrame, frame));
  return [clamp(startFrame + 2), clamp(startFrame + Math.floor(durationInFrames / 2)), clamp(last - 2)];
};

/** Offsets around a scene boundary used to see whether a continuing page fades or re-enters. */
export const BOUNDARY_OFFSETS = [-6, -3, -1, 0, 1, 3, 6] as const;

export interface ReviewFramePlan {
  scenes: Array<{sceneId: string; frames: [number, number, number]}>;
  boundaries: Array<{beforeSceneId: string; afterSceneId: string; boundaryFrame: number; frames: number[]}>;
  uniqueFrames: number[];
}

export const planReviewFrames = (lock: Pick<ProjectLock, 'scenes' | 'totalFrames'>): ReviewFramePlan => {
  const lastFrame = Math.max(0, lock.totalFrames - 1);
  const scenes = lock.scenes.map((scene) => ({sceneId: scene.id, frames: sceneSampleFrames(scene.startFrame, scene.durationInFrames)}));
  const continuity = sceneContinuity(lock.scenes);
  const boundaries = lock.scenes.flatMap((scene, index) => {
    if (index === 0 || !continuity[index]?.fromPrevious) return [];
    const previous = lock.scenes[index - 1]!;
    return [{
      beforeSceneId: previous.id,
      afterSceneId: scene.id,
      boundaryFrame: scene.startFrame,
      frames: BOUNDARY_OFFSETS.map((offset) => Math.min(lastFrame, Math.max(0, scene.startFrame + offset))),
    }];
  });
  const uniqueFrames = [...new Set([...scenes.flatMap((item) => item.frames), ...boundaries.flatMap((item) => item.frames)])].sort((a, b) => a - b);
  return {scenes, boundaries, uniqueFrames};
};

const ffmpeg = () => process.env.FFMPEG_PATH ?? 'ffmpeg';
// FFmpeg's expression parser recurses per `+` term, so keep each select short.
const SELECT_CHUNK = 24;

/** Extract the given frame numbers as 640x360 PNGs named `f<frame>.png`. */
const extractFrames = async (video: string, frames: readonly number[], directory: string, signal?: AbortSignal) => {
  for (let offset = 0; offset < frames.length; offset += SELECT_CHUNK) {
    const chunk = frames.slice(offset, offset + SELECT_CHUNK);
    const staging = await mkdtemp(join(directory, '.chunk-'));
    const expression = chunk.map((frame) => `eq(n\\,${frame})`).join('+');
    await runProcess(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `select=${expression},scale=640:360`, '-fps_mode', 'passthrough', join(staging, '%05d.png')], {
      timeoutMs: 600_000, category: 'render', ...(signal === undefined ? {} : {signal}),
    });
    const written = (await readdir(staging)).filter((name) => name.endsWith('.png')).sort();
    if (written.length !== chunk.length) {
      throw new AppError('FRAME_EXTRACT_MISMATCH', `Expected ${chunk.length} frames but FFmpeg wrote ${written.length}.`, {category: 'render'});
    }
    for (const [index, name] of written.entries()) await rename(join(staging, name), join(directory, `f${chunk[index]}.png`));
    await rm(staging, {recursive: true, force: true});
  }
};

/** Tile ordered images into sheets of columns x rows, padding the last sheet with a blank cell. */
const tileSheets = async (cells: readonly string[], columns: number, rows: number, workDirectory: string, prefix: string, signal?: AbortSignal): Promise<string[]> => {
  const perSheet = columns * rows;
  const blank = join(workDirectory, 'blank.png');
  try {
    await access(blank);
  } catch {
    await runProcess(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=640x360', '-frames:v', '1', blank], {timeoutMs: 60_000, category: 'render'});
  }
  const sheets: string[] = [];
  for (let start = 0, page = 1; start < cells.length; start += perSheet, page += 1) {
    const staging = await mkdtemp(join(workDirectory, '.tile-'));
    const pageCells = cells.slice(start, start + perSheet);
    for (let index = 0; index < perSheet; index += 1) await copyFile(pageCells[index] ?? blank, join(staging, `${String(index + 1).padStart(4, '0')}.png`));
    const output = join(workDirectory, `${prefix}-${String(page).padStart(3, '0')}.png`);
    await runProcess(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-framerate', '1', '-i', join(staging, '%04d.png'), '-vf', `tile=${columns}x${rows}:padding=8:margin=8:color=white`, '-frames:v', '1', output], {
      timeoutMs: 120_000, category: 'render', ...(signal === undefined ? {} : {signal}),
    });
    await rm(staging, {recursive: true, force: true});
    sheets.push(output);
  }
  return sheets;
};

export interface ReviewFramesResult {
  directory: string;
  index: string;
  sceneSheets: Array<{path: string; scenes: string[]; layout: string}>;
  boundarySheets: Array<{path: string; boundaries: Array<{beforeSceneId: string; afterSceneId: string; boundaryFrame: number}>; layout: string}>;
  frameCount: number;
  continuingBoundaries: number;
}

/**
 * Sample a rendered MP4 for the final visual review: three frames per scene and
 * seven frames around every boundary where the same layout continues. Output
 * goes to .json-video-work/<project-id>/final-frames/<lock-hash>/ so the
 * immutable render directory and its manifest stay untouched.
 */
export async function extractReviewFrames(options: {outputDirectory: string; signal?: AbortSignal}): Promise<ReviewFramesResult> {
  const outputDirectory = resolve(options.outputDirectory);
  const lock = await readJson<ProjectLock>(join(outputDirectory, 'project.lock.json'));
  const video = join(outputDirectory, 'video.mp4');
  await access(video).catch((cause: unknown) => {
    throw new AppError('VIDEO_MISSING', `video.mp4 was not found in ${outputDirectory}.`, {category: 'render', cause});
  });
  const projectId = basename(dirname(outputDirectory));
  const projectRoot = resolve(outputDirectory, '..', '..', '..');
  const directory = join(projectRoot, '.json-video-work', projectId, 'final-frames', lock.lockHash);
  const indexPath = join(directory, 'index.json');
  const absolute = (stored: ReviewFramesResult): ReviewFramesResult => ({
    ...stored,
    directory,
    index: indexPath,
    sceneSheets: stored.sceneSheets.map((sheet) => ({...sheet, path: join(directory, sheet.path)})),
    boundarySheets: stored.boundarySheets.map((sheet) => ({...sheet, path: join(directory, sheet.path)})),
  });
  try {
    await access(indexPath);
    return absolute(await readJson<ReviewFramesResult>(indexPath));
  } catch {
    // Not extracted yet (or an interrupted earlier attempt): start clean.
  }
  await rm(directory, {recursive: true, force: true});
  const framesDirectory = join(directory, 'frames');
  await mkdir(framesDirectory, {recursive: true});

  const plan = planReviewFrames(lock);
  await extractFrames(video, plan.uniqueFrames, framesDirectory, options.signal);
  const framePath = (frame: number) => join(framesDirectory, `f${frame}.png`);

  const SCENES_PER_SHEET = 4;
  const sceneCells = plan.scenes.flatMap((scene) => scene.frames.map(framePath));
  const scenePaths = await tileSheets(sceneCells, 3, SCENES_PER_SHEET, directory, 'scenes', options.signal);
  const BOUNDARIES_PER_SHEET = 6;
  const boundaryCells = plan.boundaries.flatMap((boundary) => boundary.frames.map(framePath));
  const boundaryPaths = boundaryCells.length ? await tileSheets(boundaryCells, BOUNDARY_OFFSETS.length, BOUNDARIES_PER_SHEET, directory, 'continuing', options.signal) : [];
  await rm(join(directory, 'blank.png'), {force: true});

  // The index stores paths relative to its own directory so it stays valid outside the container.
  const stored: ReviewFramesResult = {
    directory: '.',
    index: 'index.json',
    sceneSheets: scenePaths.map((path, page) => ({
      path: basename(path),
      layout: 'rows = scenes in order; columns = entry (+2 frames), middle, end (-2 frames)',
      scenes: plan.scenes.slice(page * SCENES_PER_SHEET, (page + 1) * SCENES_PER_SHEET).map((scene) => scene.sceneId),
    })),
    boundarySheets: boundaryPaths.map((path, page) => ({
      path: basename(path),
      layout: `rows = boundaries where the same layout continues; columns = frame offsets ${BOUNDARY_OFFSETS.join(', ')} from the boundary`,
      boundaries: plan.boundaries.slice(page * BOUNDARIES_PER_SHEET, (page + 1) * BOUNDARIES_PER_SHEET)
        .map(({beforeSceneId, afterSceneId, boundaryFrame}) => ({beforeSceneId, afterSceneId, boundaryFrame})),
    })),
    frameCount: plan.uniqueFrames.length,
    continuingBoundaries: plan.boundaries.length,
  };
  await writeFile(indexPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return absolute(stored);
}
