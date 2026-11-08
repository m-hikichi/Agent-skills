import {basename, dirname, resolve} from 'node:path';
import type {ProjectEnvelope} from '../shared/contracts.js';
import {BUNDLED_FONT_FAMILY, type ProjectLock, type VideoProject} from '../shared/video-types.js';
import {AppError} from './errors.js';
import {atomicWriteJson, digestJson, ensureSafeDirectory, readJson, relativePortable, resolveInside} from './fs-safe.js';
import {validateProject, validateProjectLock} from './schema.js';

interface RevisionRecord {
  revision: number;
  digest: string;
  updatedAt: string;
}

interface RevisionIndex {
  version: 1;
  projects: Record<string, RevisionRecord>;
  history: Record<string, RevisionRecord[]>;
}

export interface ProjectServiceOptions {
  workspaceRoot: string;
  schemaPath?: string;
}

export function defaultProject(id = 'my-video', title = 'はじめての動画'): VideoProject {
  return {
    schemaVersion: '1.0.0',
    meta: {id, title, description: '', language: 'ja-JP'},
    canvas: {preset: 'youtube-1080p', fps: 30},
    theme: {
      backgroundColor: '#101827',
      foregroundColor: '#f8fafc',
      accentColor: '#38bdf8',
      fontFamily: BUNDLED_FONT_FAMILY,
      spacing: 'comfortable',
      subtitleStyle: {fontSize: 52, maxLines: 2, backgroundColor: '#000000cc', color: '#ffffff'},
    },
    assets: [],
    speakers: [],
    sections: [{
      id: 'intro',
      title: 'イントロ',
      scenes: [{
        id: 'intro-1',
        durationMs: 3000,
        visual: {type: 'title', title, subtitle: 'JSON Video Studio'},
      }],
    }],
    thumbnail: {textLines: [title], layout: 'center'},
    outputs: {video: true, captions: true, chapters: true, thumbnail: true, storyboard: true},
    policies: {allowUnknownRights: false, maxDurationMinutes: 30},
  };
}

export class ProjectService {
  readonly workspaceRoot: string;
  readonly schemaPath?: string;
  readonly workRoot: string;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: ProjectServiceOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.schemaPath = options.schemaPath;
    this.workRoot = resolve(this.workspaceRoot, '.json-video-work');
  }

  async initialize(): Promise<void> {
    await ensureSafeDirectory(this.workspaceRoot, '.json-video-work');
  }

  async projectPath(input: string, mustExist = true): Promise<string> {
    return resolveInside(this.workspaceRoot, input, {mustExist});
  }

  async create(
    input: string,
    initial: unknown = defaultProject(basename(input, '.json')),
  ): Promise<ProjectEnvelope<VideoProject>> {
    return this.withMutation(() => this.createUnlocked(input, initial));
  }

  private async createUnlocked(
    input: string,
    initial: unknown,
  ): Promise<ProjectEnvelope<VideoProject>> {
    await this.initialize();
    const path = await this.projectPath(input, false);
    const project = await validateProject(initial, this.schemaPath === undefined ? {} : {schemaPath: this.schemaPath});
    const digest = digestJson(project);
    await atomicWriteJson(path, project);
    await this.setRevision(relativePortable(this.workspaceRoot, path), {revision: 1, digest, updatedAt: new Date().toISOString()});
    return {project, revision: 1, digest, lockState: 'missing'};
  }

  async get(input: string): Promise<ProjectEnvelope<VideoProject>> {
    return this.withMutation(() => this.getUnlocked(input));
  }

  private async getUnlocked(input: string): Promise<ProjectEnvelope<VideoProject>> {
    const path = await this.projectPath(input, true);
    const project = await validateProject(
      await readJson<unknown>(path),
      this.schemaPath === undefined ? {} : {schemaPath: this.schemaPath},
    );
    const digest = digestJson(project);
    const key = relativePortable(this.workspaceRoot, path);
    const index = await this.readRevisions();
    const known = index.projects[key];
    const revision = known?.digest === digest ? known.revision : (known?.revision ?? 0) + 1;
    if (known?.digest !== digest) {
      await this.setRevision(key, {revision, digest, updatedAt: new Date().toISOString()});
    }
    const lockState = await this.lockState(path, project, digest);
    return {project, revision, digest, lockState};
  }

  async update(input: string, value: unknown, expectedRevision: number): Promise<ProjectEnvelope<VideoProject>> {
    return this.withMutation(() => this.updateUnlocked(input, value, expectedRevision));
  }

  private async updateUnlocked(input: string, value: unknown, expectedRevision: number): Promise<ProjectEnvelope<VideoProject>> {
    await this.initialize();
    const path = await this.projectPath(input, true);
    const current = await this.getUnlocked(input);
    if (current.revision !== expectedRevision) {
      throw new AppError('REVISION_CONFLICT', `Expected revision ${expectedRevision}, current revision is ${current.revision}.`, {
        category: 'schema',
        hint: 'Reload the project, merge changes, and retry.',
      });
    }
    const project = await validateProject(value, this.schemaPath === undefined ? {} : {schemaPath: this.schemaPath});
    const digest = digestJson(project);
    if (digest === current.digest) return current;
    await atomicWriteJson(path, project, {overwrite: true});
    const revision = current.revision + 1;
    await this.setRevision(relativePortable(this.workspaceRoot, path), {revision, digest, updatedAt: new Date().toISOString()});
    return {project, revision, digest, lockState: 'stale'};
  }

  lockPath(projectPath: string, projectId: string): string {
    return resolve(dirname(projectPath), '.json-video-work', projectId, 'project.lock.json');
  }

  async safeLockPath(projectPath: string, projectId: string, mustExist: boolean): Promise<string> {
    const root = dirname(projectPath);
    return resolveInside(root, `.json-video-work/${projectId}/project.lock.json`, {mustExist});
  }

  private async lockState(path: string, project: VideoProject, digest: string): Promise<'missing' | 'current' | 'stale'> {
    try {
      const lock = await validateProjectLock(await readJson<unknown>(await this.safeLockPath(path, project.meta.id, true)), {
        projectSchemaPath: this.schemaPath,
      });
      const selfHash = digestJson({...lock, lockHash: '', generatedAt: ''});
      return lock.projectDigest === digest && lock.lockHash === selfHash ? 'current' : 'stale';
    } catch {
      return 'missing';
    }
  }

  private async readRevisions(): Promise<RevisionIndex> {
    try {
      const path = await resolveInside(this.workspaceRoot, '.json-video-work/revisions.json', {mustExist: true});
      return await readJson<RevisionIndex>(path);
    } catch {
      return {version: 1, projects: {}, history: {}};
    }
  }

  private async setRevision(key: string, value: RevisionRecord): Promise<void> {
    await ensureSafeDirectory(this.workspaceRoot, '.json-video-work');
    const index = await this.readRevisions();
    index.history ??= {};
    index.projects[key] = value;
    const previous = index.history[key]?.at(-1);
    if (previous?.digest !== value.digest) index.history[key] = [...(index.history[key] ?? []), value].slice(-100);
    const path = await resolveInside(this.workspaceRoot, '.json-video-work/revisions.json');
    await atomicWriteJson(path, index, {overwrite: true});
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
