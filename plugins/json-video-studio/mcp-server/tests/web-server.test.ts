import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {JobKind, JobRecord, ProjectEnvelope} from '../src/shared/contracts.js';
import type {VideoProject} from '../src/shared/video-types.js';
import {passingReviewGates} from '../src/shared/review.js';
import {createWebServiceAdapter} from '../src/core/web-adapter.js';
import {resolveProject} from '../src/core/resolver.js';
import {RuntimeService} from '../src/core/runtime.js';
import {startWebServer, type WebJobQueue, type WebServerHandle} from '../src/web/server.js';

const MUTATION_HEADERS = {'content-type': 'application/json', 'x-json-video-studio': '1'};

class RecordingJobQueue implements WebJobQueue {
  readonly starts: Array<{kind: JobKind; projectPath: string; input?: Record<string, unknown>}> = [];

  async list(): Promise<JobRecord[]> { return []; }

  async start(kind: JobKind, projectPath: string, input?: Record<string, unknown>): Promise<JobRecord> {
    this.starts.push({kind, projectPath, input});
    const now = new Date(0).toISOString();
    return {id: `job-${this.starts.length}`, kind, projectPath, status: 'queued', progress: 0, message: 'queued', createdAt: now, updatedAt: now};
  }

  async get(): Promise<JobRecord | undefined> { return undefined; }
  async cancel(): Promise<JobRecord | undefined> { return undefined; }
}

const handles: WebServerHandle[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

const createFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'json-video-web-test-'));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(workspaceRoot, {recursive: true});
  const jobQueue = new RecordingJobQueue();
  const handle = await startWebServer({host: '127.0.0.1', port: 0, workspaceRoot, jobQueue});
  handles.push(handle);
  return {handle, jobQueue, workspaceRoot};
};

const createProject = async (handle: WebServerHandle, projectPath = 'sample/video-project.json'): Promise<ProjectEnvelope<VideoProject>> => {
  const response = await handle.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: MUTATION_HEADERS,
    payload: {projectPath},
  });
  expect(response.statusCode).toBe(201);
  return response.json<ProjectEnvelope<VideoProject>>();
};

