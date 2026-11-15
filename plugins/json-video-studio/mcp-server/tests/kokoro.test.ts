import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {KokoroClient} from '../src/core/kokoro.js';
import {resolveProject} from '../src/core/resolver.js';
import {RuntimeService} from '../src/core/runtime.js';
import type {Speaker, VideoProject} from '../src/shared/video-types.js';

const roots: string[] = [];
const root = async () => {const directory = await mkdtemp(resolve(tmpdir(), 'kokoro-test-')); roots.push(directory); return directory;};
afterEach(async () => {await Promise.all(roots.splice(0).map(path => rm(path, {recursive: true, force: true})));});
const speaker: Speaker = {id: 'narrator', displayName: 'Narrator', voice: {provider: 'kokoro', voiceId: 'af_heart', language: 'en-US'}};
const pluginRoot = resolve(import.meta.dirname, '../..');
const schemaPath = resolve(pluginRoot, 'schemas/video-project.schema.json');

const mockEngine = async () => {
  const directory = await root();
  const models = resolve(directory, 'models');
  await mkdir(models);
  await writeFile(resolve(models, 'manifest.json'), JSON.stringify({engine: 'kokoro-onnx', version: 'test', voices: ['af_heart', 'bf_emma'], runnerSha256: 'a'.repeat(64), files: {'kokoro-v1.0.onnx': 'b'.repeat(64), 'voices-v1.0.bin': 'c'.repeat(64)}}));
  const runner = resolve(directory, 'runner.mjs');
  await writeFile(runner, `
    import {appendFile, readFile, writeFile} from 'node:fs/promises';
    const input = JSON.parse(await readFile(process.argv[process.argv.indexOf('--input') + 1], 'utf8'));
    if (!input.text) throw new Error('Missing text');
    const wav = Buffer.alloc(16044);
    wav.write('RIFF'); wav.writeUInt32LE(16036, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    await writeFile(process.argv[process.argv.indexOf('--output') + 1], wav);
    await appendFile(new URL('./calls.txt', import.meta.url), 'called\\n');
  `);
  const client = new KokoroClient({workspaceRoot: directory, cacheRoot: resolve(directory, 'cache'), modelsRoot: models, python: process.execPath, runner});
  return {directory, models, client};
};

describe('Kokoro cache and process boundary', () => {
  it('plans without synthesis/writes and caches audio by text, voice parameters and model fingerprint', async () => {
    const {directory, models, client} = await mockEngine();
    const text = 'Hello "world". $() is text, never a shell command.';
    const plan = await client.plan(text, speaker);
    expect(plan.cacheHit).toBe(false);
    await expect(readFile(resolve(directory, 'calls.txt'))).rejects.toBeTruthy();
    await expect(readFile(resolve(directory, 'cache', `${plan.cacheKey}.wav`))).rejects.toBeTruthy();
    const first = await client.synthesize(text, speaker);
    expect(first).toMatchObject({cacheHit: false, durationMs: 1000, synthesisText: text});
    expect(await client.synthesize(text, speaker)).toMatchObject({cacheHit: true, sha256: first.sha256});
    expect(await readFile(resolve(directory, 'calls.txt'), 'utf8')).toBe('called\n');
    expect((await client.plan('Different text.', speaker)).cacheKey).not.toBe(plan.cacheKey);
    expect((await client.plan(text, {...speaker, speed: 1.2})).cacheKey).not.toBe(plan.cacheKey);
    expect((await client.plan(text, {...speaker, volume: 0.8})).cacheKey).not.toBe(plan.cacheKey);
    const manifest = JSON.parse(await readFile(resolve(models, 'manifest.json'), 'utf8'));
    manifest.runnerSha256 = 'd'.repeat(64);
    await writeFile(resolve(models, 'manifest.json'), JSON.stringify(manifest));
    expect((await client.plan(text, speaker)).cacheKey).not.toBe(plan.cacheKey);
  });

  it('regenerates tampered WAVs and corrupt metadata, rejects invalid voices, and honors cancellation', async () => {
    const {directory, client} = await mockEngine();
    const first = await client.synthesize('Hello world.', speaker);
    await writeFile(first.path, 'corrupt');
    expect((await client.synthesize('Hello world.', speaker)).cacheHit).toBe(false);
    const metadata = resolve(directory, 'cache', `${first.cacheKey}.json`);
    const value = JSON.parse(await readFile(metadata, 'utf8'));
    value.durationMs = -1;
    await writeFile(metadata, JSON.stringify(value));
    expect((await client.synthesize('Hello world.', speaker)).cacheHit).toBe(false);
    const voice = {provider: 'kokoro' as const, voiceId: 'af_unknown', language: 'en-US' as const};
    await expect(client.plan('Hello.', {...speaker, voice})).rejects.toMatchObject({code: 'KOKORO_VOICE_NOT_FOUND'});
    await expect(client.plan('Hello.', {...speaker, voice: {...voice, voiceId: 'bf_emma'}})).rejects.toMatchObject({code: 'KOKORO_INPUT_INVALID'});
    await expect(client.synthesize('Hello.', speaker, AbortSignal.abort())).rejects.toMatchObject({code: 'CANCELLED'});
  });
});

