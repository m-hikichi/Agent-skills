import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach, describe, expect, it} from 'vitest';
import {assertSafeAssetReference, resolveSafeAssetPath, stageRenderAssets} from '../src/render/assets.js';
import {
  assertCurrentProjectLock,
  canonicalLockHash,
  canonicalProjectDigest,
  commitOutputDirectory,
  representativeStoryboardFrame,
} from '../src/render/api.js';
import type {LockedAsset, ProjectLock, VideoProject} from '../src/shared/video-types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const {rm} = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

const project = (assetPath = 'assets/pixel.png'): VideoProject => ({
  schemaVersion: '1.0.0', meta: {id: 'security-test', title: 'Test', language: 'ja-JP'},
  canvas: {preset: 'youtube-1080p', fps: 30},
  theme: {backgroundColor: '#000', foregroundColor: '#fff', accentColor: '#0ff', fontFamily: 'Noto Sans CJK JP'},
  assets: [{id: 'pixel', type: 'image', path: assetPath, rights: {status: 'owned'}}], speakers: [],
  sections: [{id: 'main', title: 'Main', scenes: [{id: 'scene', durationMs: 1000, visual: {type: 'media', assetId: 'pixel'}}]}],
  thumbnail: {textLines: ['Test']}, outputs: {video: true, captions: true, chapters: true, thumbnail: true, storyboard: true},
  policies: {allowUnknownRights: false, maxDurationMinutes: 30},
});

const png = (suffix = ''): Buffer => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(suffix),
]);

const lockedAsset = (bytes: Buffer, overrides: Partial<LockedAsset> = {}): LockedAsset => ({
  id: 'pixel', type: 'image', sourcePath: 'assets/pixel.png', resolvedPath: 'assets/pixel.png',
  sha256: createHash('sha256').update(bytes).digest('hex'), mime: 'image/png', sizeBytes: bytes.length,
  ...overrides,
});

const projectLock = (value: VideoProject, assets: LockedAsset[], scenes: ProjectLock['scenes'] = []): ProjectLock => {
  const lock: ProjectLock = {
    lockVersion: '1.0.0', projectDigest: canonicalProjectDigest(value), lockHash: '', generatedAt: '2026-08-02T00:00:00.000Z',
    runtime: {node: '24', remotion: '4.0.503', ffmpeg: 'test', chrome: 'test', font: 'test'},
    assets, scenes, totalFrames: 1, fps: 30, credits: [], warnings: [],
  };
  lock.lockHash = canonicalLockHash(lock);
  return lock;
};

