import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {ProjectLock, Speaker, VideoProject} from '../src/shared/video-types.js';
import {digestFile} from '../src/core/fs-safe.js';
import {resolveProject, type VoiceProvider} from '../src/core/resolver.js';

const pluginRoot = resolve(import.meta.dirname, '..', '..');
const schemaPath = resolve(pluginRoot, 'schemas', 'video-project.schema.json');
const roots: string[] = [];
const runtime: ProjectLock['runtime'] = {
  node: 'v24.0.0', remotion: '4.0.503', ffmpeg: 'ffmpeg-test', chrome: 'chrome-test', font: 'Noto-test', voicevox: 'test-engine',
};

const fixture = async (name: string): Promise<VideoProject> => JSON.parse(await readFile(resolve(pluginRoot, 'examples', name), 'utf8')) as VideoProject;
const root = async (): Promise<string> => { const value = await mkdtemp(resolve(tmpdir(), 'json-video-resolver-')); roots.push(value); return value; };

const pcmWav = (durationMs: number, sampleRate = 8_000): Buffer => {
  const sampleCount = Math.round((durationMs / 1_000) * sampleRate);
  const dataBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
};

afterEach(async () => Promise.all(roots.splice(0).map((value) => rm(value, {recursive: true, force: true}))));

describe('timeline resolver', () => {
  it('resolves a silent project with exact frame, chapter, and companion artifacts', async () => {
    const workspace = await root();
    await writeFile(resolve(workspace, 'video-project.json'), JSON.stringify(await fixture('minimal.video-project.json')));
    const result = await resolveProject({projectPath: 'video-project.json', workspaceRoot: workspace, schemaPath, runtimeVersions: runtime});
    expect(result.dryRun).toBe(false);
    if (result.dryRun) return;
    expect(result.lock).toMatchObject({fps: 30, totalFrames: 90, scenes: [{startFrame: 0, durationInFrames: 90, audioDurationMs: 0}]});
    expect(await readFile(result.captionsPath, 'utf8')).toBe('');
    expect(await readFile(result.chaptersPath, 'utf8')).toBe('00:00:00.000 オープニング\n');
    expect(JSON.parse(await readFile(result.lockPath, 'utf8'))).toMatchObject({lockHash: result.lock.lockHash});
  });

  it('records VOICEVOX parameters and aligns subtitle end to the audio frame boundary', async () => {
    const workspace = await root();
    const project = await fixture('dialogue.video-project.json');
    project.sections = [{...project.sections[0]!, scenes: [project.sections[0]!.scenes[0]!]}];
    project.speakers[0]!.displayName = '利用者が編集した別名';
    const source = resolve(workspace, 'mock.wav');
    await writeFile(source, Buffer.from('RIFF-mocked-voice-data'));
    const sha256 = await digestFile(source);
    const provider: VoiceProvider = {
      version: async () => 'test-engine',
      plan: async () => ({engineVersion: 'test-engine', cacheKey: 'c'.repeat(64), cacheHit: true, durationMs: 1001, speakerName: '四国めたん', styleName: 'ノーマル'}),
      synthesize: async (_text: string, _speaker: Speaker) => ({
        path: source, relativePath: 'mock.wav', sha256, sizeBytes: 22, durationMs: 1001,
        engineVersion: 'test-engine', cacheKey: 'c'.repeat(64), cacheHit: true,
        speakerName: '四国めたん', styleName: 'ノーマル',
      }),
    };
    await writeFile(resolve(workspace, 'video-project.json'), JSON.stringify(project));
    const result = await resolveProject({projectPath: 'video-project.json', workspaceRoot: workspace, schemaPath, runtimeVersions: runtime, voiceProvider: provider, cacheRoot: resolve(workspace, 'shared-cache')});
    expect(result.dryRun).toBe(false);
    if (result.dryRun) return;
    expect(result.lock.scenes[0]).toMatchObject({startFrame: 0, durationInFrames: 40, audioDurationMs: 1001, resolvedAudioAssetId: 'voice:intro-title'});
    expect(result.lock.assets[0]).toMatchObject({
      id: 'voice:intro-title', sha256,
      voice: {
        provider: 'voicevox', engineVersion: 'test-engine', speakerUuid: '7ffcb7ce-00ec-4bdc-82cd-45a8889e43ff',
        speakerName: '四国めたん', styleId: 2, styleName: 'ノーマル', cacheKey: 'c'.repeat(64),
      },
    });
    expect(await readFile(result.captionsPath, 'utf8')).toContain('00:00:00,000 --> 00:00:01,033');
    expect(result.lock.credits).toContain('VOICEVOX:四国めたん');
    expect(result.lock.credits).not.toContain('VOICEVOX:利用者が編集した別名');
    expect(await readFile(result.creditsPath, 'utf8')).toBe('VOICEVOX:四国めたん\n');
  });

  it('measures a user-provided WAV with ffprobe and bypasses VOICEVOX', async () => {
    const workspace = await root();
    const project = await fixture('dialogue.video-project.json');
    const scene = project.sections[0]!.scenes[0]!;
    project.sections = [{...project.sections[0]!, scenes: [scene]}];
    project.assets = [{
      id: 'user-narration',
      type: 'audio',
      path: 'narration.wav',
      rights: {status: 'owned', author: 'テスト利用者'},
    }];
    scene.audioAssetId = 'user-narration';
    const audioPath = resolve(workspace, 'narration.wav');
    await writeFile(audioPath, pcmWav(1_001));
    const audioSha256 = await digestFile(audioPath);
    await writeFile(resolve(workspace, 'video-project.json'), JSON.stringify(project));

    let synthesisCalls = 0;
    const provider: VoiceProvider = {
      version: async () => { throw new Error('user audio must not query VOICEVOX'); },
      plan: async () => { throw new Error('user audio must not plan VOICEVOX synthesis'); },
      synthesize: async () => {
        synthesisCalls += 1;
        throw new Error('user audio must not synthesize with VOICEVOX');
      },
    };
    const result = await resolveProject({
      projectPath: 'video-project.json',
      workspaceRoot: workspace,
      schemaPath,
      runtimeVersions: runtime,
      voiceProvider: provider,
    });

    expect(result.dryRun).toBe(false);
    if (result.dryRun) return;
    expect(synthesisCalls).toBe(0);
    expect(result.lock.scenes[0]).toMatchObject({
      startFrame: 0,
      audioAssetId: 'user-narration',
      resolvedAudioAssetId: 'user-narration',
      audioDurationMs: 1_001,
      durationInFrames: 40,
    });
    expect(result.lock.totalFrames).toBe(40);
    expect(result.lock.assets).toEqual([
      expect.objectContaining({
        id: 'user-narration',
        type: 'audio',
        mime: 'audio/wav',
        sha256: audioSha256,
        durationMs: 1_001,
        rights: {status: 'owned', author: 'テスト利用者'},
      }),
    ]);
    expect(result.lock.assets[0]!.voice).toBeUndefined();
    expect(result.lock.runtime.voicevox).toBe('test-engine');
    expect(await readFile(result.captionsPath, 'utf8')).toContain('00:00:00,000 --> 00:00:01,033');
    expect(await readFile(result.creditsPath, 'utf8')).toBe('user-narration — テスト利用者\n');
    expect(JSON.parse(await readFile(result.lockPath, 'utf8'))).toMatchObject({
      lockHash: result.lock.lockHash,
      totalFrames: 40,
      assets: [{id: 'user-narration', sha256: audioSha256, durationMs: 1_001}],
    });
  });

  it('dry-run reports cache hits, call count, estimates, and rights warnings without a lock write', async () => {
    const workspace = await root();
    const project = await fixture('dialogue.video-project.json');
    project.sections = [{...project.sections[0]!, scenes: [project.sections[0]!.scenes[0]!]}];
    await writeFile(resolve(workspace, 'video-project.json'), JSON.stringify(project));
    const provider: VoiceProvider = {
      version: async () => 'test-engine',
      plan: async () => ({engineVersion: 'test-engine', cacheKey: 'd'.repeat(64), cacheHit: true, durationMs: 1200, speakerName: '四国めたん', styleName: 'ノーマル'}),
      synthesize: async () => { throw new Error('dry-run must not synthesize'); },
    };
    const result = await resolveProject({projectPath: 'video-project.json', workspaceRoot: workspace, schemaPath, dryRun: true, voiceProvider: provider});
    expect(result).toMatchObject({dryRun: true, cacheHits: 1, estimatedDurationMs: 1500, estimatedFrames: 45, rightsWarnings: []});
    expect(result.voicevoxCalls[0]).toMatchObject({cacheHit: true, cacheKey: 'd'.repeat(64), estimatedDurationMs: 1200});
    await expect(readFile(resolve(workspace, '.json-video-work', project.meta.id, 'project.lock.json'))).rejects.toBeTruthy();
  });
});
