import {access} from 'node:fs/promises';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020Import, {type ErrorObject, type ValidateFunction} from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import type {ProjectLock, VideoProject} from '../shared/video-types.js';
import {AppError} from './errors.js';
import {readJson} from './fs-safe.js';

type JsonSchema = Record<string, unknown>;

let cached: {path: string; validator: ValidateFunction<VideoProject>} | undefined;
let lockCached: {projectPath: string; lockPath: string; validator: ValidateFunction<ProjectLock>} | undefined;
const Ajv2020 = Ajv2020Import as unknown as new (options: Record<string, unknown>) => {
  compile<T>(schema: JsonSchema): ValidateFunction<T>;
  addSchema(schema: JsonSchema): void;
};
const addFormats = addFormatsImport as unknown as (ajv: unknown) => void;

async function firstExisting(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Continue through deterministic fallbacks.
    }
  }
  throw new AppError('SCHEMA_NOT_FOUND', 'video-project.schema.json was not found.', {
    category: 'dependency',
    hint: 'Set JSON_VIDEO_SCHEMA_PATH to the absolute schema path.',
  });
}

export async function resolveSchemaPath(explicitPath?: string): Promise<string> {
  if (explicitPath) return resolve(explicitPath);
  if (process.env.JSON_VIDEO_SCHEMA_PATH) return resolve(process.env.JSON_VIDEO_SCHEMA_PATH);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return firstExisting([
    '/plugin/schemas/video-project.schema.json',
    resolve(process.cwd(), 'schemas/video-project.schema.json'),
    resolve(moduleDir, '../../../schemas/video-project.schema.json'),
  ]);
}

export async function projectValidator(schemaPath?: string): Promise<ValidateFunction<VideoProject>> {
  const path = await resolveSchemaPath(schemaPath);
  if (cached?.path === path) return cached.validator;
  const schema = await readJson<JsonSchema>(path);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: false,
    validateFormats: true,
  });
  addFormats(ajv);
  const validator = ajv.compile<VideoProject>(schema);
  cached = {path, validator};
  return validator;
}

export async function resolveLockSchemaPath(explicitPath?: string, projectSchemaPath?: string): Promise<string> {
  if (explicitPath) return resolve(explicitPath);
  if (process.env.JSON_VIDEO_LOCK_SCHEMA_PATH) return resolve(process.env.JSON_VIDEO_LOCK_SCHEMA_PATH);
  const projectPath = await resolveSchemaPath(projectSchemaPath);
  return firstExisting([
    resolve(dirname(projectPath), 'project-lock.schema.json'),
    '/plugin/schemas/project-lock.schema.json',
    resolve(process.cwd(), 'schemas/project-lock.schema.json'),
  ]);
}

export async function lockValidator(
  projectSchemaPath?: string,
  explicitLockSchemaPath?: string,
): Promise<ValidateFunction<ProjectLock>> {
  const resolvedProjectPath = await resolveSchemaPath(projectSchemaPath);
  const resolvedLockPath = await resolveLockSchemaPath(explicitLockSchemaPath, resolvedProjectPath);
  if (lockCached?.projectPath === resolvedProjectPath && lockCached.lockPath === resolvedLockPath) return lockCached.validator;
  const [projectSchema, lockSchema] = await Promise.all([
    readJson<JsonSchema>(resolvedProjectPath),
    readJson<JsonSchema>(resolvedLockPath),
  ]);
  const ajv = new Ajv2020({allErrors: true, strict: true, allowUnionTypes: false, validateFormats: true});
  addFormats(ajv);
  ajv.addSchema(projectSchema);
  const validator = ajv.compile<ProjectLock>(lockSchema);
  lockCached = {projectPath: resolvedProjectPath, lockPath: resolvedLockPath, validator};
  return validator;
}

function pointerFor(error: ErrorObject): string {
  const suffix = error.keyword === 'required' && typeof error.params.missingProperty === 'string'
    ? `/${escapePointer(error.params.missingProperty)}`
    : '';
  return `${error.instancePath}${suffix}` || '/';
}

function escapePointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function validateUnique(values: string[], pointer: string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new AppError('DUPLICATE_ID', `Duplicate ${label} id: ${value}`, {
        category: 'schema',
        jsonPointer: pointer,
      });
    }
    seen.add(value);
  }
}

