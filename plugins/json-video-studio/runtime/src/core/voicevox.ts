import {mkdir, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {ResolvedVoicevoxIdentity, Speaker, VoicevoxVoice} from '../shared/video-types.js';
import {AppError, throwIfAborted} from './errors.js';
import {atomicWrite, atomicWriteJson, digestFile, digestJson, ensureSafeDirectory, readJson, relativePortable, resolveInside} from './fs-safe.js';
import {probeMedia} from './media.js';

interface VoicevoxStyle {id: number; name: string}
interface VoicevoxSpeaker {speaker_uuid: string; name: string; styles: VoicevoxStyle[]}

interface VoiceCacheMetadata {
  sha256: string;
  sizeBytes: number;
  durationMs: number;
  engineVersion: string;
  cacheKey: string;
}

function validateCacheMetadata(
  value: unknown,
  expected: {engineVersion: string; cacheKey: string},
): VoiceCacheMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VOICE_CACHE_METADATA_INVALID', 'VOICEVOX cache metadata is not an object.', {category: 'policy'});
  }
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(metadata.sha256)
    || typeof metadata.sizeBytes !== 'number'
    || !Number.isSafeInteger(metadata.sizeBytes)
    || metadata.sizeBytes <= 0
    || metadata.sizeBytes > 100 * 1024 * 1024
    || typeof metadata.durationMs !== 'number'
    || !Number.isFinite(metadata.durationMs)
    || metadata.durationMs <= 0
    || metadata.durationMs > 3_600_000
    || metadata.engineVersion !== expected.engineVersion
    || metadata.cacheKey !== expected.cacheKey
    || !/^[a-f0-9]{64}$/u.test(expected.cacheKey)
  ) {
    throw new AppError('VOICE_CACHE_METADATA_INVALID', 'VOICEVOX cache metadata does not match its cache key and Engine version.', {
      category: 'policy',
    });
  }
  return {
    sha256: metadata.sha256,
    sizeBytes: metadata.sizeBytes,
    durationMs: metadata.durationMs,
    engineVersion: expected.engineVersion,
    cacheKey: expected.cacheKey,
  };
}

export interface SynthesizedVoice extends ResolvedVoicevoxIdentity {
  path: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  durationMs: number;
  engineVersion: string;
  cacheKey: string;
  cacheHit: boolean;
}

export interface VoiceSynthesisPlan extends ResolvedVoicevoxIdentity {
  engineVersion: string;
  cacheKey: string;
  cacheHit: boolean;
  durationMs?: number;
}

export interface VoicevoxClientOptions {
  baseUrl?: string;
  cacheRoot: string;
  workspaceRoot: string;
  timeoutMs?: number;
}

export class VoicevoxClient {
  private readonly baseUrl: string;
  private readonly cacheRoot: string;
  private readonly workspaceRoot: string;
  private readonly timeoutMs: number;
  private versionPromise?: Promise<string>;
  private speakersPromise?: Promise<VoicevoxSpeaker[]>;

