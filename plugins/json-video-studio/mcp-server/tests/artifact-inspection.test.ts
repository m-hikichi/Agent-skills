import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  assertArtifactLockConsistency,
  canonicalLockHash,
  canonicalProjectDigest,
  inspectArtifactOutput,
  type ArtifactManifest,
  type MediaInspection,
} from '../src/render/api.js';
import type {ProjectLock, VideoProject} from '../src/shared/video-types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

const project = (): VideoProject => ({
  schemaVersion: '1.0.0',
  meta: {id: 'artifact-test', title: 'Artifact test', language: 'ja-JP'},
  canvas: {preset: 'youtube-1080p', fps: 30},
  theme: {backgroundColor: '#000000', foregroundColor: '#ffffff', accentColor: '#00ffff', fontFamily: 'Noto Sans CJK JP'},
  assets: [],
  speakers: [],
  sections: [{
    id: 'main', title: 'Main', scenes: [{id: 'scene', durationMs: 1000, visual: {type: 'title', title: 'Test'}}],
  }],
  thumbnail: {textLines: ['Test']},
  outputs: {video: true, captions: false, chapters: false, thumbnail: false, storyboard: true},
  policies: {allowUnknownRights: false, maxDurationMinutes: 30},
});

const lockFor = (value: VideoProject): ProjectLock => {
  const lock: ProjectLock = {
    lockVersion: '1.0.0',
    projectDigest: canonicalProjectDigest(value),
    lockHash: '',
    generatedAt: '2026-08-02T00:00:00.000Z',
    runtime: {node: '24.18.0', remotion: '4.0.503', ffmpeg: 'test', chrome: 'test', font: 'Noto Sans JP'},
    assets: [],
    scenes: [{
      ...value.sections[0]!.scenes[0]!,
      sectionId: 'main',
      sectionTitle: 'Main',
      startFrame: 0,
      durationInFrames: 30,
      audioDurationMs: 0,
      subtitleText: '',
    }],
    totalFrames: 30,
    fps: 30,
    credits: [],
    warnings: [],
  };
  lock.lockHash = canonicalLockHash(lock);
  return lock;
};

const sha256 = (contents: Buffer): string => createHash('sha256').update(contents).digest('hex');

