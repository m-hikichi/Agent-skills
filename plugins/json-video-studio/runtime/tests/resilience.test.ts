import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Speaker} from '../src/shared/video-types.js';
import {digestFile} from '../src/core/fs-safe.js';
import {JobQueue} from '../src/core/jobs.js';
import {VoicevoxClient} from '../src/core/voicevox.js';

const roots: string[] = [];

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for asynchronous state change.');
    await new Promise((done) => setTimeout(done, 5));
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('persistent job queue resilience', () => {
  it('cancels a queued job without invoking its handler', async () => {
    const stateRoot = await temporaryRoot('json-video-jobs-queued-');
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((done) => { releaseFirst = done; });
    const handledProjects: string[] = [];
    const queue = new JobQueue({
      stateRoot,
      handlers: {
        resolve: async (request) => {
          handledProjects.push(request.projectPath);
          if (request.projectPath === 'first.json') await firstGate;
          return {projectPath: request.projectPath};
        },
      },
    });
    await queue.initialize();
    const first = await queue.start({kind: 'resolve', projectPath: 'first.json'});
    await waitFor(() => queue.get(first.id).status === 'running');
    const queued = await queue.start({kind: 'resolve', projectPath: 'queued.json'});

    try {
      await expect(queue.cancel(queued.id)).resolves.toMatchObject({
        status: 'cancelled',
        message: 'Cancelled before start.',
      });
    } finally {
      releaseFirst();
    }
    await queue.drain();

    expect(handledProjects).toEqual(['first.json']);
    expect(queue.get(first.id).status).toBe('succeeded');
    expect(queue.get(queued.id).status).toBe('cancelled');
    await expect(readFile(resolve(stateRoot, `${queued.id}.json`), 'utf8'))
      .resolves.toContain('"status": "cancelled"');
  });

  it('aborts a running job and persists its cancelled terminal state', async () => {
    const stateRoot = await temporaryRoot('json-video-jobs-running-');
    let handlerStarted!: () => void;
    const started = new Promise<void>((done) => { handlerStarted = done; });
    const queue = new JobQueue({
      stateRoot,
      handlers: {
        render: async (_request, context) => {
          handlerStarted();
          await new Promise<void>((done) => {
            if (context.signal.aborted) return done();
            context.signal.addEventListener('abort', () => done(), {once: true});
          });
          return {unexpectedSuccess: true};
        },
      },
    });
    await queue.initialize();
    const job = await queue.start({kind: 'render', projectPath: 'video-project.json'});
    await started;

    await queue.cancel(job.id);
    await queue.drain();

    expect(queue.get(job.id)).toMatchObject({status: 'cancelled', message: 'Cancelled'});
    expect(JSON.parse(await readFile(resolve(stateRoot, `${job.id}.json`), 'utf8')))
      .toMatchObject({status: 'cancelled', message: 'Cancelled'});
  });

  it('recovers a persisted running job as interrupted on initialization', async () => {
    const stateRoot = await temporaryRoot('json-video-jobs-recovery-');
    const id = '11111111-1111-4111-8111-111111111111';
    const timestamp = '2026-01-02T03:04:05.000Z';
    await writeFile(resolve(stateRoot, `${id}.json`), JSON.stringify({
      id,
      kind: 'storyboard',
      projectPath: 'video-project.json',
      status: 'running',
      progress: 0.4,
      message: 'Rendering scene 2',
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const queue = new JobQueue({stateRoot, handlers: {}});

    await queue.initialize();

    expect(queue.get(id)).toMatchObject({
      status: 'interrupted',
      progress: 0.4,
      message: 'Process stopped while this job was running.',
    });
    expect(JSON.parse(await readFile(resolve(stateRoot, `${id}.json`), 'utf8')))
      .toMatchObject({status: 'interrupted', message: 'Process stopped while this job was running.'});
  });

  it('ignores a persisted record whose embedded id could escape the job directory', async () => {
    const root = await temporaryRoot('json-video-jobs-poisoned-');
    const stateRoot = resolve(root, 'jobs');
    await mkdir(stateRoot);
    const filenameId = '22222222-2222-4222-8222-222222222222';
    const timestamp = '2026-01-02T03:04:05.000Z';
    await writeFile(resolve(stateRoot, `${filenameId}.json`), JSON.stringify({
      id: '../escaped',
      kind: 'render',
      projectPath: 'video-project.json',
      status: 'running',
      progress: 0.4,
      message: 'poisoned',
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const queue = new JobQueue({stateRoot, handlers: {}});

    await queue.initialize();

    expect(queue.list()).toEqual([]);
    await expect(readFile(resolve(root, 'escaped.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
  });
});

describe('VOICEVOX retry and cache resilience', () => {
  const speaker: Speaker = {
    id: 'narrator',
    displayName: 'Editable project alias',
    voice: {
      provider: 'voicevox',
      speakerUuid: 'speaker-uuid',
      styleId: 7,
      speedScale: 1.1,
      volumeScale: 0.9,
    },
  };

  it('retries a transient server response and then resolves the engine version', async () => {
    const root = await temporaryRoot('json-video-voicevox-retry-');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', {status: 503}))
      .mockResolvedValueOnce(new Response(JSON.stringify('0.25.1'), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const client = new VoicevoxClient({
      baseUrl: 'http://127.0.0.1:50021',
      cacheRoot: root,
      workspaceRoot: root,
      timeoutMs: 1_000,
    });

    await expect(client.version()).resolves.toBe('0.25.1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses a verified cache entry without audio-query or synthesis requests', async () => {
    const root = await temporaryRoot('json-video-voicevox-cache-');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/version')) return new Response(JSON.stringify('test-engine'), {status: 200});
      if (url.endsWith('/speakers')) {
        return new Response(JSON.stringify([{
          speaker_uuid: 'speaker-uuid',
          name: 'Authoritative Engine speaker',
          styles: [{id: 7, name: 'Normal'}],
        }]), {status: 200});
      }
      throw new Error(`Unexpected VOICEVOX request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new VoicevoxClient({
      baseUrl: 'http://127.0.0.1:50021',
      cacheRoot: root,
      workspaceRoot: root,
    });
    const initial = await client.plan('cache me', speaker);
    expect(initial.cacheHit).toBe(false);
    expect(initial).toMatchObject({speakerName: 'Authoritative Engine speaker', styleName: 'Normal'});
    const audioPath = resolve(root, `${initial.cacheKey}.wav`);
    const bytes = Buffer.from('RIFF-cache-test');
    await writeFile(audioPath, bytes);
    await writeFile(resolve(root, `${initial.cacheKey}.json`), JSON.stringify({
      sha256: await digestFile(audioPath),
      sizeBytes: bytes.byteLength,
      durationMs: 875,
      engineVersion: initial.engineVersion,
      cacheKey: initial.cacheKey,
    }));

    await expect(client.plan('cache me', speaker)).resolves.toMatchObject({
      cacheHit: true,
      cacheKey: initial.cacheKey,
      durationMs: 875,
      speakerName: 'Authoritative Engine speaker',
      styleName: 'Normal',
    });
    await expect(client.synthesize('cache me', speaker)).resolves.toMatchObject({
      cacheHit: true,
      cacheKey: initial.cacheKey,
      durationMs: 875,
      path: audioPath,
      speakerName: 'Authoritative Engine speaker',
      styleName: 'Normal',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not trust a cache sidecar that replaces the computed cache key', async () => {
    const root = await temporaryRoot('json-video-voicevox-poisoned-');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/version')) return new Response(JSON.stringify('test-engine'), {status: 200});
      if (url.endsWith('/speakers')) {
        return new Response(JSON.stringify([{
          speaker_uuid: 'speaker-uuid',
          name: 'Authoritative Engine speaker',
          styles: [{id: 7, name: 'Normal'}],
        }]), {status: 200});
      }
      if (url.includes('/audio_query?')) return new Response('invalid poisoned cache', {status: 400});
      throw new Error(`Unexpected VOICEVOX request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new VoicevoxClient({
      baseUrl: 'http://127.0.0.1:50021',
      cacheRoot: root,
      workspaceRoot: root,
    });
    const initial = await client.plan('poison me', speaker);
    const audioPath = resolve(root, `${initial.cacheKey}.wav`);
    const bytes = Buffer.from('RIFF-poisoned-cache-test');
    await writeFile(audioPath, bytes);
    await writeFile(resolve(root, `${initial.cacheKey}.json`), JSON.stringify({
      sha256: await digestFile(audioPath),
      sizeBytes: bytes.byteLength,
      durationMs: 875,
      engineVersion: initial.engineVersion,
      cacheKey: '../escaped',
    }));

    await expect(client.synthesize('poison me', speaker)).rejects.toMatchObject({code: 'VOICEVOX_REQUEST_FAILED'});
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/audio_query?'))).toBe(true);
  });
});