  constructor(options: VoicevoxClientOptions) {
    this.baseUrl = (options.baseUrl ?? process.env.VOICEVOX_URL ?? process.env.JSON_VIDEO_VOICEVOX_URL ?? 'http://voicevox:50021').replace(/\/$/u, '');
    const parsed = new URL(this.baseUrl);
    const allowedHosts = new Set(['voicevox', 'localhost', '127.0.0.1', '::1', 'host.docker.internal']);
    if (parsed.protocol !== 'http:' || !allowedHosts.has(parsed.hostname)) {
      throw new AppError('VOICEVOX_URL_REJECTED', `VOICEVOX URL must use a trusted local host: ${this.baseUrl}`, {
        category: 'policy',
      });
    }
    this.cacheRoot = options.cacheRoot;
    this.workspaceRoot = options.workspaceRoot;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async version(signal?: AbortSignal): Promise<string> {
    this.versionPromise ??= (async () => {
      const response = await this.request('/version', {method: 'GET'}, signal);
      const value: unknown = await response.json();
      return typeof value === 'string' ? value : String(value);
    })();
    try {
      return await this.versionPromise;
    } catch (error) {
      this.versionPromise = undefined;
      throw error;
    }
  }

  async speakers(signal?: AbortSignal): Promise<VoicevoxSpeaker[]> {
    this.speakersPromise ??= (async () => {
      const response = await this.request('/speakers', {method: 'GET'}, signal);
      return await response.json() as VoicevoxSpeaker[];
    })();
    try {
      return await this.speakersPromise;
    } catch (error) {
      this.speakersPromise = undefined;
      throw error;
    }
  }

  async synthesize(text: string, speaker: Speaker, signal?: AbortSignal): Promise<SynthesizedVoice> {
    throwIfAborted(signal);
    await mkdir(this.cacheRoot, {recursive: true});
    const voice = speaker.voice;
    if (!voice) {
      throw new AppError('VOICE_NOT_CONFIGURED', `Speaker ${speaker.id} has no VOICEVOX voice.`, {
        category: 'schema',
      });
    }
    const plan = await this.plan(text, speaker, signal);
    const {engineVersion, cacheKey, speakerName, styleName} = plan;
    let audioPath = resolve(this.cacheRoot, `${cacheKey}.wav`);
    let metadataPath = resolve(this.cacheRoot, `${cacheKey}.json`);
    const cacheRelative = relativePortable(this.workspaceRoot, this.cacheRoot);
    if (cacheRelative === '') {
      audioPath = await resolveInside(this.workspaceRoot, `${cacheKey}.wav`);
      metadataPath = await resolveInside(this.workspaceRoot, `${cacheKey}.json`);
    } else if (cacheRelative !== '..' && !cacheRelative.startsWith('../') && !cacheRelative.startsWith('/')) {
      await ensureSafeDirectory(this.workspaceRoot, cacheRelative);
      audioPath = await resolveInside(this.workspaceRoot, `${cacheRelative}/${cacheKey}.wav`);
      metadataPath = await resolveInside(this.workspaceRoot, `${cacheRelative}/${cacheKey}.json`);
    }
    try {
      const metadata = validateCacheMetadata(await readJson<unknown>(metadataPath), {engineVersion, cacheKey});
      const file = await stat(audioPath);
      if (file.size === metadata.sizeBytes && await digestFile(audioPath) === metadata.sha256) {
        return {
          sha256: metadata.sha256,
          sizeBytes: metadata.sizeBytes,
          durationMs: metadata.durationMs,
          engineVersion,
          cacheKey,
          // Names are always sourced from the current Engine response, never
          // trusted from an editable project or an older cache sidecar.
          speakerName,
          styleName,
          path: audioPath,
          relativePath: relativePortable(this.workspaceRoot, audioPath),
          cacheHit: true,
        };
      }
    } catch {
      // A missing or corrupt cache entry is regenerated.
    }

    const params = new URLSearchParams({text, speaker: String(voice.styleId)});
    const queryResponse = await this.request(`/audio_query?${params.toString()}`, {method: 'POST'}, signal);
    const query = await queryResponse.json() as Record<string, unknown>;
    query.speedScale = voice.speedScale ?? speaker.speed ?? 1;
    query.volumeScale = voice.volumeScale ?? speaker.volume ?? 1;
    query.pitchScale = voice.pitchScale ?? 0;
    query.intonationScale = voice.intonationScale ?? 1;
    const synthesisResponse = await this.request(`/synthesis?speaker=${voice.styleId}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(query),
    }, signal);
    const bytes = new Uint8Array(await synthesisResponse.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 100 * 1024 * 1024) {
      throw new AppError('VOICEVOX_INVALID_AUDIO', `VOICEVOX returned ${bytes.byteLength} bytes.`, {
        category: 'dependency',
        retryable: true,
      });
    }
    await atomicWrite(audioPath, bytes, {overwrite: true});
    const media = await probeMedia(audioPath, signal === undefined ? {} : {signal});
    if (media.durationMs === undefined) {
      throw new AppError('VOICEVOX_AUDIO_DURATION_MISSING', 'Generated WAV has no measurable duration.', {
        category: 'dependency',
      });
    }
    const metadata = {
      sha256: await digestFile(audioPath),
      sizeBytes: bytes.byteLength,
      durationMs: media.durationMs,
      engineVersion,
      cacheKey,
      speakerName,
      styleName,
    };
    await atomicWriteJson(metadataPath, metadata, {overwrite: true});
    return {...metadata, path: audioPath, relativePath: relativePortable(this.workspaceRoot, audioPath), cacheHit: false};
  }

  async plan(text: string, speaker: Speaker, signal?: AbortSignal): Promise<VoiceSynthesisPlan> {
    throwIfAborted(signal);
    const voice = speaker.voice;
    if (!voice) throw new AppError('VOICE_NOT_CONFIGURED', `Speaker ${speaker.id} has no VOICEVOX voice.`, {category: 'schema'});
    const engineVersion = await this.version(signal);
    const identity = await this.resolveIdentity(voice, signal);
    const cacheKey = digestJson({
      text,
      speakerUuid: voice.speakerUuid,
      styleId: voice.styleId,
      speedScale: voice.speedScale ?? speaker.speed ?? 1,
      volumeScale: voice.volumeScale ?? speaker.volume ?? 1,
      pitchScale: voice.pitchScale ?? 0,
      intonationScale: voice.intonationScale ?? 1,
      engineVersion,
    });
    const audioPath = resolve(this.cacheRoot, `${cacheKey}.wav`);
    const metadataPath = resolve(this.cacheRoot, `${cacheKey}.json`);
    try {
      const metadata = validateCacheMetadata(await readJson<unknown>(metadataPath), {engineVersion, cacheKey});
      const file = await stat(audioPath);
      if (file.size === metadata.sizeBytes && await digestFile(audioPath) === metadata.sha256) {
        return {engineVersion, cacheKey, ...identity, cacheHit: true, durationMs: metadata.durationMs};
      }
    } catch {
      // Missing or corrupt entries are reported as cache misses without writes.
    }
    return {engineVersion, cacheKey, ...identity, cacheHit: false};
  }

  private async resolveIdentity(voice: VoicevoxVoice, signal?: AbortSignal): Promise<ResolvedVoicevoxIdentity> {
    const speakers = await this.speakers(signal);
    const speaker = speakers.find((item) => item.speaker_uuid === voice.speakerUuid);
    if (!speaker) {
      throw new AppError('VOICEVOX_SPEAKER_NOT_FOUND', `VOICEVOX speaker UUID not found: ${voice.speakerUuid}`, {
        category: 'dependency',
      });
    }
    const style = speaker.styles.find((item) => item.id === voice.styleId);
    if (!style) {
      throw new AppError('VOICEVOX_STYLE_NOT_FOUND', `Style ${voice.styleId} is not available for ${speaker.name}.`, {
        category: 'dependency',
      });
    }
    return {speakerName: speaker.name, styleName: style.name};
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      throwIfAborted(signal);
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {...init, signal: combined});
        const retryable = response.status === 429 || response.status >= 500;
        if (response.ok) return response;
        const detail = (await response.text()).slice(0, 1000);
        if (!retryable || attempt === 2) {
          throw new AppError('VOICEVOX_REQUEST_FAILED', `VOICEVOX returned HTTP ${response.status}: ${detail}`, {
            category: 'dependency',
            retryable,
          });
        }
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof AppError) throw error;
        if (attempt === 2) {
          throw new AppError('VOICEVOX_UNAVAILABLE', `Unable to reach VOICEVOX at ${this.baseUrl}.`, {
            category: 'dependency',
            hint: 'Start the configured VOICEVOX Engine container and retry.',
            retryable: true,
            cause: error,
          });
        }
      }
      await wait(200 * (attempt + 1) + Math.floor(Math.random() * 100), signal);
    }
    throw new AppError('VOICEVOX_UNAVAILABLE', 'VOICEVOX retry limit reached.', {category: 'dependency', retryable: true});
  }
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new AppError('CANCELLED', 'Operation cancelled.', {category: 'cancelled', retryable: true}));
    };
    signal?.addEventListener('abort', abort, {once: true});
    if (signal) {
      setTimeout(() => signal.removeEventListener('abort', abort), milliseconds + 1);
    }
  });
}
