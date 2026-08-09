import {randomUUID} from 'node:crypto';
import {lstat, readFile, readdir, realpath, stat} from 'node:fs/promises';
import {basename, dirname, extname, relative, resolve, sep} from 'node:path';
import type {
  OutputEntry,
  ProjectSummary,
  ValidationResult,
  WebJobQueue,
  WebServiceAdapter,
} from '../web/server.js';
import type {JobKind, StoryboardFrameSummary, StoryboardRunSummary} from '../shared/contracts.js';
import type {ProjectLock, Speaker, VideoProject} from '../shared/video-types.js';
import {AppError, asAppError} from './errors.js';
import {atomicWrite, readJson, relativePortable, resolveInside} from './fs-safe.js';
import {classifyUpload} from './media.js';
import {RuntimeService} from './runtime.js';
import {validateProject} from './schema.js';
import {VoicevoxClient} from './voicevox.js';

const SKIP_DIRECTORIES = new Set(['.git', '.json-video-work', 'dist', 'node_modules']);
const LOCK_HASH = /^[a-f0-9]{64}$/u;
const STORYBOARD_FRAME = /^(\d{3})-([a-z][a-z0-9-]{0,63})\.png$/u;

export function createWebJobQueue(runtime: RuntimeService): WebJobQueue {
  return {
    list: async () => runtime.jobs.list(),
    start: (kind: JobKind, projectPath: string, input?: Record<string, unknown>) => runtime.jobs.start({kind, projectPath, ...(input === undefined ? {} : {input})}),
    get: async (jobId: string) => {
      try { return runtime.jobs.get(jobId); } catch { return undefined; }
    },
    cancel: async (jobId: string) => {
      try { return await runtime.jobs.cancel(jobId); } catch { return undefined; }
    },
  };
}