const writeArtifactDirectory = async (
  root: string,
  value: VideoProject,
  lock: ProjectLock,
  reportDurationSeconds: number,
): Promise<ArtifactManifest> => {
  await mkdir(root, {recursive: true});
  const files = new Map<string, Buffer>([
    ['video.mp4', Buffer.from('deterministic fake media')],
    ['credits.txt', Buffer.from('No external assets.\n')],
    ['project.lock.json', Buffer.from(`${JSON.stringify(lock, null, 2)}\n`)],
    ['render-report.json', Buffer.from(`${JSON.stringify({
      projectId: value.meta.id,
      projectDigest: lock.projectDigest,
      lockHash: lock.lockHash,
      outputs: value.outputs,
      inspection: {durationSeconds: reportDurationSeconds},
    }, null, 2)}\n`)],
    ['contact-sheet.png', Buffer.from('deterministic fake contact sheet')],
    ['storyboard/001-scene.png', Buffer.from('deterministic fake storyboard frame')],
    ['storyboard/thumbnail-preview.png', Buffer.from('deterministic fake thumbnail preview')],
  ]);
  for (const [name, contents] of files) {
    await mkdir(path.dirname(path.join(root, name)), {recursive: true});
    await writeFile(path.join(root, name), contents, {flag: 'wx'});
  }
  const entries: ArtifactManifest['files'] = [];
  for (const [name, contents] of files) {
    entries.push({path: name, sizeBytes: (await stat(path.join(root, name))).size, sha256: sha256(contents)});
  }
  const manifest: ArtifactManifest = {
    manifestVersion: '1.0.0',
    projectId: value.meta.id,
    projectDigest: lock.projectDigest,
    lockHash: lock.lockHash,
    createdAt: '2026-08-02T00:00:00.000Z',
    files: entries.sort((left, right) => left.path.localeCompare(right.path)),
  };
  await writeFile(path.join(root, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'});
  return manifest;
};

const mediaInspection = (mediaPath: string, durationSeconds: number): MediaInspection => ({
  mediaPath,
  durationSeconds,
  sizeBytes: 24,
  video: {codec: 'h264', width: 1920, height: 1080, fps: 30, pixelFormat: 'yuv420p'},
  audio: {codec: 'aac', sampleRate: 48000, channels: 2},
});

describe('self-contained artifact inspection', () => {
  it('uses the embedded lock timeline instead of the report duration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-artifacts-'));
    temporaryDirectories.push(root);
    const value = project();
    const lock = lockFor(value);
    const manifest = await writeArtifactDirectory(root, value, lock, 999);

    const result = await inspectArtifactOutput({
      outputDirectory: root,
      expectedLockHash: lock.lockHash,
      mediaInspector: async ({mediaPath}) => mediaInspection(mediaPath, 1),
    });

    expect(result.lock).toEqual(lock);
    expect(result.manifest).toEqual(manifest);
    expect(result.checks.lockIntegrity).toBe(true);
    expect(result.fileCount).toBe(7);
  });

  it('rejects media whose duration disagrees with totalFrames/fps even if the report agrees', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-artifacts-'));
    temporaryDirectories.push(root);
    const value = project();
    const lock = lockFor(value);
    await writeArtifactDirectory(root, value, lock, 999);

    await expect(inspectArtifactOutput({
      outputDirectory: root,
      mediaInspector: async ({mediaPath}) => mediaInspection(mediaPath, 999),
    })).rejects.toMatchObject({code: 'OUTPUT_INSPECTION_FAILED'});
  });

  it('cross-checks the embedded lock, manifest, and report identities', () => {
    const value = project();
    const lock = lockFor(value);
    const manifest: ArtifactManifest = {
      manifestVersion: '1.0.0', projectId: value.meta.id, projectDigest: lock.projectDigest,
      lockHash: lock.lockHash, createdAt: '2026-08-02T00:00:00.000Z', files: [],
    };
    const report = {projectId: value.meta.id, projectDigest: lock.projectDigest, lockHash: lock.lockHash};
    expect(() => assertArtifactLockConsistency(manifest, lock, report)).not.toThrow();
    expect(() => assertArtifactLockConsistency({...manifest, lockHash: '0'.repeat(64)}, lock, report))
      .toThrowError(/lock hashがmanifestと一致しません/u);
    expect(() => assertArtifactLockConsistency(manifest, lock, {...report, lockHash: '0'.repeat(64)}))
      .toThrowError(/lock hashがproject\.lock\.jsonと一致しません/u);
    expect(() => assertArtifactLockConsistency({...manifest, projectDigest: '0'.repeat(64)}, lock, report))
      .toThrowError(/project digestがmanifestと一致しません/u);
    expect(() => assertArtifactLockConsistency(manifest, lock, {...report, projectDigest: '0'.repeat(64)}))
      .toThrowError(/project digestがproject\.lock\.jsonと一致しません/u);
    expect(() => assertArtifactLockConsistency(manifest, {
      ...lock,
      runtime: {...lock.runtime, node: 'tampered'},
    }, report)).toThrowError(/自己ハッシュが一致しません/u);
  });

  it('requires project.lock.json to be declared by the manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-artifacts-'));
    temporaryDirectories.push(root);
    const value = project();
    const lock = lockFor(value);
    const manifest = await writeArtifactDirectory(root, value, lock, 1);
    manifest.files = manifest.files.filter((entry) => entry.path !== 'project.lock.json');
    await writeFile(path.join(root, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(inspectArtifactOutput({
      outputDirectory: root,
      mediaInspector: async ({mediaPath}) => mediaInspection(mediaPath, 1),
    })).rejects.toMatchObject({code: 'ARTIFACT_SET_MISMATCH'});
  });
});