describe('render asset isolation', () => {
  it.each(['../outside.png', 'https://example.com/a.png', 'C:\\secret.png', '\\\\server\\share\\a.png'])(
    'rejects unsafe reference %s',
    (reference) => expect(() => assertSafeAssetReference(reference)).toThrow(),
  );

  it('resolves and stages a project-local asset', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-test-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', 'pixel.png'), png());
    expect(await resolveSafeAssetPath(root, 'assets/pixel.png')).toBe(await import('node:fs/promises').then(({realpath}) => realpath(path.join(root, 'assets', 'pixel.png'))));
    const staged = await stageRenderAssets(root, project());
    try {
      expect(staged.assetUrls.pixel).toMatch(/^remotion-static:assets\/[a-f0-9]{16}-pixel\.png$/u);
    } finally {
      await staged.cleanup();
    }
  });

  it('rejects an asset changed after the lock was created', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-lock-test-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'assets'));
    const original = png();
    const filename = path.join(root, 'assets', 'pixel.png');
    await writeFile(filename, original);
    const value = project();
    const lock = projectLock(value, [lockedAsset(original)]);
    await writeFile(filename, Buffer.concat([original, Buffer.from([0])]));
    await expect(stageRenderAssets(root, value, lock)).rejects.toMatchObject({code: 'LOCK_ASSET_SIZE_MISMATCH'});
  });

  it('rejects a recomputed lock redirecting an asset id to a different allowed file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-lock-redirect-test-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'assets'));
    const original = png('original');
    const alternate = png('alternate');
    await writeFile(path.join(root, 'assets', 'pixel.png'), original);
    await writeFile(path.join(root, 'assets', 'alternate.png'), alternate);
    const value = project();
    const lock = projectLock(value, [lockedAsset(alternate, {resolvedPath: 'assets/alternate.png'})]);
    await expect(stageRenderAssets(root, value, lock)).rejects.toMatchObject({code: 'LOCK_ASSET_BINDING_MISMATCH'});
  });

  it('rejects SVG redirection even when the lock hash and file hash were recomputed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-lock-svg-test-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'assets'));
    const original = png();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await writeFile(path.join(root, 'assets', 'pixel.png'), original);
    await writeFile(path.join(root, 'assets', 'payload.svg'), svg);
    const value = project();
    const lock = projectLock(value, [lockedAsset(svg, {
      resolvedPath: 'assets/payload.svg', mime: 'image/svg+xml', sizeBytes: svg.length,
    })]);
    await expect(stageRenderAssets(root, value, lock)).rejects.toMatchObject({code: 'LOCK_ASSET_EXTENSION_REJECTED'});
  });

  it.each([
    {change: {sourcePath: 'assets/other.png'}, label: 'sourcePath'},
    {change: {type: 'audio' as const}, label: 'type'},
  ])('rejects a lock whose $label is inconsistent with the project asset', async ({change}) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-lock-binding-test-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'assets'));
    const original = png();
    await writeFile(path.join(root, 'assets', 'pixel.png'), original);
    const value = project();
    const lock = projectLock(value, [lockedAsset(original, change)]);
    await expect(stageRenderAssets(root, value, lock)).rejects.toMatchObject({code: 'LOCK_ASSET_BINDING_MISMATCH'});
  });

  it('fails closed when an allowed extension contains unknown HTML bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-mime-test-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', 'pixel.png'), '<html><script>alert(1)</script></html>');
    await expect(stageRenderAssets(root, project())).rejects.toMatchObject({code: 'ASSET_MIME_UNKNOWN'});
  });

  it('continues to stage resolver-generated VOICEVOX WAV assets', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-voice-stage-test-'));
    temporaryDirectories.push(root);
    const value = project();
    const cacheKey = 'c'.repeat(64);
    const voicePath = `.json-video-work/${value.meta.id}/voice/${cacheKey}.wav`;
    await mkdir(path.join(root, 'assets'), {recursive: true});
    await mkdir(path.dirname(path.join(root, voicePath)), {recursive: true});
    const image = png();
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    await writeFile(path.join(root, 'assets', 'pixel.png'), image);
    await writeFile(path.join(root, voicePath), wav);
    const voiceId = 'voice:scene';
    const voice: LockedAsset = {
      id: voiceId, type: 'voice', sourcePath: `voicevox:${cacheKey}`, resolvedPath: voicePath,
      sha256: createHash('sha256').update(wav).digest('hex'), mime: 'audio/wav', sizeBytes: wav.length, durationMs: 1000,
      voice: {
        provider: 'voicevox', engineVersion: '0.25.1', speakerUuid: 'speaker', speakerName: 'Speaker',
        styleId: 1, styleName: 'Normal', speedScale: 1, volumeScale: 1, pitchScale: 0, intonationScale: 1,
        cacheKey, textSha256: 'd'.repeat(64),
      },
    };
    const scenes: ProjectLock['scenes'] = [{
      ...value.sections[0]!.scenes[0]!, sectionId: 'main', sectionTitle: 'Main', startFrame: 0,
      durationInFrames: 30, audioDurationMs: 1000, resolvedAudioAssetId: voiceId, subtitleText: '',
    }];
    const lock = projectLock(value, [lockedAsset(image), voice], scenes);
    const staged = await stageRenderAssets(root, value, lock);
    try {
      expect(staged.assetUrls[voiceId]).toMatch(/\.wav$/u);
    } finally {
      await staged.cleanup();
    }
  });

  it('uses canonical object-key ordering for frozen-lock digest', () => {
    const first = project();
    const second = JSON.parse(JSON.stringify(first)) as VideoProject;
    second.meta = {language: 'ja-JP', title: 'Test', id: 'security-test'};
    expect(canonicalProjectDigest(first)).toBe(canonicalProjectDigest(second));
  });

  it('requires storyboard inputs to match the current self-hashed lock', () => {
    const value = project();
    const lock: ProjectLock = {
      lockVersion: '1.0.0', projectDigest: canonicalProjectDigest(value), lockHash: '', generatedAt: '2026-08-02T00:00:00.000Z',
      runtime: {node: '24', remotion: '4.0.503', ffmpeg: 'test', chrome: 'test', font: 'test'},
      assets: [], scenes: [], totalFrames: 1, fps: 30, credits: [], warnings: [],
    };
    lock.lockHash = canonicalLockHash(lock);
    expect(() => assertCurrentProjectLock(value, lock)).not.toThrow();

    const edited = structuredClone(value);
    edited.meta.title = 'edited after resolve';
    expect(() => assertCurrentProjectLock(edited, lock)).toThrowError(expect.objectContaining({code: 'LOCK_STALE'}));
    expect(() => assertCurrentProjectLock(value, {...lock, totalFrames: 2})).toThrowError(expect.objectContaining({code: 'LOCK_HASH_MISMATCH'}));
  });

  it('selects the same bounded representative frame for the same locked scene', () => {
    const scene = {startFrame: 30, durationInFrames: 100};
    expect(representativeStoryboardFrame(scene, 180)).toBe(42);
    expect(representativeStoryboardFrame(scene, 180)).toBe(representativeStoryboardFrame(structuredClone(scene), 180));
    expect(representativeStoryboardFrame({startFrame: 179, durationInFrames: 60}, 180)).toBe(179);
  });

  it('does not publish an output directory when cancellation wins before commit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-cancel-commit-'));
    temporaryDirectories.push(root);
    const temporaryOutput = path.join(root, '.rendering');
    const outputDirectory = path.join(root, 'published');
    await mkdir(temporaryOutput);
    await writeFile(path.join(temporaryOutput, 'video.mp4'), 'partial');
    const controller = new AbortController();
    controller.abort();

    await expect(commitOutputDirectory(temporaryOutput, outputDirectory, controller.signal))
      .rejects.toMatchObject({code: 'CANCELLED'});
    await expect(import('node:fs/promises').then(({access}) => access(outputDirectory)))
      .rejects.toMatchObject({code: 'ENOENT'});
  });
});
