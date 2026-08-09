import {createHash} from 'node:crypto';
import {access, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {makeCancelSignal, renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import type {ProjectLock, RenderArtifacts, VideoProject} from '../shared/video-types.js';
import {hasCompletePassingReviewGates, hasNoReviewErrors} from '../shared/review.js';
import {resolveSafeAssetPath, stageRenderAssets} from './assets.js';
import type {RemotionRenderInput} from './composition.js';
import {collectLayoutWarnings} from './layout.js';
import {AppError, throwIfAborted} from '../core/errors.js';
import {digestFile} from '../core/fs-safe.js';
import {stageResolveArtifacts} from '../core/resolver.js';
import {validateProject, validateProjectLock} from '../core/schema.js';
import {assertRuntimeMatchesLock, collectRuntimeVersions} from '../core/runtime-info.js';

export type RenderProgressStage = 'prepare' | 'bundle' | 'storyboard' | 'render' | 'thumbnail' | 'inspect' | 'complete';

export interface RenderProgress {
  stage: RenderProgressStage;
  progress: number;
  message: string;
}

export interface CommonRenderOptions {
  projectPath: string;
  lockPath?: string;
  outputDir?: string;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}

export interface RenderProjectOptions extends CommonRenderOptions {
  frozenLock?: boolean;
}

export interface InspectOutputOptions {
  mediaPath: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface InspectArtifactsOptions {
  outputDirectory: string;
  expectedLockHash?: string;
  signal?: AbortSignal;
  /** @internal Media probe adapter used by deterministic integration tests. */
  mediaInspector?: (options: InspectOutputOptions) => Promise<MediaInspection>;
}

export interface MediaInspection {
  mediaPath: string;
  durationSeconds: number;
  sizeBytes: number;
  bitRate?: number;
  video?: {codec: string; width: number; height: number; fps: number; pixelFormat?: string};
  audio?: {codec: string; sampleRate?: number; channels?: number};
}

export interface ArtifactManifest {
  manifestVersion: '1.0.0';
  projectId: string;
  projectDigest: string;
  lockHash: string;
  createdAt: string;
  files: Array<{path: string; sizeBytes: number; sha256: string}>;
}

export interface ArtifactInspection {
  outputDirectory: string;
  manifest: ArtifactManifest;
  lock: ProjectLock;
  media: MediaInspection;
  thumbnail?: {width: number; height: number};
  captionsEndSeconds?: number;
  chapterCount?: number;
  fileCount: number;
  checks: {
    manifestHashes: true;
    requiredArtifacts: true;
    lockIntegrity: true;
    reportLockHash: true;
    mediaContract: true;
    captionsWithinDuration: true;
    chaptersOrdered: true;
  };
}

interface ReviewGateRecord {
  projectId?: unknown;
  lockHash?: unknown;
  iteration?: unknown;
  status?: unknown;
  gates?: unknown;
  issues?: unknown;
}

/** Enforce the human/agent visual-review gate at the render boundary. */
export const assertPassingReview = async (
  projectRoot: string,
  projectId: string,
  lockHash: string,
): Promise<void> => {
  const reviewReference = `.json-video-work/${projectId}/review.json`;
  let review: ReviewGateRecord;
  try {
    const reviewPath = await resolveSafeAssetPath(projectRoot, reviewReference);
    const parsed: unknown = JSON.parse(await readFile(reviewPath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError('REVIEW_INVALID', 'review.jsonはJSON objectである必要があります', {category: 'schema'});
    }
    review = parsed as ReviewGateRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('REVIEW_REQUIRED', 'current lockのreview passが必要です。先にstoryboardをレビューしてください', {category: 'schema'});
    }
    throw new AppError('REVIEW_INVALID', 'review.jsonを読み取れません', {category: 'schema', cause: error});
  }
  if (review.status !== 'pass') {
    throw new AppError('REVIEW_NOT_PASSED', 'current lockのreviewがpassではありません', {category: 'schema'});
  }
  if (review.projectId !== projectId || review.lockHash !== lockHash) {
    throw new AppError('REVIEW_LOCK_MISMATCH', 'review.jsonがcurrent project/lockを対象にしていません', {category: 'schema'});
  }
  if (typeof review.iteration !== 'number' || !Number.isInteger(review.iteration) || review.iteration < 1 || review.iteration > 3) {
    throw new AppError('REVIEW_INVALID', 'review iterationは1〜3の整数である必要があります', {category: 'schema'});
  }
  if (!hasCompletePassingReviewGates(review.gates)) {
    throw new AppError('REVIEW_GATES_NOT_PASSED', '8つのreview hard gateがすべて明示的にtrueである必要があります', {category: 'schema'});
  }
  if (!hasNoReviewErrors(review.issues)) {
    throw new AppError('REVIEW_ISSUES_PRESENT', 'pass reviewのissuesはwarningだけを含む配列である必要があります', {category: 'schema'});
  }
};

const assertRenderedMedia = (inspection: MediaInspection, expectedDurationSeconds: number, expectedFps = 30): void => {
  const failures: string[] = [];
  if (inspection.video?.codec !== 'h264') failures.push(`video codec=${inspection.video?.codec ?? 'missing'}`);
  if (inspection.video?.width !== 1920 || inspection.video.height !== 1080) failures.push(`size=${inspection.video?.width ?? 0}x${inspection.video?.height ?? 0}`);
  if (Math.abs((inspection.video?.fps ?? 0) - expectedFps) > 0.01) failures.push(`fps=${inspection.video?.fps ?? 0}`);
  if (inspection.video?.pixelFormat !== 'yuv420p') failures.push(`pixelFormat=${inspection.video?.pixelFormat ?? 'missing'}`);
  if (inspection.audio?.codec !== 'aac') failures.push(`audio codec=${inspection.audio?.codec ?? 'missing'}`);
  if (Math.abs(inspection.durationSeconds - expectedDurationSeconds) > (1 / expectedFps) + 0.05) failures.push(`duration=${inspection.durationSeconds.toFixed(3)} expected=${expectedDurationSeconds.toFixed(3)}`);
  if (failures.length) throw new AppError('OUTPUT_INSPECTION_FAILED', `レンダー出力が仕様を満たしません: ${failures.join(', ')}`, {category: 'render'});
};

const notify = (options: CommonRenderOptions, stage: RenderProgressStage, progress: number, message: string): void => {
  options.onProgress?.({stage, progress: Math.max(0, Math.min(1, progress)), message});
};

const browserOptions = (): {browserExecutable: string} | Record<string, never> => {
  const browserExecutable = process.env.CHROME_BIN
    ?? process.env.REMOTION_BROWSER_EXECUTABLE
    ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  return browserExecutable ? {browserExecutable} : {};
};

const assertSafeOutputDirectory = async (projectRoot: string, outputDirectory: string): Promise<void> => {
  const lexicalRoot = path.resolve(projectRoot);
  const relative = path.relative(lexicalRoot, path.resolve(outputDirectory));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AppError('OUTPUT_PATH_ESCAPE', '出力先はプロジェクト内にしてください', {category: 'policy'});
  }
  const canonicalRoot = await realpath(lexicalRoot);
  const parentParts = path.dirname(relative).split(path.sep).filter((part) => part && part !== '.');
  let cursor = canonicalRoot;
  for (const part of parentParts) {
    cursor = path.join(cursor, part);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) throw new AppError('OUTPUT_SYMLINK', '出力先の親にシンボリックリンクは使用できません', {category: 'policy'});
      const canonicalCursor = await realpath(cursor);
      const fromRoot = path.relative(canonicalRoot, canonicalCursor);
      if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
        throw new AppError('OUTPUT_PATH_ESCAPE', '出力先の親がプロジェクト外を参照しています', {category: 'policy'});
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
};

export const canonicalProjectDigest = (project: VideoProject): string =>
  createHash('sha256').update(JSON.stringify(stableValue(project))).digest('hex');

export const canonicalLockHash = (lock: ProjectLock): string =>
  createHash('sha256').update(JSON.stringify(stableValue({...lock, lockHash: '', generatedAt: ''}))).digest('hex');

export const assertCurrentProjectLock = (project: VideoProject, lock: ProjectLock): void => {
  if (canonicalLockHash(lock) !== lock.lockHash) {
    throw new AppError('LOCK_HASH_MISMATCH', 'project.lock.jsonの自己ハッシュが一致しません。resolveをやり直してください', {category: 'schema'});
  }
  if (canonicalProjectDigest(project) !== lock.projectDigest) {
    throw new AppError('LOCK_STALE', 'project.lock.jsonが古いため、resolveをやり直してください', {category: 'schema'});
  }
};

export const representativeStoryboardFrame = (
  scene: Pick<ProjectLock['scenes'][number], 'startFrame' | 'durationInFrames'>,
  compositionDurationInFrames: number,
): number => Math.min(
  Math.max(0, compositionDurationInFrames - 1),
  scene.startFrame + Math.min(12, Math.max(0, Math.floor(scene.durationInFrames / 2))),
);

const readJson = async <T>(filename: string): Promise<T> => JSON.parse(await readFile(filename, 'utf8')) as T;

const defaultLockPath = (projectPath: string, project: VideoProject): string =>
  path.join(path.dirname(projectPath), '.json-video-work', project.meta.id, 'project.lock.json');

const loadInputs = async (options: CommonRenderOptions, requireLock: boolean): Promise<{project: VideoProject; lock?: ProjectLock; projectRoot: string}> => {
  const absoluteProjectPath = path.resolve(options.projectPath);
  const project = await validateProject(await readJson<unknown>(absoluteProjectPath));
  const lockFilename = options.lockPath ? path.resolve(options.lockPath) : defaultLockPath(absoluteProjectPath, project);
  let lock: ProjectLock | undefined;
  try {
    lock = await validateProjectLock(await readJson<unknown>(lockFilename));
  } catch (error) {
    if (requireLock || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (lock && canonicalLockHash(lock) !== lock.lockHash) {
    throw new AppError('LOCK_HASH_MISMATCH', 'project.lock.jsonの自己ハッシュが一致しません。resolveをやり直してください', {category: 'schema'});
  }
  if (requireLock && !lock) throw new AppError('LOCK_MISSING', `lockが見つかりません: ${lockFilename}`, {category: 'schema'});
  return {project, ...(lock ? {lock} : {}), projectRoot: path.dirname(absoluteProjectPath)};
};

const findEntryPoint = async (): Promise<string> => {
  const source = fileURLToPath(new URL('./entry.tsx', import.meta.url));
  const built = fileURLToPath(new URL('./entry.js', import.meta.url));
  try {
    await access(source);
    return source;
  } catch {
    return built;
  }
};

const createServeUrl = async (
  publicDirectory: string,
  options: CommonRenderOptions,
): Promise<string> => bundle({
  entryPoint: await findEntryPoint(),
  publicDir: publicDirectory,
  // NodeNext source imports use `.js` specifiers. During local/test execution
  // Remotion bundles the adjacent TypeScript sources, so map those specifiers
  // back to their authored extensions before falling through to built JS.
  webpackOverride: (configuration) => ({
    ...configuration,
    resolve: {
      ...configuration.resolve,
      extensionAlias: {
        ...configuration.resolve?.extensionAlias,
        '.js': ['.ts', '.tsx', '.js'],
      },
    },
  }),
  onProgress: (value) => notify(options, 'bundle', 0.08 + (value / 100) * 0.17, 'Remotion bundleを作成しています'),
});

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]+/gu, '-').slice(0, 72);

const stageExistingStoryboard = async (
  projectRoot: string,
  project: VideoProject,
  lock: ProjectLock,
  temporaryOutput: string,
): Promise<{sceneNames: string[]; contactSheetNames: string[]; hasContactSheet: boolean; hasThumbnailPreview: boolean}> => {
  const source = path.join(projectRoot, '.json-video-work', project.meta.id, 'storyboard', lock.lockHash);
  try {
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink()) {
      throw new AppError('STORYBOARD_SYMLINK', 'storyboard出力にシンボリックリンクは使用できません', {category: 'policy'});
    }
    if (!metadata.isDirectory()) return {sceneNames: [], contactSheetNames: [], hasContactSheet: false, hasThumbnailPreview: false};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {sceneNames: [], contactSheetNames: [], hasContactSheet: false, hasThumbnailPreview: false};
    throw error;
  }
  await assertSafeOutputDirectory(projectRoot, source);
  const destination = path.join(temporaryOutput, 'storyboard');
  await cp(source, destination, {recursive: true, errorOnExist: true, force: false});
  const names = (await readdir(destination)).filter((name) => /^\d{3}-.+\.png$/u.test(name)).sort();
  const contactSheetNames = (await readdir(destination))
    .filter((name) => /^contact-sheet(?:-\d{3})?\.png$/u.test(name))
    .sort((left, right) => left === 'contact-sheet.png' ? -1 : right === 'contact-sheet.png' ? 1 : left.localeCompare(right));
  const contactSource = path.join(destination, 'contact-sheet.png');
  let hasContactSheet = false;
  try {
    await copyFile(contactSource, path.join(temporaryOutput, 'contact-sheet.png'));
    hasContactSheet = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let hasThumbnailPreview = false;
  try {
    await access(path.join(destination, 'thumbnail-preview.png'));
    hasThumbnailPreview = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {sceneNames: names, contactSheetNames, hasContactSheet, hasThumbnailPreview};
};

const manifestFiles = async (root: string, relativeDirectory = ''): Promise<ArtifactManifest['files']> => {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, {withFileTypes: true});
  const result: ArtifactManifest['files'] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativeName = path.join(relativeDirectory, entry.name);
    const absoluteName = path.join(root, relativeName);
    if (entry.isSymbolicLink()) {
      throw new AppError('OUTPUT_SYMLINK', `成果物にシンボリックリンクは使用できません: ${relativeName}`, {category: 'policy'});
    }
    if (entry.isDirectory()) {
      result.push(...await manifestFiles(root, relativeName));
    } else if (entry.isFile() && entry.name !== 'artifact-manifest.json') {
      result.push({
        path: relativeName.split(path.sep).join('/'),
        sizeBytes: (await stat(absoluteName)).size,
        sha256: await digestFile(absoluteName),
      });
    }
  }
  return result;
};

const writeArtifactManifest = async (
  temporaryOutput: string,
  project: VideoProject,
  lock: ProjectLock,
): Promise<void> => {
  const manifest: ArtifactManifest = {
    manifestVersion: '1.0.0',
    projectId: project.meta.id,
    projectDigest: lock.projectDigest,
    lockHash: lock.lockHash,
    createdAt: new Date().toISOString(),
    files: await manifestFiles(temporaryOutput),
  };
  await writeFile(path.join(temporaryOutput, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
};

const stageFrozenLock = async (temporaryOutput: string, lock: ProjectLock): Promise<void> => {
  // Write the validated in-memory snapshot rather than copying the source path after render.
  // This prevents a concurrent edit from changing which lock is published with the artifacts.
  await writeFile(
    path.join(temporaryOutput, 'project.lock.json'),
    `${JSON.stringify(lock, null, 2)}\n`,
    {encoding: 'utf8', flag: 'wx'},
  );
};

const renderStillWithSignal = async (
  renderOptions: Parameters<typeof renderStill>[0],
  signal?: AbortSignal,
): Promise<void> => {
  throwIfAborted(signal);
  const {cancelSignal, cancel} = makeCancelSignal();
  const abort = () => cancel();
  signal?.addEventListener('abort', abort, {once: true});
  try {
    await renderStill({...renderOptions, cancelSignal});
    throwIfAborted(signal);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};

/** @internal Atomic publication boundary shared by storyboard and final render. */
export const commitOutputDirectory = async (
  temporaryOutput: string,
  outputDirectory: string,
  signal?: AbortSignal,
): Promise<void> => {
  throwIfAborted(signal);
  await rename(temporaryOutput, outputDirectory);
  if (signal?.aborted) {
    await rm(outputDirectory, {recursive: true, force: true});
    throwIfAborted(signal);
  }
};

export const storyboardProject = async (options: CommonRenderOptions): Promise<RenderArtifacts & {warnings: ReturnType<typeof collectLayoutWarnings>}> => {
  throwIfAborted(options.signal);
  notify(options, 'prepare', 0.01, 'プロジェクトを読み込んでいます');
  const {project, lock, projectRoot} = await loadInputs(options, false);
  if (!project.outputs.storyboard) throw new AppError('OUTPUT_DISABLED', 'outputs.storyboardが無効です', {category: 'schema'});
  if (lock) assertCurrentProjectLock(project, lock);
  const staged = await stageRenderAssets(projectRoot, project, lock);
  const outputDirectory = path.resolve(options.outputDir ?? path.join(projectRoot, '.json-video-work', project.meta.id, 'storyboard', lock?.lockHash ?? 'preview'));
  await assertSafeOutputDirectory(projectRoot, outputDirectory);
  try {
    await access(outputDirectory);
    throw new AppError('OUTPUT_EXISTS', `出力先が既に存在します: ${outputDirectory}`, {category: 'policy'});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(outputDirectory), {recursive: true});
  const temporaryOutput = await mkdtemp(path.join(path.dirname(outputDirectory), `.${path.basename(outputDirectory)}.tmp-`));
  let committed = false;

  try {
    const inputProps: RemotionRenderInput = {project, lock: lock ?? {
      lockVersion: '1.0.0', projectDigest: '', lockHash: 'preview', generatedAt: '',
      runtime: {node: '', remotion: '', ffmpeg: '', chrome: '', font: ''}, assets: [], scenes: [], totalFrames: 1, fps: 30, credits: [], warnings: [],
    }, assetUrls: staged.assetUrls};
    const serveUrl = await createServeUrl(staged.publicDirectory, options);
    const main = await selectComposition({serveUrl, id: 'JsonVideo', inputProps, ...browserOptions()});
    const scenes = lock?.scenes.length ? lock.scenes : [];
    const storyboard: string[] = [];

    if (scenes.length) {
      for (const [index, scene] of scenes.entries()) {
        throwIfAborted(options.signal);
        const target = path.join(temporaryOutput, `${String(index + 1).padStart(3, '0')}-${safeId(scene.id)}.png`);
        const representativeFrame = representativeStoryboardFrame(scene, main.durationInFrames);
        await renderStillWithSignal({composition: main, serveUrl, output: target, inputProps, frame: representativeFrame, imageFormat: 'png', ...browserOptions()}, options.signal);
        storyboard.push(target);
        notify(options, 'storyboard', 0.25 + ((index + 1) / scenes.length) * 0.55, `storyboard ${index + 1}/${scenes.length}`);
      }
    } else {
      const previewTarget = path.join(temporaryOutput, '001-preview.png');
      await renderStillWithSignal({composition: main, serveUrl, output: previewTarget, inputProps, frame: 0, imageFormat: 'png', ...browserOptions()}, options.signal);
      storyboard.push(previewTarget);
    }

    const storyboardComposition = await selectComposition({serveUrl, id: 'JsonVideoStoryboard', inputProps, ...browserOptions()});
    const contactSheetNames: string[] = [];
    const contactPages = scenes.length ? Array.from({length: Math.ceil(scenes.length / 12)}, (_, index) => scenes.slice(index * 12, (index + 1) * 12)) : [[]];
    for (const [pageIndex, pageScenes] of contactPages.entries()) {
      const name = pageIndex === 0 ? 'contact-sheet.png' : `contact-sheet-${String(pageIndex + 1).padStart(3, '0')}.png`;
      const pageInput: RemotionRenderInput = {...inputProps, lock: {...inputProps.lock, scenes: pageScenes}};
      await renderStillWithSignal({composition: storyboardComposition, serveUrl, output: path.join(temporaryOutput, name), inputProps: pageInput, imageFormat: 'png', ...browserOptions()}, options.signal);
      contactSheetNames.push(name);
    }
    const thumbnailComposition = await selectComposition({serveUrl, id: 'JsonVideoThumbnail', inputProps, ...browserOptions()});
    const thumbnailPreviewTemp = path.join(temporaryOutput, 'thumbnail-preview.png');
    await renderStillWithSignal({composition: thumbnailComposition, serveUrl, output: thumbnailPreviewTemp, inputProps, imageFormat: 'png', ...browserOptions()}, options.signal);

    await commitOutputDirectory(temporaryOutput, outputDirectory, options.signal);
    committed = true;
    const committedStoryboard = storyboard.map((source) => path.join(outputDirectory, path.basename(source)));
    const contactSheet = path.join(outputDirectory, 'contact-sheet.png');
    const contactSheets = contactSheetNames.map((name) => path.join(outputDirectory, name));
    const thumbnailPreview = path.join(outputDirectory, 'thumbnail-preview.png');
    notify(options, 'complete', 1, 'storyboardを生成しました');
    return {outputDirectory, storyboard: committedStoryboard, contactSheet, contactSheets, thumbnailPreview, warnings: collectLayoutWarnings(project)};
  } finally {
    await Promise.allSettled([staged.cleanup(), ...(committed ? [] : [rm(temporaryOutput, {recursive: true, force: true})])]);
  }
};

export const renderProject = async (options: RenderProjectOptions): Promise<RenderArtifacts & {inspection: MediaInspection; warnings: ReturnType<typeof collectLayoutWarnings>}> => {
  throwIfAborted(options.signal);
  notify(options, 'prepare', 0.01, 'プロジェクトとlockを確認しています');
  const {project, lock, projectRoot} = await loadInputs(options, true);
  if (!lock) throw new AppError('LOCK_MISSING', 'lockが必要です', {category: 'schema'});
  if (!project.outputs.video) throw new AppError('OUTPUT_DISABLED', 'outputs.videoが無効です', {category: 'schema'});
  if (options.frozenLock !== false && canonicalProjectDigest(project) !== lock.projectDigest) {
    throw new AppError('LOCK_STALE', 'project.lock.jsonが古いため、resolveをやり直してください', {category: 'schema'});
  }
  await assertPassingReview(projectRoot, project.meta.id, lock.lockHash);
  const runtimeMismatches = assertRuntimeMatchesLock(await collectRuntimeVersions(), lock.runtime);
  if (runtimeMismatches.length) {
    throw new AppError('RUNTIME_LOCK_MISMATCH', `render環境がlockと一致しません: ${runtimeMismatches.join('; ')}`, {category: 'dependency'});
  }

  const outputDirectory = path.resolve(options.outputDir ?? path.join(projectRoot, 'dist', project.meta.id, lock.lockHash));
  await assertSafeOutputDirectory(projectRoot, outputDirectory);
  const video = path.join(outputDirectory, 'video.mp4');
  const thumbnail = path.join(outputDirectory, 'thumbnail.png');
  try {
    await access(outputDirectory);
    throw new AppError('OUTPUT_EXISTS', `出力先が既に存在します: ${outputDirectory}`, {category: 'policy'});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const staged = await stageRenderAssets(projectRoot, project, lock);
  await mkdir(path.dirname(outputDirectory), {recursive: true});
  const temporaryOutput = await mkdtemp(path.join(path.dirname(outputDirectory), `.${path.basename(outputDirectory)}.tmp-`));
  let committed = false;
  try {
    const inputProps: RemotionRenderInput = {project, lock, assetUrls: staged.assetUrls};
    const serveUrl = await createServeUrl(staged.publicDirectory, options);
    const composition = await selectComposition({serveUrl, id: 'JsonVideo', inputProps, ...browserOptions()});
    if (composition.durationInFrames !== lock.totalFrames || composition.fps !== lock.fps) {
      throw new AppError(
        'RENDER_TIMELINE_MISMATCH',
        `Remotion composition (${composition.durationInFrames} frames at ${composition.fps}fps) does not match the lock (${lock.totalFrames} frames at ${lock.fps}fps)`,
        {category: 'render'},
      );
    }
    const {cancelSignal, cancel} = makeCancelSignal();
    const abort = () => cancel();
    options.signal?.addEventListener('abort', abort, {once: true});
    try {
      notify(options, 'render', 0.25, 'MP4をレンダーしています');
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        audioCodec: 'aac',
        pixelFormat: 'yuv420p',
        imageFormat: 'png',
        colorSpace: 'bt709',
        crf: 18,
        x264Preset: 'medium',
        enforceAudioTrack: true,
        outputLocation: path.join(temporaryOutput, 'video.mp4'),
        inputProps,
        cancelSignal,
        ...browserOptions(),
        onProgress: ({progress}) => notify(options, 'render', 0.25 + progress * 0.58, `MP4 ${Math.round(progress * 100)}%`),
      });
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
    throwIfAborted(options.signal);

    if (project.outputs.thumbnail) {
      notify(options, 'thumbnail', 0.86, 'サムネイルを生成しています');
      const thumbnailComposition = await selectComposition({serveUrl, id: 'JsonVideoThumbnail', inputProps, ...browserOptions()});
      await renderStillWithSignal({composition: thumbnailComposition, serveUrl, output: path.join(temporaryOutput, 'thumbnail.png'), inputProps, imageFormat: 'png', ...browserOptions()}, options.signal);
    }

    notify(options, 'inspect', 0.94, '出力を検査しています');
    const inspection = await inspectOutput({mediaPath: path.join(temporaryOutput, 'video.mp4'), ...(options.signal ? {signal: options.signal} : {})});
    assertRenderedMedia(inspection, lock.totalFrames / lock.fps, lock.fps);
    const report = path.join(outputDirectory, 'render-report.json');
    await writeFile(path.join(temporaryOutput, 'render-report.json'), `${JSON.stringify({
      projectId: project.meta.id,
      projectDigest: lock.projectDigest,
      lockHash: lock.lockHash,
      runtime: lock.runtime,
      outputs: project.outputs,
      renderSettings: {codec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p', imageFormat: 'png', colorSpace: 'bt709', crf: 18, x264Preset: 'medium'},
      inspection: {...inspection, mediaPath: video},
      warnings: collectLayoutWarnings(project),
    }, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
    const companionPaths = await stageResolveArtifacts(project, lock, temporaryOutput);
    const stagedStoryboard = await stageExistingStoryboard(projectRoot, project, lock, temporaryOutput);
    if (project.outputs.storyboard && (stagedStoryboard.sceneNames.length === 0 || !stagedStoryboard.hasContactSheet || !stagedStoryboard.hasThumbnailPreview)) {
      throw new AppError('STORYBOARD_MISSING', 'current lockのstoryboard/contact sheet/thumbnail previewがありません。先にstoryboardを生成してください', {category: 'schema'});
    }
    await stageFrozenLock(temporaryOutput, lock);
    await writeArtifactManifest(temporaryOutput, project, lock);
    await commitOutputDirectory(temporaryOutput, outputDirectory, options.signal);
    committed = true;
    notify(options, 'complete', 1, 'レンダーが完了しました');
    const storyboardDirectory = path.join(outputDirectory, 'storyboard');
    return {
      outputDirectory,
      lock: path.join(outputDirectory, 'project.lock.json'),
      video,
      ...(project.outputs.thumbnail ? {thumbnail} : {}),
      ...(companionPaths.captions ? {captions: path.join(outputDirectory, path.basename(companionPaths.captions))} : {}),
      ...(companionPaths.chapters ? {chapters: path.join(outputDirectory, path.basename(companionPaths.chapters))} : {}),
      credits: path.join(outputDirectory, path.basename(companionPaths.credits)),
      ...(stagedStoryboard.sceneNames.length ? {storyboard: stagedStoryboard.sceneNames.map((name) => path.join(storyboardDirectory, name))} : {}),
      ...(stagedStoryboard.hasContactSheet ? {contactSheet: path.join(outputDirectory, 'contact-sheet.png')} : {}),
      ...(stagedStoryboard.contactSheetNames.length ? {contactSheets: stagedStoryboard.contactSheetNames.map((name, index) => index === 0 ? path.join(outputDirectory, 'contact-sheet.png') : path.join(storyboardDirectory, name))} : {}),
      manifest: path.join(outputDirectory, 'artifact-manifest.json'),
      report,
      inspection: {...inspection, mediaPath: video},
      warnings: collectLayoutWarnings(project),
    };
  } finally {
    await Promise.allSettled([staged.cleanup(), ...(committed ? [] : [rm(temporaryOutput, {recursive: true, force: true})])]);
  }
};

const parseRate = (value: unknown): number => {
  if (typeof value !== 'string') return 0;
  const [numerator, denominator = '1'] = value.split('/');
  return Number(numerator) / Math.max(1, Number(denominator));
};

export const inspectOutput = async ({mediaPath, signal, timeoutMs = 30_000}: InspectOutputOptions): Promise<MediaInspection> => {
  const absolutePath = path.resolve(mediaPath);
  const args = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', absolutePath];
  const output = await new Promise<string>((resolve, reject) => {
    const process = spawn('ffprobe', args, {shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    process.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    process.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const abort = () => process.kill('SIGTERM');
    const timeout = setTimeout(() => {
      timedOut = true;
      process.kill('SIGKILL');
    }, Math.max(1, timeoutMs));
    signal?.addEventListener('abort', abort, {once: true});
    process.on('error', (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    process.on('close', (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (timedOut) reject(new AppError('FFPROBE_TIMEOUT', `ffprobeが${timeoutMs}ms以内に完了しませんでした`, {category: 'render', retryable: true}));
      else if (signal?.aborted) reject(new AppError('CANCELLED', '検査がキャンセルされました', {category: 'cancelled', retryable: true}));
      else if (code !== 0) reject(new AppError('FFPROBE_FAILED', `ffprobeに失敗しました: ${stderr.trim()}`, {category: 'render', retryable: true}));
      else resolve(stdout);
    });
  });
  const probe = JSON.parse(output) as {format?: Record<string, string>; streams?: Array<Record<string, unknown>>};
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const inspection: MediaInspection = {
    mediaPath: absolutePath,
    durationSeconds: Number(probe.format?.duration ?? 0),
    sizeBytes: Number(probe.format?.size ?? 0),
  };
  if (probe.format?.bit_rate) inspection.bitRate = Number(probe.format.bit_rate);
  if (video) {
    inspection.video = {
      codec: String(video.codec_name ?? ''),
      width: Number(video.width ?? 0),
      height: Number(video.height ?? 0),
      fps: parseRate(video.avg_frame_rate),
      ...(video.pix_fmt ? {pixelFormat: String(video.pix_fmt)} : {}),
    };
  }
  if (audio) {
    inspection.audio = {
      codec: String(audio.codec_name ?? ''),
      ...(audio.sample_rate ? {sampleRate: Number(audio.sample_rate)} : {}),
      ...(audio.channels ? {channels: Number(audio.channels)} : {}),
    };
  }
  return inspection;
};

const artifactTimestampSeconds = (value: string): number => {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/u.exec(value.trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
};

const assertArtifactReference = (reference: string): void => {
  if (!reference || path.isAbsolute(reference) || reference.startsWith('\\\\') || /^[a-z][a-z0-9+.-]*:/iu.test(reference)) {
    throw new AppError('MANIFEST_PATH_REJECTED', `成果物manifestのパスが不正です: ${reference}`, {category: 'policy'});
  }
  const normalized = path.normalize(reference);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new AppError('MANIFEST_PATH_REJECTED', `成果物manifestが出力外を参照しています: ${reference}`, {category: 'policy'});
  }
};

interface ArtifactReportIdentity {
  projectId?: string;
  projectDigest?: string;
  lockHash?: string;
}

export const assertArtifactLockConsistency = (
  manifest: ArtifactManifest,
  lock: ProjectLock,
  report: ArtifactReportIdentity,
): void => {
  if (canonicalLockHash(lock) !== lock.lockHash) {
    throw new AppError('LOCK_HASH_MISMATCH', '同梱されたproject.lock.jsonの自己ハッシュが一致しません', {category: 'schema'});
  }
  if (lock.lockHash !== manifest.lockHash) {
    throw new AppError('ARTIFACT_LOCK_MISMATCH', 'project.lock.jsonのlock hashがmanifestと一致しません', {category: 'schema'});
  }
  if (lock.projectDigest !== manifest.projectDigest) {
    throw new AppError('ARTIFACT_PROJECT_DIGEST_MISMATCH', 'project.lock.jsonのproject digestがmanifestと一致しません', {category: 'schema'});
  }
  if (report.lockHash !== lock.lockHash) {
    throw new AppError('REPORT_LOCK_MISMATCH', 'render-report.jsonのlock hashがproject.lock.jsonと一致しません', {category: 'schema'});
  }
  if (report.projectDigest !== lock.projectDigest) {
    throw new AppError('REPORT_PROJECT_DIGEST_MISMATCH', 'render-report.jsonのproject digestがproject.lock.jsonと一致しません', {category: 'schema'});
  }
  if (report.projectId !== manifest.projectId) {
    throw new AppError('REPORT_PROJECT_ID_MISMATCH', 'render-report.jsonのproject idがmanifestと一致しません', {category: 'schema'});
  }
};

export const inspectArtifactOutput = async ({
  outputDirectory,
  expectedLockHash,
  signal,
  mediaInspector = inspectOutput,
}: InspectArtifactsOptions): Promise<ArtifactInspection> => {
  throwIfAborted(signal);
  const root = await realpath(path.resolve(outputDirectory));
  const manifestPath = path.join(root, 'artifact-manifest.json');
  let manifest: ArtifactManifest;
  try {
    manifest = await readJson<ArtifactManifest>(manifestPath);
  } catch (error) {
    throw new AppError('ARTIFACT_MANIFEST_INVALID', 'artifact-manifest.jsonを読み取れません', {category: 'schema', cause: error});
  }
  if (
    manifest.manifestVersion !== '1.0.0'
    || typeof manifest.projectId !== 'string'
    || manifest.projectId.length === 0
    || !Array.isArray(manifest.files)
    || !/^[a-f0-9]{64}$/u.test(manifest.lockHash)
    || !/^[a-f0-9]{64}$/u.test(manifest.projectDigest)
  ) {
    throw new AppError('ARTIFACT_MANIFEST_INVALID', 'artifact-manifest.jsonの形式が不正です', {category: 'schema'});
  }
  if (expectedLockHash && manifest.lockHash !== expectedLockHash) {
    throw new AppError('ARTIFACT_LOCK_MISMATCH', `成果物はlock ${manifest.lockHash}で生成されています`, {category: 'schema'});
  }

  const declared = new Map<string, ArtifactManifest['files'][number]>();
  for (const entry of manifest.files) {
    assertArtifactReference(entry.path);
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || !/^[a-f0-9]{64}$/u.test(entry.sha256) || declared.has(entry.path)) {
      throw new AppError('ARTIFACT_MANIFEST_INVALID', `成果物manifestのentryが不正です: ${entry.path}`, {category: 'schema'});
    }
    const target = path.resolve(root, entry.path);
    const canonicalTarget = await realpath(target);
    const fromRoot = path.relative(root, canonicalTarget);
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      throw new AppError('MANIFEST_PATH_REJECTED', `成果物manifestが出力外を参照しています: ${entry.path}`, {category: 'policy'});
    }
    if ((await lstat(target)).isSymbolicLink()) {
      throw new AppError('OUTPUT_SYMLINK', `成果物にシンボリックリンクは使用できません: ${entry.path}`, {category: 'policy'});
    }
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size !== entry.sizeBytes || await digestFile(target) !== entry.sha256) {
      throw new AppError('ARTIFACT_HASH_MISMATCH', `成果物がmanifestと一致しません: ${entry.path}`, {category: 'policy'});
    }
    declared.set(entry.path, entry);
  }
  const actualFiles = await manifestFiles(root);
  if (actualFiles.length !== declared.size || actualFiles.some((entry) => !declared.has(entry.path))) {
    throw new AppError('ARTIFACT_SET_MISMATCH', 'manifestに未登録または欠落した成果物があります', {category: 'policy'});
  }

  const baseRequired = ['video.mp4', 'credits.txt', 'render-report.json', 'project.lock.json'];
  if (baseRequired.some((name) => !declared.has(name))) {
    throw new AppError('REQUIRED_ARTIFACT_MISSING', `必須成果物がありません: ${baseRequired.filter((name) => !declared.has(name)).join(', ')}`, {category: 'render'});
  }

  let rawLock: unknown;
  try {
    rawLock = await readJson<unknown>(path.join(root, 'project.lock.json'));
  } catch (error) {
    throw new AppError('ARTIFACT_LOCK_INVALID', '同梱されたproject.lock.jsonを読み取れません', {category: 'schema', cause: error});
  }
  const lock = await validateProjectLock(rawLock);

  const report = await readJson<{
    projectId?: string;
    projectDigest?: string;
    lockHash?: string;
    outputs?: VideoProject['outputs'];
    inspection?: {durationSeconds?: number};
  }>(path.join(root, 'render-report.json'));
  assertArtifactLockConsistency(manifest, lock, report);
  const outputs = report.outputs;
  const required = [...baseRequired];
  if (outputs?.thumbnail) required.push('thumbnail.png');
  if (outputs?.captions) required.push('captions.srt');
  if (outputs?.chapters) required.push('chapters.txt');
  if (outputs?.storyboard) required.push('contact-sheet.png', 'storyboard/thumbnail-preview.png');
  if (required.some((name) => !declared.has(name))) {
    throw new AppError('REQUIRED_ARTIFACT_MISSING', `必須成果物がありません: ${required.filter((name) => !declared.has(name)).join(', ')}`, {category: 'render'});
  }
  if (outputs?.storyboard && ![...declared.keys()].some((name) => /^storyboard\/\d{3}-.+\.png$/u.test(name))) {
    throw new AppError('REQUIRED_ARTIFACT_MISSING', 'storyboardのscene画像がありません', {category: 'render'});
  }

  const media = await mediaInspector({mediaPath: path.join(root, 'video.mp4'), ...(signal ? {signal} : {})});
  assertRenderedMedia(media, lock.totalFrames / lock.fps, lock.fps);
  let thumbnail: ArtifactInspection['thumbnail'];
  if (outputs?.thumbnail) {
    const thumbnailProbe = await mediaInspector({mediaPath: path.join(root, 'thumbnail.png'), ...(signal ? {signal} : {})});
    thumbnail = {width: thumbnailProbe.video?.width ?? 0, height: thumbnailProbe.video?.height ?? 0};
    if (thumbnail.width !== 1280 || thumbnail.height !== 720) {
      throw new AppError('THUMBNAIL_INSPECTION_FAILED', `サムネイル寸法が不正です: ${thumbnail.width}x${thumbnail.height}`, {category: 'render'});
    }
  }

  let captionsEndSeconds: number | undefined;
  if (outputs?.captions) {
    const captions = await readFile(path.join(root, 'captions.srt'), 'utf8');
    const ends = [...captions.matchAll(/-->\s*(\d{2}:\d{2}:\d{2},\d{3})/gu)].map((match) => artifactTimestampSeconds(match[1] ?? ''));
    captionsEndSeconds = ends.at(-1) ?? 0;
    if (!Number.isFinite(captionsEndSeconds) || captionsEndSeconds > media.durationSeconds + 1 / 30 + 0.01) {
      throw new AppError('CAPTIONS_DURATION_INVALID', '字幕の最終cueが動画尺を超えています', {category: 'render'});
    }
  }

  let chapterCount: number | undefined;
  if (outputs?.chapters) {
    const chapterLines = (await readFile(path.join(root, 'chapters.txt'), 'utf8')).split(/\r?\n/u).filter(Boolean);
    const chapterTimes = chapterLines.map((line) => artifactTimestampSeconds(line.slice(0, 12)));
    if (chapterTimes.some((value, index) => !Number.isFinite(value) || (index > 0 && value < (chapterTimes[index - 1] ?? 0)))) {
      throw new AppError('CHAPTER_ORDER_INVALID', '章の時刻がsection順に並んでいません', {category: 'render'});
    }
    chapterCount = chapterLines.length;
  }

  return {
    outputDirectory: root,
    manifest,
    lock,
    media,
    ...(thumbnail ? {thumbnail} : {}),
    ...(captionsEndSeconds === undefined ? {} : {captionsEndSeconds}),
    ...(chapterCount === undefined ? {} : {chapterCount}),
    fileCount: declared.size,
    checks: {
      manifestHashes: true,
      requiredArtifacts: true,
      lockIntegrity: true,
      reportLockHash: true,
      mediaContract: true,
      captionsWithinDuration: true,
      chaptersOrdered: true,
    },
  };
};