function semanticValidation(project: VideoProject): void {
  validateUnique(project.assets.map((item) => item.id), '/assets', 'asset');
  validateUnique(project.speakers.map((item) => item.id), '/speakers', 'speaker');
  validateUnique(project.sections.map((item) => item.id), '/sections', 'section');
  validateUnique(project.sections.flatMap((section) => section.scenes.map((item) => item.id)), '/sections', 'scene');

  const assets = new Map(project.assets.map((item) => [item.id, item]));
  const speakers = new Set(project.speakers.map((item) => item.id));
  const requireAsset = (id: string | undefined, pointer: string, type?: string | string[]): void => {
    if (!id) return;
    const asset = assets.get(id);
    if (!asset) {
      throw new AppError('UNKNOWN_ASSET', `Unknown asset id: ${id}`, {category: 'schema', jsonPointer: pointer});
    }
    const allowed = typeof type === 'string' ? [type] : type;
    if (allowed && !allowed.includes(asset.type)) {
      throw new AppError('ASSET_TYPE_MISMATCH', `Asset ${id} must be ${allowed.join(' or ')}, not ${asset.type}.`, {
        category: 'schema',
        jsonPointer: pointer,
      });
    }
  };

  project.assets.forEach((asset, index) => {
    if (/^(?:[a-z]+:|\\\\|\/)/iu.test(asset.path) || asset.path.split(/[\\/]/u).includes('..')) {
      throw new AppError('UNSAFE_ASSET_PATH', `Asset paths must be workspace-relative: ${asset.path}`, {
        category: 'policy',
        jsonPointer: `/assets/${index}/path`,
      });
    }
    const allowedExtensions: Record<VideoProject['assets'][number]['type'], readonly string[]> = {
      image: ['.png', '.jpg', '.jpeg', '.webp'],
      avatar: ['.png', '.jpg', '.jpeg', '.webp'],
      video: ['.mp4', '.webm', '.mov'],
      audio: ['.wav', '.mp3', '.m4a', '.ogg'],
      font: ['.ttf', '.otf', '.woff2'],
    };
    if (!allowedExtensions[asset.type].includes(extname(asset.path).toLowerCase())) {
      throw new AppError('ASSET_EXTENSION_REJECTED', `Unsupported ${asset.type} extension: ${asset.path}`, {
        category: 'policy', jsonPointer: `/assets/${index}/path`,
      });
    }
    if (asset.rights.status === 'unknown' && !project.policies.allowUnknownRights) {
      throw new AppError('UNKNOWN_RIGHTS', `Rights must be confirmed for asset ${asset.id}.`, {
        category: 'policy',
        jsonPointer: `/assets/${index}/rights/status`,
      });
    }
  });

  project.speakers.forEach((speaker, index) => {
    requireAsset(speaker.avatar?.defaultAssetId, `/speakers/${index}/avatar/defaultAssetId`, ['image', 'avatar']);
    requireAsset(speaker.avatar?.mouthOpenAssetId, `/speakers/${index}/avatar/mouthOpenAssetId`, ['image', 'avatar']);
    Object.entries(speaker.avatar?.expressions ?? {}).forEach(([emotion, assetId]) => {
      requireAsset(assetId, `/speakers/${index}/avatar/expressions/${escapePointer(emotion)}`, ['image', 'avatar']);
    });
  });

  for (const [sectionIndex, section] of project.sections.entries()) {
    requireAsset(section.backgroundAssetId, `/sections/${sectionIndex}/backgroundAssetId`, 'image');
    requireAsset(section.bgmAssetId, `/sections/${sectionIndex}/bgmAssetId`, 'audio');
    for (const [sceneIndex, scene] of section.scenes.entries()) {
      const base = `/sections/${sectionIndex}/scenes/${sceneIndex}`;
      if (scene.speakerId && !speakers.has(scene.speakerId)) {
        throw new AppError('UNKNOWN_SPEAKER', `Unknown speaker id: ${scene.speakerId}`, {
          category: 'schema',
          jsonPointer: `${base}/speakerId`,
        });
      }
      if (scene.text && !scene.audioAssetId) {
        const speaker = project.speakers.find((item) => item.id === scene.speakerId);
        if (!speaker?.voice) {
          throw new AppError('VOICE_REQUIRED', `Text scene ${scene.id} requires a speaker with a VOICEVOX voice.`, {
            category: 'schema',
            jsonPointer: `${base}/speakerId`,
          });
        }
      }
      requireAsset(scene.audioAssetId, `${base}/audioAssetId`, 'audio');
      requireAsset(scene.sfxAssetId, `${base}/sfxAssetId`, 'audio');
      if (scene.visual.type === 'media') requireAsset(scene.visual.assetId, `${base}/visual/assetId`, ['image', 'avatar', 'video']);
      if (scene.visual.type === 'metric' && scene.visual.variant !== 'number' && scene.visual.labels && scene.visual.values && scene.visual.labels.length !== scene.visual.values.length) {
        throw new AppError('METRIC_LENGTH_MISMATCH', `Metric labels and values must have the same length in scene ${scene.id}.`, {
          category: 'schema', jsonPointer: `${base}/visual/labels`,
        });
      }
      if (!scene.audioAssetId && !scene.text && scene.durationMs === undefined) {
        throw new AppError('SCENE_DURATION_REQUIRED', `Scene ${scene.id} needs text, audioAssetId, or durationMs.`, {
          category: 'schema',
          jsonPointer: base,
        });
      }
    }
  }
  requireAsset(project.audio?.bgmAssetId, '/audio/bgmAssetId', 'audio');
  requireAsset(project.thumbnail.backgroundAssetId, '/thumbnail/backgroundAssetId', 'image');
  project.thumbnail.speakerIds?.forEach((speakerId, index) => {
    if (!speakers.has(speakerId)) {
      throw new AppError('UNKNOWN_SPEAKER', `Unknown thumbnail speaker id: ${speakerId}`, {
        category: 'schema',
        jsonPointer: `/thumbnail/speakerIds/${index}`,
      });
    }
  });
}

