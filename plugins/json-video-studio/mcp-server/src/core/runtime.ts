import {dirname, isAbsolute, posix, relative, resolve, sep, win32} from 'node:path';
import {lintBrief, lintProject} from './lint.js';
import {readFile, realpath} from 'node:fs/promises';
import type {JobRequest} from './jobs.js';
import type {ProjectLock, RenderArtifacts, Speaker, VideoProject, VoicevoxVoice} from '../shared/video-types.js';
import {atomicWrite, digestFile, ensureSafeDirectory, relativePortable, readJson, resolveInside} from './fs-safe.js';
import {AppError} from './errors.js';
import {JobQueue} from './jobs.js';
import {ProjectService} from './project.js';
import {publishResolveArtifacts, resolveProject} from './resolver.js';
import {VoicevoxClient} from './voicevox.js';
import {storyboardProject, renderProject, inspectArtifactOutput, inspectOutput} from '../render/api.js';
import {extractReviewFrames} from './review-frames.js';

export interface RuntimeOptions {
  workspaceRoot: string;
  dataRoot?: string;
  jobsRoot?: string;
  schemaPath?: string;
}

export interface SpeechRequest {
  /** Exact synthesis text, i.e. what a scene's speechText or dictionary-expanded text would be. */
  text: string;
  speakerUuid: string;
  styleId: number;
  speedScale?: number | undefined;
  volumeScale?: number | undefined;
  pitchScale?: number | undefined;
  intonationScale?: number | undefined;
}

const SPEECH_PREVIEW_DIRECTORY = '.json-video-work/speech';

function escapesRoot(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
}

/**
 * Convert every absolute filesystem path in a JSON-compatible job result to a
 * POSIX path relative to the mounted workspace. This is deliberately
 * fail-closed: a handler must never persist or expose a container-only path (or
 * any other absolute path) that cannot be addressed from CLAUDE_PROJECT_DIR.
 */
export async function portableWorkspaceResult<T>(workspaceRoot: string, value: T): Promise<T> {
  const root = await realpath(resolve(workspaceRoot));

  const visit = async (item: unknown): Promise<unknown> => {
    if (typeof item === 'string') {
      const absoluteInAnySupportedFlavor = isAbsolute(item) || posix.isAbsolute(item) || win32.isAbsolute(item);
      if (!absoluteInAnySupportedFlavor) return item;

      // A path produced by this process must use the host runtime's path
      // flavor. Foreign absolute syntax cannot be proven to reside in root.
      if (!isAbsolute(item)) {
        throw new AppError('JOB_RESULT_PATH_OUTSIDE_WORKSPACE', 'Job result contains an absolute path that is not addressable from the workspace.', {
          category: 'policy',
          hint: 'Keep every generated artifact under CLAUDE_PROJECT_DIR and retry the job.',
        });
      }

      const target = resolve(item);
      if (escapesRoot(root, target)) {
        throw new AppError('JOB_RESULT_PATH_OUTSIDE_WORKSPACE', 'Job result contains an absolute path outside the workspace.', {
          category: 'policy',
          hint: 'Keep every generated artifact under CLAUDE_PROJECT_DIR and retry the job.',
        });
      }

      const portable = relativePortable(root, target) || '.';
      // resolveInside also rejects an in-workspace lexical path whose nearest
      // existing parent resolves through a symlink outside the workspace.
      await resolveInside(root, portable);
      return portable;
    }
    if (Array.isArray(item)) return Promise.all(item.map(visit));
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(await Promise.all(
        Object.entries(item as Record<string, unknown>)
          .map(async ([key, nested]) => [key, await visit(nested)] as const),
      ));
    }
    return item;
  };

  return await visit(value) as T;
}

export class RuntimeService {
  readonly workspaceRoot: string;
  readonly dataRoot: string;
  readonly projects: ProjectService;
  readonly jobs: JobQueue;
  private readonly schemaPath?: string;

  constructor(options: RuntimeOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.dataRoot = resolve(options.dataRoot ?? resolve(this.workspaceRoot, '.json-video-work'));
    this.schemaPath = options.schemaPath;
    this.projects = new ProjectService({
      workspaceRoot: this.workspaceRoot,
      ...(this.schemaPath === undefined ? {} : {schemaPath: this.schemaPath}),
    });
    this.jobs = new JobQueue({
      stateRoot: resolve(options.jobsRoot ?? resolve(this.dataRoot, 'jobs')),
      handlers: {
        resolve: (request, context) => this.handleResolve(request, context),
        storyboard: (request, context) => this.handleStoryboard(request, context),
        render: (request, context) => this.handleRender(request, context),
      },
    });
  }

