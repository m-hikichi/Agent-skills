import {open, stat} from 'node:fs/promises';
import {extname} from 'node:path';
import {lookup} from 'mime-types';
import type {AssetRights, AssetType, LockedAsset, VideoAsset} from '../shared/video-types.js';
import {AppError} from './errors.js';
import {digestFile, relativePortable, resolveInside} from './fs-safe.js';
import {runProcess} from './process.js';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  avg_frame_rate?: string;
}

interface ProbeOutput {
  format?: {duration?: string; format_name?: string; size?: string};
  streams?: ProbeStream[];
}

export interface MediaInspection {
  path: string;
  mime: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  format?: string;
  codecs: string[];
  streamTypes: string[];
}

const ALLOWED_EXTENSIONS: Record<AssetType, ReadonlySet<string>> = {
  image: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  avatar: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  video: new Set(['.mp4', '.webm', '.mov']),
  audio: new Set(['.wav', '.mp3', '.m4a', '.ogg']),
  font: new Set(['.ttf', '.otf', '.woff2']),
};

const MAX_SIZE: Record<AssetType, number> = {
  image: 50 * 1024 * 1024,
  avatar: 50 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
  audio: 500 * 1024 * 1024,
  font: 20 * 1024 * 1024,
};

const EXTENSION_MIME = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.wav', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.ogg', 'audio/ogg'],
]);

