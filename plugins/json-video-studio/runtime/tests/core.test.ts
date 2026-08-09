import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {VideoProject} from '../src/shared/video-types.js';
import {resolveInside} from '../src/core/fs-safe.js';
import {JobQueue} from '../src/core/jobs.js';
import {ProjectService} from '../src/core/project.js';
import {clearSchemaCacheForTests, validateProject} from '../src/core/schema.js';
import {VoicevoxClient} from '../src/core/voicevox.js';

const roots: string[] = [];
const schemaPath = resolve(import.meta.dirname, '../../schemas/video-project.schema.json');
const examplePath = resolve(import.meta.dirname, '../../examples/minimal.video-project.json');

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'json-video-core-'));
  roots.push(root);
  return root;
}

async function minimal(): Promise<VideoProject> {
  return JSON.parse(await readFile(examplePath, 'utf8')) as VideoProject;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  clearSchemaCacheForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('core project contract', () => {
  it('validates the minimal canonical example with strict Ajv', async () => {
    await expect(validateProject(await minimal(), {schemaPath})).resolves.toMatchObject({schemaVersion: '1.0.0'});
  });

  it('rejects traversal and absolute paths', async () => {
    const root = await temporaryRoot();
    await expect(resolveInside(root, '../outside.json')).rejects.toMatchObject({code: 'PATH_ESCAPE'});
    await expect(resolveInside(root, resolve(root, 'absolute.json'))).rejects.toMatchObject({code: 'UNSAFE_PATH'});
  });

  it('serializes competing revision updates', async () => {
    const root = await temporaryRoot();
    const projects = new ProjectService({workspaceRoot: root, schemaPath});
    const first = await projects.create('video-project.json', await minimal());
    const left = structuredClone(first.project);
    const right = structuredClone(first.project);
    left.meta.title = 'left';
    right.meta.title = 'right';
    const settled = await Promise.allSettled([
      projects.update('video-project.json', left, 1),
      projects.update('video-project.json', right, 1),
    ]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejection = settled.find((item) => item.status === 'rejected');
    expect(rejection).toMatchObject({reason: {code: 'REVISION_CONFLICT'}});
    await expect(projects.get('video-project.json')).resolves.toMatchObject({revision: 2});
  });

  it('persists a new revision for each observed external edit', async () => {
    const root = await temporaryRoot();
    const projects = new ProjectService({workspaceRoot: root, schemaPath});
    const created = await projects.create('video-project.json', await minimal());
    const projectPath = resolve(root, 'video-project.json');

    const firstExternalEdit = structuredClone(created.project);
    firstExternalEdit.meta.title = 'first external edit';
    await writeFile(projectPath, `${JSON.stringify(firstExternalEdit, null, 2)}\n`, 'utf8');
    const firstObservation = await projects.get('video-project.json');
    expect(firstObservation).toMatchObject({revision: 2, project: {meta: {title: 'first external edit'}}});

    const firstIndex = JSON.parse(await readFile(resolve(root, '.json-video-work/revisions.json'), 'utf8')) as {
      projects: Record<string, {revision: number; digest: string}>;
    };
    expect(firstIndex.projects['video-project.json']).toEqual({
      revision: 2,
      digest: firstObservation.digest,
      updatedAt: expect.any(String),
    });

    const secondExternalEdit = structuredClone(firstObservation.project);
    secondExternalEdit.meta.title = 'second external edit';
    await writeFile(projectPath, `${JSON.stringify(secondExternalEdit, null, 2)}\n`, 'utf8');
    const secondObservation = await projects.get('video-project.json');
    expect(secondObservation).toMatchObject({revision: 3, project: {meta: {title: 'second external edit'}}});

    const staleUiEdit = structuredClone(firstObservation.project);
    staleUiEdit.meta.title = 'stale UI edit';
    await expect(projects.update('video-project.json', staleUiEdit, firstObservation.revision))
      .rejects.toMatchObject({code: 'REVISION_CONFLICT'});

    const secondIndex = JSON.parse(await readFile(resolve(root, '.json-video-work/revisions.json'), 'utf8')) as {
      projects: Record<string, {revision: number; digest: string}>;
      history: Record<string, Array<{revision: number; digest: string}>>;
    };
    expect(secondIndex.projects['video-project.json']).toMatchObject({
      revision: 3,
      digest: secondObservation.digest,
    });
    expect(secondIndex.history['video-project.json'].map(({revision}) => revision)).toEqual([1, 2, 3]);
  });

  it('rejects a symlinked internal write directory', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await symlink(outside, resolve(root, '.json-video-work'), process.platform === 'win32' ? 'junction' : 'dir');
    const projects = new ProjectService({workspaceRoot: root, schemaPath});
    await expect(projects.create('video-project.json', await minimal())).rejects.toMatchObject({code: 'SYMLINK_ESCAPE'});
  });
});

describe('persistent single-worker queue', () => {
  it('never runs two jobs concurrently and persists terminal state', async () => {
    const root = await temporaryRoot();
    let active = 0;
    let maximum = 0;
    const queue = new JobQueue({
      stateRoot: root,
      handlers: {
        resolve: async (_request, context) => {
          active += 1;
          maximum = Math.max(maximum, active);
          await context.update(0.5, 'half');
          await new Promise((done) => setTimeout(done, 10));
          active -= 1;
          return {ok: true};
        },
      },
    });
    await queue.initialize();
    const one = await queue.start({kind: 'resolve', projectPath: 'one.json'});
    const two = await queue.start({kind: 'resolve', projectPath: 'two.json'});
    await queue.drain();
    expect(maximum).toBe(1);
    expect(queue.get(one.id).status).toBe('succeeded');
    expect(queue.get(two.id).status).toBe('succeeded');
    expect(JSON.parse(await readFile(resolve(root, `${one.id}.json`), 'utf8'))).toMatchObject({status: 'succeeded'});
  });
});

describe('VOICEVOX client boundary', () => {
  it('allows only local endpoints and caches metadata requests', async () => {
    const root = await temporaryRoot();
    expect(() => new VoicevoxClient({baseUrl: 'https://example.com', cacheRoot: root, workspaceRoot: root}))
      .toThrowError(expect.objectContaining({code: 'VOICEVOX_URL_REJECTED'}));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/version')) return new Response(JSON.stringify('test-1'), {status: 200});
      return new Response(JSON.stringify([{speaker_uuid: 'uuid', name: 'test', styles: [{id: 1, name: 'normal'}]}]), {status: 200});
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new VoicevoxClient({baseUrl: 'http://127.0.0.1:50021', cacheRoot: root, workspaceRoot: root});
    await client.version();
    await client.version();
    await client.speakers();
    await client.speakers();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