  async initialize(): Promise<void> {
    await this.projects.initialize();
    await this.jobs.initialize();
  }

  async createProject(path: string, initial?: unknown) {
    return initial === undefined ? this.projects.create(path) : this.projects.create(path, initial);
  }

  async getProject(path: string) {
    return this.projects.get(path);
  }

  async updateProject(path: string, project: unknown, expectedRevision: number) {
    return this.projects.update(path, project, expectedRevision);
  }

  async validateProjectPath(path: string) {
    return this.projects.get(path);
  }

  /**
   * Advisory quality findings for a project: what a machine can tell from the
   * JSON (subtitle size, speech rate, repeated text, uniform layouts, absolute
   * claims) plus whether the production brief in request.json is filled in.
   */
  async lintProjectPath(path: string) {
    const envelope = await this.projects.get(path);
    const projectFile = await this.projects.projectPath(path, true);
    let request: unknown;
    try {
      request = await readJson<unknown>(await resolveInside(dirname(projectFile), `.json-video-work/${envelope.project.meta.id}/request.json`, {mustExist: true}));
    } catch {
      request = undefined;
    }
    const findings = [...lintBrief(request), ...lintProject(envelope.project)];
    return {
      projectId: envelope.project.meta.id,
      digest: envelope.digest,
      briefFound: request !== undefined,
      findings,
      counts: {warning: findings.filter((item) => item.severity === 'warning').length, info: findings.filter((item) => item.severity === 'info').length},
    };
  }

  async inspect(mediaPath: string, signal?: AbortSignal) {
    const safe = await resolveInside(this.workspaceRoot, mediaPath, {mustExist: true});
    const result = await inspectOutput({mediaPath: safe, ...(signal === undefined ? {} : {signal})});
    return this.portableResult(result);
  }

  async inspectArtifacts(outputDirectory: string, expectedLockHash?: string, signal?: AbortSignal) {
    const safe = await resolveInside(this.workspaceRoot, outputDirectory, {mustExist: true});
    const result = await inspectArtifactOutput({
      outputDirectory: safe,
      ...(expectedLockHash === undefined ? {} : {expectedLockHash}),
      ...(signal === undefined ? {} : {signal}),
    });
    return this.portableResult(result);
  }

  /** Sample the rendered MP4 into review sheets under .json-video-work (never inside dist). */
  async reviewFrames(outputDirectory: string, signal?: AbortSignal) {
    const safe = await resolveInside(this.workspaceRoot, outputDirectory, {mustExist: true});
    const result = await extractReviewFrames({outputDirectory: safe, ...(signal === undefined ? {} : {signal})});
    return this.portableResult(result);
  }

  async listSpeakers(signal?: AbortSignal) {
    const client = this.voicevox();
    const [engineVersion, speakers] = await Promise.all([client.version(signal), client.speakers(signal)]);
    return {
      engineVersion,
      speakers: speakers.map((speaker) => ({
        speakerUuid: speaker.speaker_uuid,
        name: speaker.name,
        styles: speaker.styles.map(({id, name}) => ({id, name})),
      })),
    };
  }

