import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, lstat, mkdir, mkdtemp, open, realpath, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {AssetType, LockedAsset, ProjectLock, VideoAsset, VideoProject} from '../shared/video-types.js';
import {AppError} from '../core/errors.js';

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

const ALLOWED_EXTENSIONS: Record<AssetType | 'voice', ReadonlySet<string>> = {
  image: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  avatar: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  video: new Set(['.mp4', '.webm', '.mov']),
  audio: new Set(['.wav', '.mp3', '.m4a', '.ogg']),
  font: new Set(['.ttf', '.otf', '.woff2']),
  voice: new Set(['.wav']),
};

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

export const assertSafeAssetReference = (reference: string): void => {
  if (!reference || path.isAbsolute(reference) || reference.startsWith('\\\\') || URL_SCHEME.test(reference)) {
    throw new AppError('UNSAFE_ASSET_PATH', `安全でない素材パスです: ${reference}`, {category: 'policy'});
  }
  const normalized = path.normalize(reference);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new AppError('ASSET_PATH_ESCAPE', `プロジェクト外の素材は使用できません: ${reference}`, {category: 'policy'});
  }
};

export const resolveSafeAssetPath = async (projectRoot: string, reference: string): Promise<string> => {
  assertSafeAssetReference(reference);
  const canonicalRoot = await realpath(projectRoot);
  const candidate = path.resolve(canonicalRoot, reference);
  const canonicalCandidate = await realpath(candidate);
  if (!isInside(canonicalRoot, canonicalCandidate)) {
    throw new AppError('ASSET_PATH_ESCAPE', `素材がプロジェクト外を参照しています: ${reference}`, {category: 'policy'});
  }

  const relativeParts = path.relative(canonicalRoot, candidate).split(path.sep).filter(Boolean);
  let cursor = canonicalRoot;
  for (const part of relativeParts) {
    cursor = path.join(cursor, part);
    const stats = await lstat(cursor);
    if (stats.isSymbolicLink()) {
      throw new AppError('ASSET_SYMLINK', `シンボリックリンクの素材は使用できません: ${reference}`, {category: 'policy'});
    }
  }
  return canonicalCandidate;
};

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(0, 80);