describe('Web API concurrency and render gates', () => {
  it('rejects a non-loopback Host header to prevent DNS rebinding reads', async () => {
    const {handle} = await createFixture();

    const response = await handle.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: {host: 'attacker.example:43120'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({code: 'HOST_REJECTED'});
  });

  it('returns 409 and preserves the winning update when a client saves with a stale revision', async () => {
    const {handle} = await createFixture();
    const initial = await createProject(handle);
    const winner = structuredClone(initial.project);
    winner.meta.title = '先に保存されたタイトル';

    const firstSave = await handle.app.inject({
      method: 'PUT',
      url: '/api/project?path=sample%2Fvideo-project.json',
      headers: MUTATION_HEADERS,
      payload: {revision: initial.revision, project: winner},
    });
    expect(firstSave.statusCode).toBe(200);

    const loser = structuredClone(initial.project);
    loser.meta.title = '競合した古いクライアント';
    const conflictingSave = await handle.app.inject({
      method: 'PUT',
      url: '/api/project?path=sample%2Fvideo-project.json',
      headers: MUTATION_HEADERS,
      payload: {revision: initial.revision, project: loser},
    });

    expect(conflictingSave.statusCode).toBe(409);
    expect(conflictingSave.json()).toMatchObject({code: 'REVISION_CONFLICT'});
    const current = await handle.app.inject({method: 'GET', url: '/api/project?path=sample%2Fvideo-project.json'});
    expect(current.json<ProjectEnvelope<VideoProject>>().project.meta.title).toBe('先に保存されたタイトル');
  });

  it('rejects render before queueing when a formerly current lock becomes stale', async () => {
    const {handle, jobQueue, workspaceRoot} = await createFixture();
    const initial = await createProject(handle);
    const lockDirectory = path.join(workspaceRoot, 'sample', '.json-video-work', initial.project.meta.id);
    await mkdir(lockDirectory, {recursive: true});
    await writeFile(path.join(lockDirectory, 'project.lock.json'), JSON.stringify({projectDigest: initial.digest}), 'utf8');

    const current = await handle.app.inject({method: 'GET', url: '/api/project?path=sample%2Fvideo-project.json'});
    expect(current.json<ProjectEnvelope<VideoProject>>().lockState).toBe('current');

    const edited = structuredClone(initial.project);
    edited.meta.title = 'lock生成後の編集';
    const save = await handle.app.inject({
      method: 'PUT',
      url: '/api/project?path=sample%2Fvideo-project.json',
      headers: MUTATION_HEADERS,
      payload: {revision: initial.revision, project: edited},
    });
    expect(save.statusCode).toBe(200);
    expect(save.json<ProjectEnvelope<VideoProject>>().lockState).toBe('stale');

    const render = await handle.app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: MUTATION_HEADERS,
      payload: {kind: 'render', projectPath: 'sample/video-project.json'},
    });

    expect(render.statusCode).toBe(409);
    expect(render.json()).toEqual({code: 'LOCK_NOT_CURRENT', message: '現在のprojectに対応するlockがありません。先にresolveしてください'});
    expect(jobQueue.starts).toEqual([]);
  });

  it('rejects direct render requests until the current lock has a matching review pass', async () => {
    const {handle, jobQueue, workspaceRoot} = await createFixture();
    const created = await createProject(handle);
    const lockHash = 'c'.repeat(64);
    const workDirectory = path.join(workspaceRoot, 'sample', '.json-video-work', created.project.meta.id);
    await mkdir(workDirectory, {recursive: true});
    await writeFile(path.join(workDirectory, 'project.lock.json'), JSON.stringify({
      projectDigest: created.digest,
      lockHash,
    }));

    const rejected = await handle.app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: MUTATION_HEADERS,
      payload: {kind: 'render', projectPath: 'sample/video-project.json'},
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({code: 'REVIEW_REQUIRED'});
    expect(jobQueue.starts).toEqual([]);

    await writeFile(path.join(workDirectory, 'review.json'), JSON.stringify({
      projectId: created.project.meta.id,
      lockHash,
      iteration: 1,
      status: 'pass',
      gates: passingReviewGates(),
      issues: [],
    }));
    const accepted = await handle.app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: MUTATION_HEADERS,
      payload: {kind: 'render', projectPath: 'sample/video-project.json'},
    });
    expect(accepted.statusCode).toBe(202);
    expect(jobQueue.starts).toEqual([{kind: 'render', projectPath: 'sample/video-project.json', input: undefined}]);
  });

  it.skipIf(process.platform === 'win32')('revalidates an allowlisted output when opening and rejects symlinks', async () => {
    const {workspaceRoot} = await createFixture();
    const outputRoot = path.join(workspaceRoot, 'sample', 'dist', 'sample', 'd'.repeat(64));
    await mkdir(outputRoot, {recursive: true});
    const safePath = path.join(outputRoot, 'safe.txt');
    const leakPath = path.join(outputRoot, 'leak.txt');
    const outsidePath = path.join(path.dirname(workspaceRoot), 'outside-secret.txt');
    await Promise.all([
      writeFile(safePath, 'safe-output'),
      writeFile(outsidePath, 'outside-secret'),
    ]);
    await symlink(outsidePath, leakPath, 'file');
    const safeReference = path.relative(workspaceRoot, safePath).split(path.sep).join('/');
    const leakReference = path.relative(workspaceRoot, leakPath).split(path.sep).join('/');
    const service = {
      async listOutputs() {
        return [
          {name: 'safe.txt', path: safeReference, sizeBytes: 11, modifiedAt: new Date(0).toISOString()},
          {name: 'leak.txt', path: leakReference, sizeBytes: 14, modifiedAt: new Date(0).toISOString()},
        ];
      },
    };
    const handle = await startWebServer({host: '127.0.0.1', port: 0, workspaceRoot, service});
    handles.push(handle);

    const safe = await handle.app.inject({
      method: 'GET',
      url: `/api/output?projectPath=sample%2Fvideo-project.json&path=${encodeURIComponent(safeReference)}`,
    });
    expect(safe.statusCode).toBe(200);
    expect(safe.body).toBe('safe-output');

    const leak = await handle.app.inject({
      method: 'GET',
      url: `/api/output?projectPath=sample%2Fvideo-project.json&path=${encodeURIComponent(leakReference)}`,
    });
    expect(leak.statusCode).toBe(403);
    expect(leak.json()).toMatchObject({code: 'FILE_OPEN_REJECTED'});
  });

  it('lists the current pre-render storyboard in the Web UI output feed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'json-video-web-output-'));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, 'workspace');
    const dataRoot = path.join(root, 'data');
    await Promise.all([mkdir(workspaceRoot, {recursive: true}), mkdir(dataRoot, {recursive: true})]);
    const schemaPath = path.resolve(import.meta.dirname, '../../schemas/video-project.schema.json');
    const runtime = new RuntimeService({workspaceRoot, dataRoot, schemaPath});
    await runtime.initialize();
    const created = await runtime.createProject('sample/video-project.json');
    const resolved = await resolveProject({
      projectPath: 'sample/video-project.json', workspaceRoot, schemaPath,
      runtimeVersions: {node: 'v24-test', remotion: '4.0.503', ffmpeg: 'test', chrome: 'test', font: 'test'},
    });
    expect(resolved.dryRun).toBe(false);
    if (resolved.dryRun) return;
    const storyboardRoot = path.join(workspaceRoot, 'sample', '.json-video-work', created.project.meta.id, 'storyboard', resolved.lock.lockHash);
    await mkdir(storyboardRoot, {recursive: true});
    await Promise.all([
      writeFile(path.join(storyboardRoot, '001-intro-1.png'), 'scene'),
      writeFile(path.join(storyboardRoot, 'contact-sheet.png'), 'contact'),
      writeFile(path.join(storyboardRoot, 'thumbnail-preview.png'), 'thumbnail'),
    ]);

    const adapter = createWebServiceAdapter(runtime);
    const outputs = await adapter.listOutputs('sample/video-project.json');
    expect(outputs.map((entry) => entry.name)).toEqual(['001-intro-1.png', 'contact-sheet.png', 'thumbnail-preview.png']);
    expect(outputs.every((entry) => entry.path.includes(`storyboard/${resolved.lock.lockHash}/`))).toBe(true);

    const edited = structuredClone(created.project);
    edited.meta.title = 'stale storyboard';
    await runtime.updateProject('sample/video-project.json', edited, created.revision);
    await expect(adapter.listOutputs('sample/video-project.json')).resolves.toEqual([]);
  });

  it('lists current and prior storyboard runs and only serves allowlisted scene frames', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'json-video-storyboard-history-'));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, 'workspace');
    const dataRoot = path.join(root, 'data');
    await Promise.all([mkdir(workspaceRoot, {recursive: true}), mkdir(dataRoot, {recursive: true})]);
    const schemaPath = path.resolve(import.meta.dirname, '../../schemas/video-project.schema.json');
    const runtime = new RuntimeService({workspaceRoot, dataRoot, schemaPath});
    await runtime.initialize();
    const created = await runtime.createProject('sample/video-project.json');
    const resolved = await resolveProject({
      projectPath: 'sample/video-project.json', workspaceRoot, schemaPath,
      runtimeVersions: {node: 'v24-test', remotion: '4.0.503', ffmpeg: 'test', chrome: 'test', font: 'test'},
    });
    expect(resolved.dryRun).toBe(false);
    if (resolved.dryRun) return;

    const historyRoot = path.join(workspaceRoot, 'sample', '.json-video-work', created.project.meta.id, 'storyboard');
    const priorHash = 'b'.repeat(64);
    const currentRoot = path.join(historyRoot, resolved.lock.lockHash);
    const priorRoot = path.join(historyRoot, priorHash);
    await Promise.all([mkdir(currentRoot, {recursive: true}), mkdir(priorRoot, {recursive: true}), mkdir(path.join(historyRoot, 'not-a-lock'), {recursive: true})]);
    await Promise.all([
      writeFile(path.join(currentRoot, '001-intro-1.png'), 'current-frame'),
      writeFile(path.join(currentRoot, 'contact-sheet.png'), 'not-a-scene-frame'),
      writeFile(path.join(priorRoot, '001-intro-1.png'), 'prior-frame'),
      writeFile(path.join(priorRoot, '002-old-scene.png'), 'old-frame'),
      writeFile(path.join(historyRoot, 'not-a-lock', '001-secret.png'), 'secret'),
    ]);

    const adapter = createWebServiceAdapter(runtime);
    const runs = await adapter.listStoryboards('sample/video-project.json');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({lockHash: resolved.lock.lockHash, isCurrent: true});
    expect(runs[0]?.frames).toEqual([{index: 1, sceneId: 'intro-1', filename: '001-intro-1.png'}]);
    expect(runs[1]).toMatchObject({lockHash: priorHash, isCurrent: false});
    expect(runs[1]?.frames.map((frame) => frame.sceneId)).toEqual(['intro-1', 'old-scene']);
    expect(JSON.stringify(runs)).not.toContain(workspaceRoot);

    const handle = await startWebServer({host: '127.0.0.1', port: 0, workspaceRoot, service: adapter});
    handles.push(handle);
    const listed = await handle.app.inject({method: 'GET', url: '/api/storyboards?projectPath=sample%2Fvideo-project.json'});
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual(runs);

    const frame = await handle.app.inject({
      method: 'GET',
      url: `/api/storyboard-frame?projectPath=sample%2Fvideo-project.json&lockHash=${priorHash}&filename=002-old-scene.png`,
    });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers['content-type']).toContain('image/png');
    expect(frame.headers['x-content-type-options']).toBe('nosniff');
    expect(frame.body).toBe('old-frame');

    const traversal = await handle.app.inject({
      method: 'GET',
      url: `/api/storyboard-frame?projectPath=sample%2Fvideo-project.json&lockHash=${priorHash}&filename=..%2Fvideo-project.json`,
    });
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json()).toMatchObject({code: 'INVALID_STORYBOARD_REFERENCE'});
  });
});