/** Detect supported media from bytes rather than trusting a filename or upload header. */
export async function sniffMediaMime(filename: string): Promise<string | undefined> {
  const handle = await open(filename, 'r');
  try {
    const bytes = Buffer.alloc(16);
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    const header = bytes.subarray(0, bytesRead);
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (header[0] === 0xff && header[1] === 0xd8) return 'image/jpeg';
    if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
    if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
    if (header.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
    if (header.subarray(0, 3).toString('ascii') === 'ID3' || (header[0] === 0xff && ((header[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
    if (header.subarray(4, 8).toString('ascii') === 'ftyp') {
      if (header.subarray(8, 12).toString('ascii') === 'qt  ') return 'video/quicktime';
      return extname(filename).toLowerCase() === '.m4a' ? 'audio/mp4' : 'video/mp4';
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

export function classifyUpload(filename: string, declaredMime: string, sizeBytes: number): AssetType {
  const extension = extname(filename).toLowerCase();
  const type = (Object.entries(ALLOWED_EXTENSIONS) as Array<[AssetType, ReadonlySet<string>]>)
    .find(([, extensions]) => extensions.has(extension))?.[0];
  if (!type) {
    throw new AppError('UPLOAD_EXTENSION_REJECTED', `Unsupported upload extension: ${extension || '(none)'}`, {
      category: 'policy',
    });
  }
  const expected = type === 'avatar' ? 'image/' : type === 'font' ? 'font/' : `${type}/`;
  const alternateFont = type === 'font' && ['application/octet-stream', 'application/font-sfnt'].includes(declaredMime);
  if (!declaredMime.startsWith(expected) && !alternateFont) {
    throw new AppError('UPLOAD_MIME_REJECTED', `${filename} declares ${declaredMime}; expected ${expected}*.`, {
      category: 'policy',
    });
  }
  if (sizeBytes > MAX_SIZE[type]) {
    throw new AppError('ASSET_TOO_LARGE', `${filename} exceeds the ${MAX_SIZE[type]} byte limit.`, {category: 'policy'});
  }
  return type;
}

function milliseconds(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number.parseFloat(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

export async function probeMedia(
  path: string,
  options: {signal?: AbortSignal; ffprobePath?: string} = {},
): Promise<MediaInspection> {
  const file = await stat(path);
  const result = await runProcess(options.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe', [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path,
  ], {
    timeoutMs: 30_000,
    ...(options.signal === undefined ? {} : {signal: options.signal}),
  });
  let probe: ProbeOutput;
  try {
    probe = JSON.parse(result.stdout) as ProbeOutput;
  } catch (error) {
    throw new AppError('FFPROBE_INVALID_OUTPUT', `ffprobe returned invalid JSON for ${path}.`, {
      category: 'dependency',
      cause: error,
    });
  }
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const durationMs = milliseconds(probe.format?.duration)
    ?? milliseconds(probe.streams?.find((stream) => stream.codec_type === 'audio')?.duration)
    ?? milliseconds(video?.duration);
  const mime = await sniffMediaMime(path);
  if (!mime) {
    throw new AppError('ASSET_MAGIC_REJECTED', `${path} does not have a supported media signature.`, {
      category: 'policy',
      hint: 'Use a real PNG, JPEG, WebP, MP4, MOV, WebM, WAV, MP3, M4A, or Ogg file.',
    });
  }
  return {
    path,
    mime,
    sizeBytes: file.size,
    codecs: [...new Set((probe.streams ?? []).flatMap((stream) => stream.codec_name ? [stream.codec_name] : []))],
    streamTypes: [...new Set((probe.streams ?? []).flatMap((stream) => stream.codec_type ? [stream.codec_type] : []))],
    ...(durationMs === undefined ? {} : {durationMs}),
    ...(video?.width === undefined ? {} : {width: video.width}),
    ...(video?.height === undefined ? {} : {height: video.height}),
    ...(probe.format?.format_name === undefined ? {} : {format: probe.format.format_name}),
  };
}

export async function inspectAsset(
  asset: VideoAsset,
  workspaceRoot: string,
  options: {signal?: AbortSignal; ffprobePath?: string} = {},
): Promise<LockedAsset> {
  const absolute = await resolveInside(workspaceRoot, asset.path, {mustExist: true});
  const extension = extname(absolute).toLowerCase();
  if (!ALLOWED_EXTENSIONS[asset.type].has(extension)) {
    throw new AppError('ASSET_EXTENSION_REJECTED', `Unsupported ${asset.type} extension: ${extension || '(none)'}`, {
      category: 'policy',
      hint: `Allowed: ${[...ALLOWED_EXTENSIONS[asset.type]].join(', ')}`,
    });
  }
  const file = await stat(absolute);
  if (file.size > MAX_SIZE[asset.type]) {
    throw new AppError('ASSET_TOO_LARGE', `${asset.path} exceeds the ${MAX_SIZE[asset.type]} byte limit.`, {
      category: 'policy',
    });
  }
  let details: MediaInspection;
  if (asset.type === 'font') {
    const handle = await open(absolute, 'r');
    try {
      const header = Buffer.alloc(4);
      await handle.read(header, 0, 4, 0);
      const signature = header.toString('ascii');
      const valid = extension === '.ttf'
        ? header.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || signature === 'true'
        : extension === '.otf' ? signature === 'OTTO' : signature === 'wOF2';
      if (!valid) throw new AppError('FONT_SIGNATURE_REJECTED', `${asset.path} does not match its declared font format.`, {category: 'policy'});
    } finally {
      await handle.close();
    }
    details = {path: absolute, mime: lookup(absolute) || 'application/octet-stream', sizeBytes: file.size, codecs: [], streamTypes: []};
  } else {
    details = await probeMedia(absolute, options);
  }
  assertExpectedMedia(asset.type, details, asset.path);
  return {
    id: asset.id,
    type: asset.type,
    sourcePath: asset.path,
    resolvedPath: relativePortable(workspaceRoot, absolute),
    sha256: await digestFile(absolute),
    mime: details.mime,
    sizeBytes: details.sizeBytes,
    rights: asset.rights,
    ...(details.durationMs === undefined ? {} : {durationMs: details.durationMs}),
    ...(details.width === undefined ? {} : {width: details.width}),
    ...(details.height === undefined ? {} : {height: details.height}),
  };
}

export function assertExpectedMedia(type: AssetType, details: MediaInspection, path: string): void {
  const {mime} = details;
  const expectedMime = EXTENSION_MIME.get(extname(path).toLowerCase());
  if (type !== 'font' && expectedMime !== mime) {
    throw new AppError('ASSET_MIME_MISMATCH', `${path} has ${mime} bytes but its extension declares ${expectedMime ?? 'an unsupported format'}.`, {
      category: 'policy',
      hint: 'Do not rename media to a different extension; convert it to the declared format.',
    });
  }
  const expected = type === 'avatar' ? 'image/' : `${type}/`;
  if (type !== 'font' && !mime.startsWith(expected)) {
    throw new AppError('ASSET_MIME_MISMATCH', `${path} is ${mime}, expected ${expected}*.`, {
      category: 'policy',
      hint: 'Use a supported file extension matching the actual media type.',
    });
  }
  if ((type === 'image' || type === 'avatar' || type === 'video') && !details.streamTypes.includes('video')) {
    throw new AppError('ASSET_STREAM_MISMATCH', `${path} has no decodable video/image stream.`, {category: 'policy'});
  }
  if (type === 'audio' && !details.streamTypes.includes('audio')) {
    throw new AppError('ASSET_STREAM_MISMATCH', `${path} has no decodable audio stream.`, {category: 'policy'});
  }
  const imageCodecs = new Set(['png', 'mjpeg', 'webp']);
  if ((type === 'image' || type === 'avatar') && !details.codecs.some((codec) => imageCodecs.has(codec))) {
    throw new AppError('IMAGE_CODEC_REJECTED', `${path} is not a supported PNG, JPEG, or WebP image.`, {category: 'policy'});
  }
}

export async function toolVersion(command: string, args: string[] = ['-version']): Promise<string> {
  const result = await runProcess(command, args, {timeoutMs: 10_000});
  return result.stdout.split(/\r?\n/u)[0]?.trim() || result.stderr.split(/\r?\n/u)[0]?.trim() || 'unknown';
}
