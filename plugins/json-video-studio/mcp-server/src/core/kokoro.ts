import {mkdtemp, mkdir, readFile, rm, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {KokoroVoice, Speaker} from '../shared/video-types.js';
import type {SynthesizedVoice, VoiceSynthesisPlan} from './voicevox.js';
import {AppError, throwIfAborted} from './errors.js';
import {atomicWrite, atomicWriteJson, digestFile, digestJson, readJson, relativePortable, resolveInside} from './fs-safe.js';
import {probeMedia} from './media.js';
import {runProcess} from './process.js';

interface KokoroManifest {
  engine: string;
  version: string;
  voices: string[];
  files: Record<string, string>;
  runnerSha256: string;
}

export interface KokoroClientOptions {
  cacheRoot: string;
  workspaceRoot: string;
  modelsRoot?: string;
  python?: string;
  runner?: string;
}

/** CPU-only offline TTS. Model loading happens only on a cache miss. */
export class KokoroClient {
  private readonly modelsRoot: string;
  constructor(private readonly options: KokoroClientOptions) {
    this.modelsRoot = options.modelsRoot ?? process.env.JSON_VIDEO_KOKORO_MODELS ?? '/opt/kokoro/models';
  }

  private async manifest(): Promise<KokoroManifest> {
    try {
      const value = await readJson<KokoroManifest>(resolve(this.modelsRoot, 'manifest.json'));
      if (value.engine !== 'kokoro-onnx' || typeof value.version !== 'string'
        || !Array.isArray(value.voices) || !value.voices.length
        || !value.voices.every(voice => typeof voice === 'string' && /^[ab][fm]_[a-z]+$/u.test(voice))
        || !value.files || !/^[a-f0-9]{64}$/u.test(value.runnerSha256)
        || !['kokoro-v1.0.onnx', 'voices-v1.0.bin'].every(name => /^[a-f0-9]{64}$/u.test(value.files[name] ?? ''))) {
        throw new Error('Invalid Kokoro model manifest');
      }
      return value;
    } catch (cause) {
      throw new AppError('KOKORO_NOT_INSTALLED', 'Kokoro English TTS models are unavailable.', {
        category: 'dependency', hint: 'Build and use the Dockerfile.english image.', cause,
      });
    }
  }

  async version(signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const manifest = await this.manifest();
    return `kokoro-onnx-${manifest.version}:${digestJson(manifest)}`;
  }

  async voices(signal?: AbortSignal) {
    throwIfAborted(signal);
    return (await this.manifest()).voices.map(voiceId => ({voiceId, language: voiceId.startsWith('a') ? 'en-US' as const : 'en-GB' as const}));
  }

  private parameters(text: string, speaker: Speaker): KokoroVoice & {text: string; speedScale: number; volumeScale: number} {
    const voice = speaker.voice;
    if (!voice || voice.provider !== 'kokoro') throw new AppError('VOICE_NOT_CONFIGURED', 'A Kokoro voice is required.', {category: 'schema'});
    const speedScale = voice.speedScale ?? speaker.speed ?? 1;
    const volumeScale = voice.volumeScale ?? speaker.volume ?? 1;
    if (!text.trim() || text.length > 2000 || !/^[ab][fm]_[a-z]+$/u.test(voice.voiceId)
      || !['en-US', 'en-GB'].includes(voice.language)
      || !voice.voiceId.startsWith(voice.language === 'en-US' ? 'a' : 'b')
      || !Number.isFinite(speedScale) || speedScale < 0.5 || speedScale > 2
      || !Number.isFinite(volumeScale) || volumeScale < 0 || volumeScale > 2) {
      throw new AppError('KOKORO_INPUT_INVALID', 'Invalid English text, voice, language, speed, or volume.', {category: 'schema'});
    }
    return {...voice, text, speedScale, volumeScale};
  }

  private async cached(cacheKey: string, engineVersion: string, text: string): Promise<Pick<SynthesizedVoice, 'path' | 'sha256' | 'sizeBytes' | 'durationMs'> | undefined> {
    try {
      const audioPath = await resolveInside(this.options.cacheRoot, `${cacheKey}.wav`, {mustExist: true});
      const metadataPath = await resolveInside(this.options.cacheRoot, `${cacheKey}.json`, {mustExist: true});
      const metadata = await readJson<Record<string, unknown>>(metadataPath);
      const file = await stat(audioPath);
      if (metadata.engineVersion !== engineVersion || metadata.cacheKey !== cacheKey || metadata.synthesisText !== text
        || metadata.sizeBytes !== file.size || file.size <= 44 || file.size > 100 * 1024 * 1024
        || typeof metadata.durationMs !== 'number' || !Number.isFinite(metadata.durationMs) || metadata.durationMs <= 0 || metadata.durationMs > 3_600_000
        || metadata.sha256 !== await digestFile(audioPath)) return undefined;
      return {path: audioPath, sha256: metadata.sha256 as string, sizeBytes: file.size, durationMs: metadata.durationMs};
    } catch {
      return undefined;
    }
  }

  async plan(text: string, speaker: Speaker, signal?: AbortSignal): Promise<VoiceSynthesisPlan> {
    const parameters = this.parameters(text, speaker);
    const engineVersion = await this.version(signal);
    if (!(await this.manifest()).voices.includes(parameters.voiceId)) {
      throw new AppError('KOKORO_VOICE_NOT_FOUND', `Unknown Kokoro voice: ${parameters.voiceId}`, {category: 'schema'});
    }
    const cacheKey = digestJson({...parameters, engineVersion});
    const cached = await this.cached(cacheKey, engineVersion, text);
    return {engineVersion, cacheKey, speakerName: parameters.voiceId, styleName: parameters.language,
      cacheHit: cached !== undefined, ...(cached ? {durationMs: cached.durationMs} : {})};
  }

  async synthesize(text: string, speaker: Speaker, signal?: AbortSignal): Promise<SynthesizedVoice> {
    throwIfAborted(signal);
    const parameters = this.parameters(text, speaker);
    const plan = await this.plan(text, speaker, signal);
    const cached = await this.cached(plan.cacheKey, plan.engineVersion, text);
    if (cached) return {...plan, ...cached, cacheHit: true, synthesisText: text, relativePath: relativePortable(this.options.workspaceRoot, cached.path)};
    await mkdir(this.options.cacheRoot, {recursive: true});
    const directory = await mkdtemp(resolve(this.options.cacheRoot, '.kokoro-'));
    try {
      const input = resolve(directory, 'input.json');
      const output = resolve(directory, 'audio.wav');
      await atomicWriteJson(input, parameters, {overwrite: false});
      await runProcess(this.options.python ?? process.env.JSON_VIDEO_KOKORO_PYTHON ?? '/opt/kokoro/venv/bin/python', [
        this.options.runner ?? process.env.JSON_VIDEO_KOKORO_RUNNER ?? '/app/tts/kokoro.py',
        '--input', input, '--output', output, '--models', this.modelsRoot,
      ], {timeoutMs: 180_000, ...(signal === undefined ? {} : {signal})});
      throwIfAborted(signal);
      const file = await stat(output);
      if (file.size <= 44 || file.size > 100 * 1024 * 1024) throw new AppError('KOKORO_INVALID_AUDIO', 'Kokoro generated invalid audio size.', {category: 'dependency'});
      const media = await probeMedia(output, signal === undefined ? {} : {signal});
      if (!media.durationMs || media.durationMs > 3_600_000 || !media.codecs.includes('pcm_s16le')) {
        throw new AppError('KOKORO_INVALID_AUDIO', 'Kokoro must generate a measurable PCM WAV.', {category: 'dependency'});
      }
      const audioPath = await resolveInside(this.options.cacheRoot, `${plan.cacheKey}.wav`);
      const metadataPath = await resolveInside(this.options.cacheRoot, `${plan.cacheKey}.json`);
      const metadata = {sha256: await digestFile(output), sizeBytes: file.size, durationMs: media.durationMs,
        engineVersion: plan.engineVersion, cacheKey: plan.cacheKey, synthesisText: text};
      await atomicWrite(audioPath, await readFile(output), {overwrite: true});
      await atomicWriteJson(metadataPath, metadata, {overwrite: true});
      return {...plan, ...metadata, path: audioPath, relativePath: relativePortable(this.options.workspaceRoot, audioPath), cacheHit: false};
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  }
}