describe.skipIf(!process.env.JSON_VIDEO_KOKORO_MODELS)('installed offline Kokoro engine', () => {
  it.each(['en-US', 'en-GB'] as const)('generates %s speech and resolves a project using the same cached WAV', async language => {
    const directory = await root();
    const dataRoot = resolve(directory, 'data');
    const runtime = new RuntimeService({workspaceRoot: directory, dataRoot, schemaPath});
    const voices = await runtime.listEnglishVoices();
    expect(voices.voices.some(voice => voice.language === language)).toBe(true);
    const project: VideoProject = JSON.parse(await readFile(resolve(pluginRoot, 'examples/english-tts.video-project.json'), 'utf8'));
    project.meta.language = language;
    const voiceId = language === 'en-US' ? 'af_heart' : 'bf_emma';
    const text = project.sections[0]!.scenes[0]!.text!;
    project.speakers[0]!.voice = {provider: 'kokoro', voiceId, language};
    const preview = await runtime.synthesizeEnglishSpeech({text, voiceId, language});
    expect(preview.cacheHit).toBe(false);
    expect(preview.kana).toBeNull();
    expect(preview.durationMs).toBeGreaterThan(1000);
    expect(preview.sizeBytes).toBeGreaterThan(24000);
    expect((await runtime.synthesizeEnglishSpeech({text, voiceId, language})).cacheHit).toBe(true);
    await writeFile(resolve(directory, 'video-project.json'), JSON.stringify(project));
    const options = {projectPath: 'video-project.json', workspaceRoot: directory, schemaPath, cacheRoot: resolve(dataRoot, 'cache/voicevox')};
    const plan = await resolveProject({...options, dryRun: true});
    expect(plan).toMatchObject({dryRun: true, voicevoxCalls: [], kokoroCalls: [{cacheHit: true}], cacheHits: 1});
    const result = await resolveProject(options);
    if (result.dryRun) throw new Error('Expected resolved project');
    const asset = result.lock.assets.find(asset => asset.type === 'voice')!;
    expect(asset).toMatchObject({sha256: preview.sha256, durationMs: preview.durationMs, voice: {provider: 'kokoro', voiceId, language, synthesisText: text}});
    expect(asset.voice?.kana).toBeUndefined();
    expect(result.lock.runtime.voicevox).toBeUndefined();
    expect(result.lock.credits).toContain(`Kokoro-82M (Apache-2.0):${voiceId}`);
    expect(await readFile(result.captionsPath, 'utf8')).toContain('Welcome to JSON Video Studio.');
  }, 180_000);
});