export async function validateProject(
  value: unknown,
  options: {schemaPath?: string} = {},
): Promise<VideoProject> {
  const validator = await projectValidator(options.schemaPath);
  if (!validator(value)) {
    const first = validator.errors?.[0];
    const details = validator.errors?.map((error) => `${pointerFor(error)} ${error.message ?? error.keyword}`).join('; ');
    throw new AppError('SCHEMA_VALIDATION_FAILED', details ?? 'Project does not match the schema.', {
      category: 'schema',
      ...(first === undefined ? {} : {jsonPointer: pointerFor(first)}),
      hint: 'Fix the indicated field and run validate again.',
    });
  }
  semanticValidation(value);
  return value;
}

export async function validateProjectLock(
  value: unknown,
  options: {projectSchemaPath?: string; lockSchemaPath?: string} = {},
): Promise<ProjectLock> {
  const validator = await lockValidator(options.projectSchemaPath, options.lockSchemaPath);
  if (!validator(value)) {
    const first = validator.errors?.[0];
    const details = validator.errors?.map((error) => `${pointerFor(error)} ${error.message ?? error.keyword}`).join('; ');
    throw new AppError('LOCK_SCHEMA_VALIDATION_FAILED', details ?? 'project.lock.json does not match its schema.', {
      category: 'schema',
      ...(first === undefined ? {} : {jsonPointer: pointerFor(first)}),
      hint: 'Run resolve again; do not edit project.lock.json by hand.',
    });
  }
  validateUnique(value.assets.map((asset) => asset.id), '/assets', 'locked asset');
  validateUnique(value.scenes.map((scene) => scene.id), '/scenes', 'resolved scene');
  const assetIds = new Set(value.assets.map((asset) => asset.id));
  let expectedStart = 0;
  for (const [index, scene] of value.scenes.entries()) {
    if (scene.startFrame !== expectedStart) {
      throw new AppError('LOCK_TIMELINE_INVALID', `Scene ${scene.id} starts at ${scene.startFrame}; expected ${expectedStart}.`, {
        category: 'schema', jsonPointer: `/scenes/${index}/startFrame`,
      });
    }
    if (scene.resolvedAudioAssetId && !assetIds.has(scene.resolvedAudioAssetId)) {
      throw new AppError('LOCK_ASSET_REFERENCE_INVALID', `Unknown resolved audio asset: ${scene.resolvedAudioAssetId}`, {
        category: 'schema', jsonPointer: `/scenes/${index}/resolvedAudioAssetId`,
      });
    }
    expectedStart += scene.durationInFrames;
  }
  if (expectedStart !== value.totalFrames) {
    throw new AppError('LOCK_TIMELINE_INVALID', `totalFrames is ${value.totalFrames}; expected ${expectedStart}.`, {
      category: 'schema', jsonPointer: '/totalFrames',
    });
  }
  return value;
}

export function clearSchemaCacheForTests(): void {
  cached = undefined;
  lockCached = undefined;
}