const sha256File = async (filename: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const sniffMime = async (filename: string): Promise<string | undefined> => {
  const handle = await open(filename, 'r');
  try {
    const bytes = Buffer.alloc(16);
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    const header = bytes.subarray(0, bytesRead);
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (header[0] === 0xff && header[1] === 0xd8) return 'image/jpeg';
    if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
    if (header.subarray(4, 8).toString('ascii') === 'ftyp') {
      const extension = path.extname(filename).toLowerCase();
      if (extension === '.m4a') return 'audio/mp4';
      if (extension === '.mov') return 'video/quicktime';
      return 'video/mp4';
    }
    if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
    if (header.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
    if (header.subarray(0, 3).toString('ascii') === 'ID3' || (header[0] === 0xff && (header[1] ?? 0) >= 0xe0)) return 'audio/mpeg';
    if (header.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || header.subarray(0, 4).toString('ascii') === 'true') return 'font/ttf';
    if (header.subarray(0, 4).toString('ascii') === 'OTTO') return 'font/otf';
    if (header.subarray(0, 4).toString('ascii') === 'wOF2') return 'font/woff2';
    return undefined;
  } finally {
    await handle.close();
  }
};

const normalizeMime = (value: string): string => {
  const normalized = value.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  if (normalized === 'audio/x-wav' || normalized === 'audio/wave') return 'audio/wav';
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized;
};

const assertAllowedExtension = (reference: string, type: AssetType | 'voice', id: string): void => {
  const extension = path.extname(reference).toLowerCase();
  if (!ALLOWED_EXTENSIONS[type].has(extension)) {
    throw new AppError('LOCK_ASSET_EXTENSION_REJECTED', `lock素材の拡張子は許可されていません: ${id}`, {
      category: 'policy',
      hint: `Allowed ${type} extensions: ${[...ALLOWED_EXTENSIONS[type]].join(', ')}`,
    });
  }
};

const verifySniffedMime = async (filename: string, id: string, locked?: LockedAsset): Promise<void> => {
  const actualMime = await sniffMime(filename);
  if (!actualMime) {
    throw new AppError(locked ? 'LOCK_ASSET_MIME_UNKNOWN' : 'ASSET_MIME_UNKNOWN', `素材の実体MIMEを判定できません: ${id}`, {
      category: 'policy',
      hint: 'Use a supported PNG, JPEG, WebP, MP4, WebM, MOV, WAV, MP3, M4A, OGG, TTF, OTF, or WOFF2 file.',
    });
  }
  const expectedMime = MIME_BY_EXTENSION[path.extname(filename).toLowerCase()];
  if (!expectedMime || normalizeMime(actualMime) !== normalizeMime(expectedMime)) {
    throw new AppError(locked ? 'LOCK_ASSET_MIME_MISMATCH' : 'ASSET_MIME_MISMATCH', `素材の拡張子と実体MIMEが一致しません: ${id}`, {category: 'policy'});
  }
  if (locked && normalizeMime(actualMime) !== normalizeMime(locked.mime)) {
    throw new AppError('LOCK_ASSET_MIME_MISMATCH', `lock素材のMIMEが一致しません: ${locked.id}`, {category: 'policy'});
  }
};

const verifyLockedAsset = async (filename: string, locked: ProjectLock['assets'][number]): Promise<void> => {
  const metadata = await stat(filename);
  if (!metadata.isFile()) throw new AppError('LOCK_ASSET_NOT_FILE', `lock素材がファイルではありません: ${locked.id}`, {category: 'policy'});
  if (metadata.size !== locked.sizeBytes) throw new AppError('LOCK_ASSET_SIZE_MISMATCH', `lock後に素材サイズが変わりました: ${locked.id}`, {category: 'policy'});
  const actualHash = await sha256File(filename);
  if (actualHash.toLowerCase() !== locked.sha256.toLowerCase()) throw new AppError('LOCK_ASSET_HASH_MISMATCH', `lock後に素材内容が変わりました: ${locked.id}`, {category: 'policy'});
  await verifySniffedMime(filename, locked.id, locked);
};

interface AssetStageEntry {
  id: string;
  reference: string;
  type: AssetType | 'voice';
  locked?: LockedAsset;
}

const assertProjectAssetBinding = async (
  projectRoot: string,
  asset: VideoAsset,
  locked: LockedAsset | undefined,
): Promise<void> => {
  if (!locked) {
    throw new AppError('LOCK_ASSET_MISSING', `プロジェクト素材に対応するlock entryがありません: ${asset.id}`, {category: 'policy'});
  }
  if (locked.type !== asset.type || locked.sourcePath !== asset.path) {
    throw new AppError('LOCK_ASSET_BINDING_MISMATCH', `lock素材がプロジェクト定義と一致しません: ${asset.id}`, {category: 'policy'});
  }
  assertAllowedExtension(asset.path, asset.type, asset.id);
  assertAllowedExtension(locked.sourcePath, asset.type, asset.id);
  assertAllowedExtension(locked.resolvedPath, asset.type, asset.id);
  const projectSource = await resolveSafeAssetPath(projectRoot, asset.path);
  const lockedSource = await resolveSafeAssetPath(projectRoot, locked.resolvedPath);
  if (projectSource !== lockedSource) {
    throw new AppError('LOCK_ASSET_BINDING_MISMATCH', `lock素材のresolvedPathがプロジェクト素材を指していません: ${asset.id}`, {category: 'policy'});
  }
};

const assertGeneratedVoiceBinding = (project: VideoProject, lock: ProjectLock, locked: LockedAsset): void => {
  if (locked.type !== 'voice' || !locked.voice) {
    throw new AppError('LOCK_ASSET_UNEXPECTED', `プロジェクトに存在しないlock素材です: ${locked.id}`, {category: 'policy'});
  }
  const matchingScene = lock.scenes.find((scene) => scene.resolvedAudioAssetId === locked.id);
  const expectedPath = `.json-video-work/${project.meta.id}/voice/${locked.voice.cacheKey}.wav`;
  if (
    !matchingScene
    || locked.id !== `voice:${matchingScene.id}`
    || locked.sourcePath !== `voicevox:${locked.voice.cacheKey}`
    || locked.resolvedPath.replaceAll('\\', '/') !== expectedPath
  ) {
    throw new AppError('LOCK_VOICE_BINDING_MISMATCH', `VOICEVOX lock素材の由来が不正です: ${locked.id}`, {category: 'policy'});
  }
  assertAllowedExtension(locked.resolvedPath, 'voice', locked.id);
};

export interface StagedAssets {
  publicDirectory: string;
  assetUrls: Record<string, string>;
  cleanup: () => Promise<void>;
}

export const stageRenderAssets = async (
  projectRoot: string,
  project: VideoProject,
  lock?: ProjectLock,
): Promise<StagedAssets> => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'json-video-render-'));
  const publicDirectory = path.join(temporaryRoot, 'public');
  const assetsDirectory = path.join(publicDirectory, 'assets');
  await mkdir(assetsDirectory, {recursive: true});
  const assetUrls: Record<string, string> = {};

  try {
    const entries: AssetStageEntry[] = [];
    const projectIds = new Set(project.assets.map((asset) => asset.id));
    const lockedById = new Map<string, LockedAsset>();
    for (const locked of lock?.assets ?? []) {
      if (lockedById.has(locked.id)) {
        throw new AppError('LOCK_ASSET_DUPLICATE_ID', `lock内で素材IDが重複しています: ${locked.id}`, {category: 'policy'});
      }
      lockedById.set(locked.id, locked);
    }

    for (const asset of project.assets) {
      const locked = lock ? lockedById.get(asset.id) : undefined;
      if (lock) await assertProjectAssetBinding(projectRoot, asset, locked);
      else assertAllowedExtension(asset.path, asset.type, asset.id);
      // Always stage the project-owned path. A lock can attest to this file but
      // must never replace it with an alternate resolvedPath.
      entries.push({id: asset.id, reference: asset.path, type: asset.type, ...(locked ? {locked} : {})});
    }
    if (lock) {
      for (const locked of lock.assets) {
        if (projectIds.has(locked.id)) continue;
        assertGeneratedVoiceBinding(project, lock, locked);
        entries.push({id: locked.id, reference: locked.resolvedPath, type: 'voice', locked});
      }
    }

    for (const {id, reference, type, locked} of entries) {
      assertAllowedExtension(reference, type, id);
      const source = await resolveSafeAssetPath(projectRoot, reference);
      const extension = path.extname(source).toLowerCase();
      const digest = createHash('sha256').update(id).update('\0').update(reference).digest('hex').slice(0, 16);
      const destinationName = `${digest}-${safeName(path.basename(source, extension))}${extension}`;
      const destination = path.join(assetsDirectory, destinationName);
      await copyFile(source, destination);
      // Verify the immutable staged copy, closing the source verify/copy race.
      if (locked) await verifyLockedAsset(destination, locked);
      else await verifySniffedMime(destination, id);
      // The final bundle serves public files below Remotion's dynamic static
      // base. Resolve this marker with staticFile() inside the composition.
      assetUrls[id] = `remotion-static:assets/${destinationName}`;
    }
  } catch (error) {
    await rm(temporaryRoot, {recursive: true, force: true});
    throw error;
  }

  return {
    publicDirectory,
    assetUrls,
    cleanup: () => rm(temporaryRoot, {recursive: true, force: true}),
  };
};