  /**
   * Synthesize one utterance without a project. It shares the resolve cache, so
   * the same text and voice parameters are a cache hit in a later resolve.
   */
  async synthesizeSpeech(request: SpeechRequest, signal?: AbortSignal) {
    const voice: VoicevoxVoice = {
      provider: 'voicevox',
      speakerUuid: request.speakerUuid,
      styleId: request.styleId,
      ...(request.speedScale === undefined ? {} : {speedScale: request.speedScale}),
      ...(request.volumeScale === undefined ? {} : {volumeScale: request.volumeScale}),
      ...(request.pitchScale === undefined ? {} : {pitchScale: request.pitchScale}),
      ...(request.intonationScale === undefined ? {} : {intonationScale: request.intonationScale}),
    };
    const speaker: Speaker = {id: 'speech', displayName: 'speech', voice};
    const synthesized = await this.voicevox().synthesize(request.text, speaker, signal);
    // The cache may live outside the workspace (plugin data), so the WAV is
    // copied to a workspace path the caller can open.
    const directory = await ensureSafeDirectory(this.workspaceRoot, SPEECH_PREVIEW_DIRECTORY);
    const target = resolve(directory, `${synthesized.cacheKey}.wav`);
    let materialized = false;
    try {
      materialized = await digestFile(target) === synthesized.sha256;
    } catch {
      // Not materialized yet.
    }
    if (!materialized) await atomicWrite(target, await readFile(synthesized.path), {overwrite: true});
    // Built by hand instead of portableResult: the text and kana are free-form
    // strings that must never be interpreted as paths.
    return {
      audioPath: `${SPEECH_PREVIEW_DIRECTORY}/${synthesized.cacheKey}.wav`,
      synthesisText: request.text,
      kana: synthesized.kana ?? null,
      durationMs: synthesized.durationMs,
      cacheHit: synthesized.cacheHit,
      cacheKey: synthesized.cacheKey,
      sha256: synthesized.sha256,
      sizeBytes: synthesized.sizeBytes,
      engineVersion: synthesized.engineVersion,
      speakerName: synthesized.speakerName,
      styleName: synthesized.styleName,
    };
  }

  async portableResult<T>(value: T): Promise<T> {
    return portableWorkspaceResult(this.workspaceRoot, value);
  }

  private get voiceCacheRoot(): string {
    return resolve(this.dataRoot, 'cache', 'voicevox');
  }

  private voicevox(): VoicevoxClient {
    return new VoicevoxClient({cacheRoot: this.voiceCacheRoot, workspaceRoot: this.workspaceRoot});
  }

  private async absoluteProject(request: JobRequest): Promise<string> {
    return this.projects.projectPath(request.projectPath, true);
  }

  private async safeOutput(input: Record<string, unknown> | undefined): Promise<string | undefined> {
    const output = input?.outputDir;
    if (typeof output !== 'string') return undefined;
    return resolveInside(this.workspaceRoot, output);
  }

  private async handleResolve(request: JobRequest, context: import('./jobs.js').JobContext): Promise<Record<string, unknown>> {
    const result = await resolveProject({
      projectPath: request.projectPath,
      workspaceRoot: this.workspaceRoot,
      dryRun: request.input?.dryRun === true,
      cacheRoot: resolve(this.dataRoot, 'cache', 'voicevox'),
      ...(this.schemaPath === undefined ? {} : {schemaPath: this.schemaPath}),
      signal: context.signal,
      onProgress: ({progress, message}) => void context.update(progress, message),
    });
    if (result.dryRun) return this.portableResult({...result});
    return this.portableResult({
      lockPath: result.lockPath,
      lockHash: result.lock.lockHash,
      totalFrames: result.lock.totalFrames,
      captionsPath: result.captionsPath,
      chaptersPath: result.chaptersPath,
      creditsPath: result.creditsPath,
    });
  }

  private async handleStoryboard(request: JobRequest, context: import('./jobs.js').JobContext): Promise<Record<string, unknown>> {
    const projectPath = await this.absoluteProject(request);
    const outputDir = await this.safeOutput(request.input);
    const result = await storyboardProject({
      projectPath,
      signal: context.signal,
      ...(outputDir === undefined ? {} : {outputDir}),
      onProgress: ({progress, message}) => void context.update(progress, message),
    });
    return this.portableResult(result as unknown as Record<string, unknown>);
  }

  private async handleRender(request: JobRequest, context: import('./jobs.js').JobContext): Promise<Record<string, unknown>> {
    const projectPath = await this.absoluteProject(request);
    const project = await readJson<VideoProject>(projectPath);
    const lockPath = await this.projects.safeLockPath(projectPath, project.meta.id, true);
    const lock = await readJson<ProjectLock>(lockPath);
    const outputDir = await this.safeOutput(request.input);
    const result = await renderProject({
      projectPath,
      lockPath,
      frozenLock: true,
      signal: context.signal,
      ...(outputDir === undefined ? {} : {outputDir}),
      onProgress: ({progress, message}) => void context.update(progress, message),
    });
    const published = await publishResolveArtifacts(projectPath, lock, result as RenderArtifacts);
    return this.portableResult(published as unknown as Record<string, unknown>);
  }
}
