import {constants} from 'node:fs';
import {copyFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import type {
  LockedAsset,
  ProjectLock,
  RenderArtifacts,
  ResolvedScene,
  Speaker,
  VideoProject,
} from '../shared/video-types.js';
import {AppError, throwIfAborted} from './errors.js';
import {atomicWriteJson, atomicWrite, digestFile, digestJson, ensureSafeDirectory, relativePortable, resolveInside} from './fs-safe.js';
import {inspectAsset} from './media.js';
import {ProjectService} from './project.js';
import {VoicevoxClient, type SynthesizedVoice, type VoiceSynthesisPlan} from './voicevox.js';
import {validateProjectLock} from './schema.js';
import {collectRuntimeVersions} from './runtime-info.js';

export interface VoiceProvider {
  synthesize(text: string, speaker: Speaker, signal?: AbortSignal): Promise<SynthesizedVoice>;
  version(signal?: AbortSignal): Promise<string>;
  plan?(text: string, speaker: Speaker, signal?: AbortSignal): Promise<VoiceSynthesisPlan>;
}

export interface ResolveProgress {
  progress: number;
  message: string;
}

export interface ResolveOptions {
  projectPath: string;
  workspaceRoot: string;
  schemaPath?: string;
  cacheRoot?: string;
  runtimeVersions?: ProjectLock['runtime'];
  dryRun?: boolean;
  signal?: AbortSignal;
  voiceProvider?: VoiceProvider;
  onProgress?: (event: ResolveProgress) => void;
}

export interface ResolvePlan {
  dryRun: true;
  projectDigest: string;
  assetCount: number;
  sceneCount: number;
  voicevoxCalls: Array<{
    sectionId: string;
    sceneId: string;
    speakerId: string;
    characters: number;
    cacheHit: boolean | null;
    cacheKey?: string;
    estimatedDurationMs: number;
  }>;
  cacheHits: number;
  estimatedDurationMs: number;
  estimatedFrames: number;
  rightsWarnings: string[];
  lockPath: string;
}

export interface ResolveResult {
  dryRun: false;
  project: VideoProject;
  lock: ProjectLock;
  lockPath: string;
  captionsPath: string;
  chaptersPath: string;
  creditsPath: string;
}

function notify(options: ResolveOptions, progress: number, message: string): void {
  options.onProgress?.({progress: Math.max(0, Math.min(1, progress)), message});
}

function millisecondsToFrames(milliseconds: number, fps: number): number {
  return Math.max(1, Math.ceil((milliseconds / 1000) * fps));
}

function timestamp(milliseconds: number, srt = false): string {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const fraction = value % 1000;
  const separator = srt ? ',' : '.';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(fraction).padStart(3, '0')}`;
}

function makeSrt(scenes: ResolvedScene[], fps: number): string {
  let index = 1;
  return scenes.flatMap((scene) => {
    if (!scene.subtitleText.trim()) return [];
    const start = (scene.startFrame / fps) * 1000;
    const contentDuration = scene.audioDurationMs > 0 ? scene.audioDurationMs : (scene.durationMs ?? 0);
    const contentFrames = millisecondsToFrames(contentDuration, fps);
    const end = ((scene.startFrame + Math.min(scene.durationInFrames, contentFrames)) / fps) * 1000;
    return [`${index++}\n${timestamp(start, true)} --> ${timestamp(end, true)}\n${scene.subtitleText}\n`];
  }).join('\n');
}

function makeChapters(project: VideoProject, scenes: ResolvedScene[], fps: number): string {
  return project.sections.flatMap((section) => {
    const first = scenes.find((scene) => scene.sectionId === section.id);
    return first ? [`${timestamp((first.startFrame / fps) * 1000)} ${section.title}`] : [];
  }).join('\n') + '\n';
}

function makeCredits(project: VideoProject, lockedAssets: LockedAsset[]): string[] {
  const credits = new Set<string>();
  for (const asset of project.assets) {
    const rights = asset.rights;
    if (rights.attribution) credits.add(rights.attribution);
    else if (rights.author || rights.source || rights.license) {
      credits.add([asset.id, rights.author, rights.license, rights.source].filter(Boolean).join(' — '));
    }
  }
  for (const asset of lockedAssets) {
    if (asset.voice) credits.add(`VOICEVOX:${asset.voice.speakerName}`);
  }
  return [...credits].sort();
}

export interface ResolveArtifactPaths {
  captions?: string;
  chapters?: string;
  credits: string;
}

/**
 * Recreate the text companions from the validated project and frozen lock.
 * Rendering calls this inside its temporary output directory so the entire
 * deliverable can be committed with one directory rename.
 */
export async function stageResolveArtifacts(
  project: VideoProject,
  lock: ProjectLock,
  destination: string,
): Promise<ResolveArtifactPaths> {
  await mkdir(destination, {recursive: true});
  const result: ResolveArtifactPaths = {credits: resolve(destination, 'credits.txt')};
  if (project.outputs.captions) {
    result.captions = resolve(destination, 'captions.srt');
    await atomicWrite(result.captions, makeSrt(lock.scenes, lock.fps), {overwrite: false});
  }
  if (project.outputs.chapters) {
    result.chapters = resolve(destination, 'chapters.txt');
    await atomicWrite(result.chapters, makeChapters(project, lock.scenes, lock.fps), {overwrite: false});
  }
  await atomicWrite(result.credits, `${lock.credits.join('\n')}\n`, {overwrite: false});
  return result;
}

function voiceLockedAsset(sceneId: string, text: string, speaker: Speaker, voice: SynthesizedVoice): LockedAsset {
  const parameters = speaker.voice;
  if (!parameters) throw new AppError('VOICE_NOT_CONFIGURED', `Speaker ${speaker.id} has no VOICEVOX voice.`, {category: 'schema'});
  return {
    id: `voice:${sceneId}`,
    type: 'voice',
    sourcePath: `voicevox:${voice.cacheKey}`,
    resolvedPath: voice.relativePath,
    sha256: voice.sha256,
    mime: 'audio/wav',
    sizeBytes: voice.sizeBytes,
    durationMs: voice.durationMs,
    voice: {
      provider: 'voicevox',
      engineVersion: voice.engineVersion,
      speakerUuid: parameters.speakerUuid,
      speakerName: voice.speakerName,
      styleId: parameters.styleId,
      styleName: voice.styleName,
      speedScale: parameters.speedScale ?? speaker.speed ?? 1,
      volumeScale: parameters.volumeScale ?? speaker.volume ?? 1,
      pitchScale: parameters.pitchScale ?? 0,
      intonationScale: parameters.intonationScale ?? 1,
      cacheKey: voice.cacheKey,
      textSha256: digestJson(text),
    },
  };
}

export async function resolveProject(options: ResolveOptions): Promise<ResolvePlan | ResolveResult> {
  throwIfAborted(options.signal);
  const service = new ProjectService({
    workspaceRoot: options.workspaceRoot,
    ...(options.schemaPath === undefined ? {} : {schemaPath: options.schemaPath}),
  });
  const absoluteProjectPath = await service.projectPath(options.projectPath, true);
  const envelope = await service.get(options.projectPath);
  const project = envelope.project;
  const projectRoot = dirname(absoluteProjectPath);
  let lockPath = service.lockPath(absoluteProjectPath, project.meta.id);
  const speakers = new Map(project.speakers.map((speaker) => [speaker.id, speaker]));
  const cacheRoot = options.cacheRoot
    ? resolve(options.cacheRoot)
    : resolve(projectRoot, `.json-video-work/${project.meta.id}/cache/voicevox`);
  const voiceProvider = options.voiceProvider ?? new VoicevoxClient({cacheRoot, workspaceRoot: projectRoot});
  const voicevoxCalls: ResolvePlan['voicevoxCalls'] = [];
  const dryAudioDurations = new Map<string, number>();
  if (options.dryRun) {
    for (const asset of project.assets.filter((item) => item.type === 'audio')) {
      const inspected = await inspectAsset(asset, projectRoot, options.signal === undefined ? {} : {signal: options.signal});
      if (inspected.durationMs !== undefined) dryAudioDurations.set(asset.id, inspected.durationMs);
    }
  }
  let estimatedDurationMs = 0;
  let estimatedFrames = 0;
  for (const section of project.sections) {
    for (const scene of section.scenes) {
      let estimatedSceneMs = scene.audioAssetId ? (dryAudioDurations.get(scene.audioAssetId) ?? 0) : (scene.durationMs ?? 0);
      if (!scene.audioAssetId && scene.text && scene.speakerId) {
        const speaker = speakers.get(scene.speakerId);
        if (!speaker?.voice) {
          if (scene.durationMs === undefined) {
            throw new AppError('VOICE_NOT_CONFIGURED', `Scene ${scene.id} requires a VOICEVOX voice or durationMs.`, {
              category: 'schema',
            });
          }
        } else {
          const planned = options.dryRun && voiceProvider.plan
            ? await voiceProvider.plan(scene.text, speaker, options.signal)
            : undefined;
          estimatedSceneMs = planned?.durationMs
            ?? Math.max(600, Math.ceil((scene.text.length / (5 * (speaker.voice.speedScale ?? speaker.speed ?? 1))) * 1000));
          voicevoxCalls.push({
            sectionId: section.id,
            sceneId: scene.id,
            speakerId: speaker.id,
            characters: scene.text.length,
            cacheHit: planned?.cacheHit ?? null,
            ...(planned?.cacheKey === undefined ? {} : {cacheKey: planned.cacheKey}),
            estimatedDurationMs: estimatedSceneMs,
          });
        }
      }
      const sceneTotalMs = estimatedSceneMs + (scene.holdAfterMs ?? 0);
      estimatedDurationMs += sceneTotalMs;
      estimatedFrames += millisecondsToFrames(sceneTotalMs, project.canvas.fps);
    }
  }
  if (options.dryRun) {
    return {
      dryRun: true,
      projectDigest: envelope.digest,
      assetCount: project.assets.length,
      sceneCount: project.sections.reduce((total, section) => total + section.scenes.length, 0),
      voicevoxCalls,
      cacheHits: voicevoxCalls.filter((call) => call.cacheHit).length,
      estimatedDurationMs,
      estimatedFrames,
      rightsWarnings: project.assets.filter((asset) => asset.rights.status === 'unknown').map((asset) => `権利情報が未確認です: ${asset.id}`),
      lockPath,
    };
  }

  await ensureSafeDirectory(projectRoot, `.json-video-work/${project.meta.id}`);
  lockPath = await resolveInside(projectRoot, `.json-video-work/${project.meta.id}/project.lock.json`);

  notify(options, 0.02, '素材を検査しています');
  const lockedAssets: LockedAsset[] = [];
  for (const [index, asset] of project.assets.entries()) {
    throwIfAborted(options.signal);
    lockedAssets.push(await inspectAsset(asset, projectRoot, options.signal === undefined ? {} : {signal: options.signal}));
    notify(options, 0.05 + ((index + 1) / Math.max(1, project.assets.length)) * 0.2, `素材 ${index + 1}/${project.assets.length}`);
  }
  const lockedById = new Map(lockedAssets.map((asset) => [asset.id, asset]));
  await mkdir(cacheRoot, {recursive: true});
  const materializedVoiceRoot = await ensureSafeDirectory(projectRoot, `.json-video-work/${project.meta.id}/voice`);
  const resolvedScenes: ResolvedScene[] = [];
  let currentFrame = 0;
  let voicevoxVersion: string | undefined;
  const allScenes = project.sections.flatMap((section) => section.scenes);
  let sceneNumber = 0;

  for (const section of project.sections) {
    for (const scene of section.scenes) {
      throwIfAborted(options.signal);
      sceneNumber += 1;
      let audioDurationMs = 0;
      let resolvedAudioAssetId: string | undefined;
      if (scene.audioAssetId) {
        const audio = lockedById.get(scene.audioAssetId);
        if (!audio?.durationMs) {
          throw new AppError('AUDIO_DURATION_MISSING', `Audio asset ${scene.audioAssetId} has no duration.`, {
            category: 'schema',
          });
        }
        audioDurationMs = audio.durationMs;
        resolvedAudioAssetId = audio.id;
      } else if (scene.text && scene.speakerId) {
        const speaker = speakers.get(scene.speakerId);
        if (speaker?.voice) {
          const voice = await voiceProvider.synthesize(scene.text, speaker, options.signal);
          voicevoxVersion = voice.engineVersion;
          const materializedPath = resolve(materializedVoiceRoot, `${voice.cacheKey}.wav`);
          if (resolve(voice.path) !== materializedPath) {
            try {
              await copyFile(voice.path, materializedPath, constants.COPYFILE_EXCL);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            }
          }
          if (await digestFile(materializedPath) !== voice.sha256) {
            throw new AppError('VOICE_CACHE_HASH_MISMATCH', `Materialized voice cache is corrupt for scene ${scene.id}.`, {category: 'policy'});
          }
          const materializedVoice: SynthesizedVoice = {
            ...voice,
            path: materializedPath,
            relativePath: relativePortable(projectRoot, materializedPath),
          };
          const locked = voiceLockedAsset(scene.id, scene.text, speaker, materializedVoice);
          lockedAssets.push(locked);
          lockedById.set(locked.id, locked);
          audioDurationMs = voice.durationMs;
          resolvedAudioAssetId = locked.id;
        }
      }
      const baseDurationMs = audioDurationMs > 0 ? audioDurationMs : (scene.durationMs ?? 0);
      if (baseDurationMs <= 0) {
        throw new AppError('SCENE_DURATION_MISSING', `Unable to determine duration for scene ${scene.id}.`, {
          category: 'schema',
        });
      }
      const durationInFrames = millisecondsToFrames(baseDurationMs + (scene.holdAfterMs ?? 0), project.canvas.fps);
      resolvedScenes.push({
        ...scene,
        sectionId: section.id,
        sectionTitle: section.title,
        startFrame: currentFrame,
        durationInFrames,
        audioDurationMs,
        subtitleText: scene.subtitle ?? scene.text ?? '',
        ...(resolvedAudioAssetId === undefined ? {} : {resolvedAudioAssetId}),
      });
      currentFrame += durationInFrames;
      notify(options, 0.28 + (sceneNumber / Math.max(1, allScenes.length)) * 0.52, `シーン ${sceneNumber}/${allScenes.length}`);
    }
  }

  const totalMinutes = currentFrame / project.canvas.fps / 60;
  if (totalMinutes > project.policies.maxDurationMinutes) {
    throw new AppError('DURATION_POLICY_EXCEEDED', `Resolved duration ${totalMinutes.toFixed(2)} minutes exceeds ${project.policies.maxDurationMinutes}.`, {
      category: 'policy',
    });
  }
  const credits = makeCredits(project, lockedAssets);
  const warnings = project.assets
    .filter((asset) => asset.rights.status === 'unknown')
    .map((asset) => `権利情報が未確認です: ${asset.id}`);
  notify(options, 0.82, '実行環境を記録しています');
  const generatedAt = new Date().toISOString();
  const lockBase: ProjectLock = {
    lockVersion: '1.0.0',
    projectDigest: envelope.digest,
    lockHash: '',
    generatedAt,
    runtime: options.runtimeVersions ?? await collectRuntimeVersions(voicevoxVersion),
    assets: lockedAssets,
    scenes: resolvedScenes,
    totalFrames: currentFrame,
    fps: 30,
    credits,
    warnings,
  };
  lockBase.lockHash = digestJson({...lockBase, lockHash: '', generatedAt: ''});
  await validateProjectLock(lockBase, {projectSchemaPath: options.schemaPath});
  await ensureSafeDirectory(projectRoot, `.json-video-work/${project.meta.id}`);
  const captionsPath = resolve(dirname(lockPath), 'captions.srt');
  const chaptersPath = resolve(dirname(lockPath), 'chapters.txt');
  const creditsPath = resolve(dirname(lockPath), 'credits.txt');
  await atomicWrite(captionsPath, makeSrt(resolvedScenes, project.canvas.fps), {overwrite: true});
  await atomicWrite(chaptersPath, makeChapters(project, resolvedScenes, project.canvas.fps), {overwrite: true});
  await atomicWrite(creditsPath, `${credits.join('\n')}\n`, {overwrite: true});
  // The lock is the commit marker: it is only made current after all companion
  // timeline artifacts have been durably written.
  await atomicWriteJson(lockPath, lockBase, {overwrite: true});
  notify(options, 1, 'resolveが完了しました');
  return {dryRun: false, project, lock: lockBase, lockPath, captionsPath, chaptersPath, creditsPath};
}

export async function publishResolveArtifacts(
  projectPath: string,
  _lock: ProjectLock,
  artifacts: RenderArtifacts,
): Promise<RenderArtifacts> {
  const output = artifacts.outputDirectory;
  const project = await import('./fs-safe.js').then(({readJson}) => readJson<VideoProject>(projectPath));
  const candidates: Array<readonly [string, 'captions' | 'chapters' | 'credits']> = [
    ...(project.outputs.captions ? [['captions.srt', 'captions'] as const] : []),
    ...(project.outputs.chapters ? [['chapters.txt', 'chapters'] as const] : []),
    ['credits.txt', 'credits'] as const,
  ];
  const published: RenderArtifacts = {...artifacts};
  for (const [filename, key] of candidates) {
    const target = resolve(output, filename);
    if (key === 'captions') published.captions = target;
    if (key === 'chapters') published.chapters = target;
    if (key === 'credits') published.credits = target;
  }
  return published;
}