export function createWebServiceAdapter(runtime: RuntimeService): WebServiceAdapter {
  const voicevox = new VoicevoxClient({
    workspaceRoot: runtime.workspaceRoot,
    cacheRoot: resolve(runtime.dataRoot, 'cache', 'voicevox-preview'),
  });
  return {
    async listProjects(): Promise<ProjectSummary[]> {
      const paths = await findProjectFiles(runtime.workspaceRoot);
      const summaries: ProjectSummary[] = [];
      for (const path of paths) {
        try {
          const envelope = await runtime.getProject(path);
          summaries.push({path, title: envelope.project.meta.title, revision: envelope.revision, lockState: envelope.lockState});
        } catch {
          // Only valid video projects are shown.
        }
      }
      return summaries.sort((left, right) => left.path.localeCompare(right.path));
    },
    getProject: (projectPath) => runtime.getProject(projectPath),
    createProject: ({projectPath, project}) => runtime.createProject(projectPath, project),
    updateProject: ({projectPath, project, revision}) => runtime.updateProject(projectPath, project, revision),
    async validateProject(input): Promise<ValidationResult> {
      try {
        await validateProject(input.project, runtime.projects.schemaPath === undefined ? {} : {schemaPath: runtime.projects.schemaPath});
        return {valid: true, errors: [], warnings: []};
      } catch (error) {
        const appError = asAppError(error, 'SCHEMA_VALIDATION_FAILED');
        return {
          valid: false,
          errors: [{...(appError.jsonPointer === undefined ? {} : {jsonPointer: appError.jsonPointer}), message: appError.message}],
          warnings: [],
        };
      }
    },
    async listVoicevoxSpeakers() {
      return (await voicevox.speakers()).map((speaker) => ({
        name: speaker.name,
        speakerUuid: speaker.speaker_uuid,
        styles: speaker.styles,
      }));
    },
    async synthesizeVoicevoxTest({speakerUuid, styleId, text}) {
      if (text.length === 0 || text.length > 200) {
        throw new AppError('VOICE_PREVIEW_TEXT_INVALID', 'Preview text must contain 1–200 characters.', {category: 'schema'});
      }
      const available = await voicevox.speakers();
      const definition = available.find((speaker) => speaker.speaker_uuid === speakerUuid);
      const speaker: Speaker = {
        id: 'preview',
        displayName: definition?.name ?? 'preview',
        voice: {provider: 'voicevox', speakerUuid, styleId},
      };
      const result = await voicevox.synthesize(text, speaker);
      return {audioBase64: (await readFile(result.path)).toString('base64'), mime: 'audio/wav'};
    },
    async uploadAsset({projectPath, filename, bytes, mime}) {
      classifyUpload(filename, mime, bytes.byteLength);
      const projectFile = await runtime.projects.projectPath(projectPath, true);
      const cleanBase = basename(filename, extname(filename)).replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(0, 60) || 'asset';
      const cleanName = `${cleanBase}-${randomUUID().slice(0, 8)}${extname(filename).toLowerCase()}`;
      const relativePath = `assets/uploads/${cleanName}`;
      const target = await resolveInside(dirname(projectFile), relativePath);
      await atomicWrite(target, bytes);
      return {relativePath};
    },
    async listOutputs(projectPath): Promise<OutputEntry[]> {
      const projectFile = await runtime.projects.projectPath(projectPath, true);
      const envelope = await runtime.getProject(projectPath);
      const projectRoot = dirname(projectFile);
      const roots = [resolve(projectRoot, 'dist', envelope.project.meta.id)];
      if (envelope.lockState === 'current') {
        const lockPath = await runtime.projects.safeLockPath(projectFile, envelope.project.meta.id, true);
        const lock = await readJson<ProjectLock>(lockPath);
        roots.push(resolve(projectRoot, '.json-video-work', envelope.project.meta.id, 'storyboard', lock.lockHash));
      }
      const entries: OutputEntry[] = [];
      for (const outputRoot of roots) {
        try {
          await resolveInside(projectRoot, relativePortable(projectRoot, outputRoot), {mustExist: true});
          entries.push(...await walkOutputs(runtime.workspaceRoot, projectRoot, outputRoot));
        } catch (error) {
          if ((error as AppError).code !== 'FILE_NOT_FOUND') throw error;
        }
      }
      return entries.sort((left, right) => left.path.localeCompare(right.path));
    },
    async listStoryboards(projectPath): Promise<StoryboardRunSummary[]> {
      const projectFile = await runtime.projects.projectPath(projectPath, true);
      const envelope = await runtime.getProject(projectPath);
      const projectRoot = dirname(projectFile);
      const storyboardReference = `.json-video-work/${envelope.project.meta.id}/storyboard`;
      const storyboardLexicalPath = resolve(projectRoot, storyboardReference);
      let storyboardRoot: string;
      try {
        if ((await lstat(storyboardLexicalPath)).isSymbolicLink()) {
          throw new AppError('STORYBOARD_SYMLINK', 'storyboard履歴にシンボリックリンクは使用できません。', {category: 'policy'});
        }
        storyboardRoot = await resolveInside(projectRoot, storyboardReference, {mustExist: true});
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as AppError).code === 'FILE_NOT_FOUND') return [];
        throw error;
      }

      let currentLockHash: string | undefined;
      if (envelope.lockState === 'current') {
        const lockPath = await runtime.projects.safeLockPath(projectFile, envelope.project.meta.id, true);
        const lock = await readJson<ProjectLock>(lockPath);
        if (LOCK_HASH.test(lock.lockHash)) currentLockHash = lock.lockHash;
      }

      const runs: StoryboardRunSummary[] = [];
      for (const entry of await readdir(storyboardRoot, {withFileTypes: true})) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !LOCK_HASH.test(entry.name)) continue;
        const runReference = `${storyboardReference}/${entry.name}`;
        const runRoot = await resolveInside(projectRoot, runReference, {mustExist: true});
        if ((await lstat(runRoot)).isSymbolicLink()) continue;
        const frames: StoryboardFrameSummary[] = [];
        for (const frameEntry of await readdir(runRoot, {withFileTypes: true})) {
          if (!frameEntry.isFile() || frameEntry.isSymbolicLink()) continue;
          const match = STORYBOARD_FRAME.exec(frameEntry.name);
          if (!match) continue;
          const frameReference = `${runReference}/${frameEntry.name}`;
          const framePath = await resolveInside(projectRoot, frameReference, {mustExist: true});
          if ((await lstat(framePath)).isSymbolicLink()) continue;
          frames.push({index: Number(match[1]), sceneId: match[2]!, filename: frameEntry.name});
        }
        if (!frames.length) continue;
        frames.sort((left, right) => left.index - right.index || left.sceneId.localeCompare(right.sceneId));
        const metadata = await stat(runRoot);
        runs.push({lockHash: entry.name, isCurrent: entry.name === currentLockHash, createdAt: metadata.mtime.toISOString(), frames});
      }
      return runs.sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent) || right.createdAt.localeCompare(left.createdAt));
    },
  };
}

async function findProjectFiles(workspaceRoot: string): Promise<string[]> {
  const root = await realpath(workspaceRoot);
  const found: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) await walk(path, depth + 1);
      if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.lock.json')) {
        found.push(relativePortable(root, path));
      }
    }
  };
  await walk(root, 0);
  return found;
}

async function walkOutputs(workspaceRoot: string, projectRoot: string, directory: string): Promise<OutputEntry[]> {
  const entries: OutputEntry[] = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    const canonical = await realpath(path);
    const fromRoot = relative(await realpath(projectRoot), canonical);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || fromRoot.startsWith('/')) {
      throw new AppError('OUTPUT_PATH_ESCAPE', 'Output path escaped the project root.', {category: 'policy'});
    }
    if (entry.isDirectory()) entries.push(...await walkOutputs(workspaceRoot, projectRoot, canonical));
    else if (entry.isFile()) {
      const metadata = await stat(canonical);
      entries.push({name: entry.name, path: relativePortable(workspaceRoot, canonical), sizeBytes: metadata.size, modifiedAt: metadata.mtime.toISOString()});
    }
  }
  return entries;
}
