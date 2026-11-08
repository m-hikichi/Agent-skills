import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {access, mkdir, open, readFile, readdir, realpath, rename, stat, writeFile, type FileHandle} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, {type FastifyInstance} from 'fastify';
import mime from 'mime-types';
import type {JobKind, JobRecord, ProjectEnvelope, StoryboardRunSummary} from '../shared/contracts.js';
import {BUNDLED_FONT_FAMILY, type ProjectLock, type VideoProject} from '../shared/video-types.js';
import {resolveSafeAssetPath} from '../render/assets.js';
import {assertPassingReview} from '../render/api.js';
import {collectLayoutWarnings} from '../render/layout.js';
import {resolveSchemaPath} from '../core/schema.js';

export interface ProjectSummary {
  path: string;
  title: string;
  revision: number;
  lockState: 'missing' | 'current' | 'stale';
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{jsonPointer?: string; message: string}>;
  warnings: Array<{sceneId?: string; field?: string; message: string}>;
}

export interface VoicevoxSpeakerSummary {
  name: string;
  speakerUuid: string;
  styles: Array<{id: number; name: string}>;
}

export interface OutputEntry {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface WebJobQueue {
  list(): Promise<JobRecord[]>;
  start(kind: JobKind, projectPath: string, input?: Record<string, unknown>): Promise<JobRecord>;
  get(jobId: string): Promise<JobRecord | undefined>;
  cancel(jobId: string): Promise<JobRecord | undefined>;
}

export interface WebServiceAdapter {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(projectPath: string): Promise<ProjectEnvelope<VideoProject>>;
  createProject(input: {projectPath: string; project?: VideoProject}): Promise<ProjectEnvelope<VideoProject>>;
  updateProject(input: {projectPath: string; revision: number; project: VideoProject}): Promise<ProjectEnvelope<VideoProject>>;
  validateProject(input: {projectPath?: string; project: VideoProject}): Promise<ValidationResult>;
  listVoicevoxSpeakers(): Promise<VoicevoxSpeakerSummary[]>;
  synthesizeVoicevoxTest(input: {speakerUuid: string; styleId: number; text: string}): Promise<{audioBase64: string; mime: 'audio/wav'}>;
  uploadAsset(input: {projectPath: string; filename: string; bytes: Buffer; mime: string}): Promise<{relativePath: string}>;
  listOutputs(projectPath: string): Promise<OutputEntry[]>;
  listStoryboards(projectPath: string): Promise<StoryboardRunSummary[]>;
}

export interface StartWebServerOptions {
  host?: string;
  port?: number;
  workspaceRoot: string;
  service?: Partial<WebServiceAdapter>;
  jobQueue?: WebJobQueue;
}

export interface WebServerHandle {
  app: FastifyInstance;
  address: string;
  close(): Promise<void>;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  return value;
};

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
const revisionFromDigest = (value: string): number => Number.parseInt(value.slice(0, 12), 16);

const assertWorkspacePath = (workspaceRoot: string, relativePath: string): string => {
  if (!relativePath || path.isAbsolute(relativePath) || /^[a-z][a-z0-9+.-]*:/iu.test(relativePath) || relativePath.startsWith('\\\\')) {
    throw Object.assign(new Error('workspace内の相対パスを指定してください'), {statusCode: 400, code: 'UNSAFE_PATH'});
  }
  const resolved = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Object.assign(new Error('workspace外のパスは使用できません'), {statusCode: 400, code: 'PATH_ESCAPE'});
  }
  return resolved;
};

const isPathInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/**
 * Resolve, open, and re-attest the same file descriptor before streaming it.
 * This closes the list/realpath/open symlink-swap window for local outputs.
 */
const openSafeProjectFile = async (projectRoot: string, reference: string) => {
  let handle: FileHandle | undefined;
  try {
    const [canonicalRoot, canonicalFile] = await Promise.all([
      realpath(projectRoot),
      resolveSafeAssetPath(projectRoot, reference),
    ]);
    handle = await open(canonicalFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    // Resolve the original project-relative reference again after open. The
    // descriptor and the revalidated path must still name the same inode.
    const currentCanonical = await resolveSafeAssetPath(projectRoot, reference);
    const current = await stat(currentCanonical);
    if (
      !isPathInside(canonicalRoot, currentCanonical)
      || currentCanonical !== canonicalFile
      || !opened.isFile()
      || !current.isFile()
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || opened.size !== current.size
    ) {
      throw new Error('opened file no longer matches the validated project file');
    }
    const stream = handle.createReadStream({autoClose: true});
    handle = undefined;
    return {filename: currentCanonical, stream};
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    throw Object.assign(new Error('安全性を確認できないファイルは配信できません'), {
      statusCode: 403,
      code: 'FILE_OPEN_REJECTED',
      cause: error,
    });
  }
};

const relativeToWorkspace = (workspaceRoot: string, absolutePath: string): string =>
  path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');

const findProjectFiles = async (root: string, current = root, depth = 0): Promise<string[]> => {
  if (depth > 5) return [];
  const entries = await readdir(current, {withFileTypes: true});
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'video-project.json' && entry.isFile()) results.push(path.join(current, entry.name));
    if (entry.isDirectory() && !['.git', 'node_modules', 'dist', '.json-video-work'].includes(entry.name)) {
      results.push(...await findProjectFiles(root, path.join(current, entry.name), depth + 1));
    }
  }
  return results;
};

const readEnvelope = async (workspaceRoot: string, projectPath: string): Promise<ProjectEnvelope<VideoProject>> => {
  const filename = assertWorkspacePath(workspaceRoot, projectPath);
  const project = JSON.parse(await readFile(filename, 'utf8')) as VideoProject;
  const projectDigest = digest(project);
  const lockPath = path.join(path.dirname(filename), '.json-video-work', project.meta.id, 'project.lock.json');
  let lockState: ProjectEnvelope['lockState'] = 'missing';
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {projectDigest?: string};
    lockState = lock.projectDigest === projectDigest ? 'current' : 'stale';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {project, revision: revisionFromDigest(projectDigest), digest: projectDigest, lockState};
};

const starterProject = (id: string): VideoProject => ({
  schemaVersion: '1.0.0',
  meta: {id, title: '新しい動画', language: 'ja-JP'},
  canvas: {preset: 'youtube-1080p', fps: 30},
  theme: {backgroundColor: '#07111f', foregroundColor: '#f8fafc', accentColor: '#22d3ee', fontFamily: BUNDLED_FONT_FAMILY, spacing: 'comfortable', subtitleStyle: {fontSize: 48, maxLines: 2, backgroundColor: 'rgba(0,0,0,.78)', color: '#fff'}},
  assets: [],
  speakers: [],
  sections: [{id: 'intro', title: 'イントロ', scenes: [{id: 'intro-1', subtitle: 'ここに台詞を入力します', durationMs: 3000, visual: {type: 'title', title: '新しい動画'}}]}],
  thumbnail: {textLines: ['新しい動画'], layout: 'center'},
  outputs: {video: true, captions: true, chapters: true, thumbnail: true, storyboard: true},
  policies: {allowUnknownRights: false, maxDurationMinutes: 30},
});

const createFilesystemService = (workspaceRoot: string): WebServiceAdapter => ({
  async listProjects() {
    const files = await findProjectFiles(workspaceRoot);
    return Promise.all(files.map(async (filename) => {
      const relative = relativeToWorkspace(workspaceRoot, filename);
      const envelope = await readEnvelope(workspaceRoot, relative);
      return {path: relative, title: envelope.project.meta.title, revision: envelope.revision, lockState: envelope.lockState};
    }));
  },
  getProject(projectPath) { return readEnvelope(workspaceRoot, projectPath); },
  async createProject({projectPath, project}) {
    const filename = assertWorkspacePath(workspaceRoot, projectPath);
    if (path.basename(filename) !== 'video-project.json') throw Object.assign(new Error('ファイル名はvideo-project.jsonにしてください'), {statusCode: 400});
    await mkdir(path.dirname(filename), {recursive: true});
    const initial = project ?? starterProject(path.basename(path.dirname(filename)).replace(/[^a-z0-9-]/giu, '-').toLowerCase() || 'video');
    await writeFile(filename, `${JSON.stringify(initial, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
    return readEnvelope(workspaceRoot, projectPath);
  },
  async updateProject({projectPath, revision, project}) {
    const current = await readEnvelope(workspaceRoot, projectPath);
    if (current.revision !== revision) throw Object.assign(new Error('他の操作で更新されています。再読込してください'), {statusCode: 409, code: 'REVISION_CONFLICT'});
    const filename = assertWorkspacePath(workspaceRoot, projectPath);
    const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    await rename(temporary, filename);
    return readEnvelope(workspaceRoot, projectPath);
  },
  async validateProject({project}) {
    const errors: ValidationResult['errors'] = [];
    if (project.schemaVersion !== '1.0.0') errors.push({jsonPointer: '/schemaVersion', message: 'schemaVersionは1.0.0である必要があります'});
    if (!project.meta?.id) errors.push({jsonPointer: '/meta/id', message: 'project IDが必要です'});
    if (!Array.isArray(project.sections) || project.sections.length === 0) errors.push({jsonPointer: '/sections', message: '1つ以上のsectionが必要です'});
    return {valid: errors.length === 0, errors, warnings: collectLayoutWarnings(project)};
  },
  async listVoicevoxSpeakers() { return []; },
  async synthesizeVoicevoxTest() { throw Object.assign(new Error('VOICEVOX adapterが接続されていません'), {statusCode: 503, code: 'VOICEVOX_UNAVAILABLE'}); },
  async uploadAsset({projectPath, filename, bytes}) {
    const projectFilename = assertWorkspacePath(workspaceRoot, projectPath);
    const cleanFilename = path.basename(filename).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 120);
    const relativePath = path.join('assets', 'uploads', `${Date.now()}-${cleanFilename}`);
    const destination = path.resolve(path.dirname(projectFilename), relativePath);
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(destination, bytes, {flag: 'wx'});
    return {relativePath: relativePath.split(path.sep).join('/')};
  },
  async listOutputs(projectPath) {
    const envelope = await readEnvelope(workspaceRoot, projectPath);
    const outputRoot = path.join(path.dirname(assertWorkspacePath(workspaceRoot, projectPath)), 'dist', envelope.project.meta.id);
    const walk = async (current: string): Promise<OutputEntry[]> => {
      let entries;
      try { entries = await readdir(current, {withFileTypes: true}); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
      const output: OutputEntry[] = [];
      for (const entry of entries) {
        const filename = path.join(current, entry.name);
        if (entry.isDirectory()) output.push(...await walk(filename));
        else if (entry.isFile()) {
          const metadata = await stat(filename);
          output.push({name: entry.name, path: relativeToWorkspace(workspaceRoot, filename), sizeBytes: metadata.size, modifiedAt: metadata.mtime.toISOString()});
        }
      }
      return output;
    };
    return walk(outputRoot);
  },
  // The production RuntimeService adapter performs the guarded history walk.
  // A partial/testing service that does not provide it fails closed.
  async listStoryboards() { return []; },
});

const assertLocalHost = (host: string): void => {
  const containerBindAllowed = process.env.JSON_VIDEO_ALLOW_CONTAINER_BIND === '1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !(host === '0.0.0.0' && containerBindAllowed)) {
    throw new Error('Web UIはloopbackだけで起動できます。コンテナ内の0.0.0.0はJSON_VIDEO_ALLOW_CONTAINER_BIND=1が必要です');
  }
};

const JOB_KINDS = new Set<JobKind>(['resolve', 'storyboard', 'render']);
const STORYBOARD_LOCK_HASH = /^[a-f0-9]{64}$/u;
const STORYBOARD_FRAME_NAME = /^\d{3}-[a-z][a-z0-9-]{0,63}\.png$/u;

const assertSafeUpload = (filename: string, contentType: string, bytes: Buffer): void => {
  const extension = path.extname(filename).toLowerCase();
  const allowed = new Map<string, string[]>([
    ['image/png', ['.png']], ['image/jpeg', ['.jpg', '.jpeg']], ['image/webp', ['.webp']],
    ['video/mp4', ['.mp4']], ['video/webm', ['.webm']],
    ['audio/wav', ['.wav']], ['audio/x-wav', ['.wav']], ['audio/mpeg', ['.mp3']], ['audio/ogg', ['.ogg']], ['audio/mp4', ['.m4a']],
    ['font/ttf', ['.ttf']], ['application/x-font-ttf', ['.ttf']], ['font/otf', ['.otf']], ['font/woff2', ['.woff2']],
  ]);
  if (!allowed.get(contentType)?.includes(extension)) throw Object.assign(new Error('許可されていないMIMEまたは拡張子です'), {statusCode: 415, code: 'UNSAFE_UPLOAD_TYPE'});
  const signatures: Record<string, boolean> = {
    '.png': bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    '.jpg': bytes[0] === 0xff && bytes[1] === 0xd8,
    '.jpeg': bytes[0] === 0xff && bytes[1] === 0xd8,
    '.webp': bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    '.wav': bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE',
    '.mp4': bytes.subarray(4, 8).toString('ascii') === 'ftyp',
    '.m4a': bytes.subarray(4, 8).toString('ascii') === 'ftyp',
    '.webm': bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    '.ogg': bytes.subarray(0, 4).toString('ascii') === 'OggS',
    '.mp3': bytes.subarray(0, 3).toString('ascii') === 'ID3' || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0),
    '.ttf': bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || bytes.subarray(0, 4).toString('ascii') === 'true',
    '.otf': bytes.subarray(0, 4).toString('ascii') === 'OTTO',
    '.woff2': bytes.subarray(0, 4).toString('ascii') === 'wOF2',
  };
  if (!signatures[extension]) throw Object.assign(new Error('ファイル内容と拡張子が一致しません'), {statusCode: 415, code: 'UPLOAD_SIGNATURE_MISMATCH'});
};

const requireCsrfHeader = (request: {method: string; headers: Record<string, string | string[] | undefined>}): void => {
  const host = request.headers.host;
  try {
    if (typeof host !== 'string') throw new Error('missing host');
    const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/u, '');
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) throw new Error('non-loopback host');
  } catch {
    throw Object.assign(new Error('許可されていないHostです'), {statusCode: 403, code: 'HOST_REJECTED'});
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers['x-json-video-studio'] !== '1') throw Object.assign(new Error('CSRFヘッダーが必要です'), {statusCode: 403, code: 'CSRF_HEADER_REQUIRED'});
  const origin = request.headers.origin;
  if (typeof origin === 'string') {
    try {
      const hostname = new URL(origin).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) throw new Error('non-loopback');
    } catch {
      throw Object.assign(new Error('許可されていないOriginです'), {statusCode: 403, code: 'ORIGIN_REJECTED'});
    }
  }
};

const readCurrentPreviewLock = async (workspaceRoot: string, service: WebServiceAdapter, projectPath: string): Promise<ProjectLock> => {
  const envelope = await service.getProject(projectPath);
  if (envelope.lockState !== 'current') throw Object.assign(new Error('現在のprojectに対応するlockがありません'), {statusCode: 409, code: 'LOCK_NOT_CURRENT'});
  const projectFilename = assertWorkspacePath(workspaceRoot, projectPath);
  const reference = path.join('.json-video-work', envelope.project.meta.id, 'project.lock.json');
  const lockFilename = await resolveSafeAssetPath(path.dirname(projectFilename), reference);
  return JSON.parse(await readFile(lockFilename, 'utf8')) as ProjectLock;
};

export const startWebServer = async (options: StartWebServerOptions): Promise<WebServerHandle> => {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 43120;
  assertLocalHost(host);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  await access(workspaceRoot);
  const fallback = createFilesystemService(workspaceRoot);
  const service = new Proxy(fallback, {get(target, key: keyof WebServiceAdapter) { return options.service?.[key] ?? target[key]; }}) as WebServiceAdapter;
  // stdio MCPのstdoutをJSON-RPC専用に保つため、Fastifyの既定loggerは使用しない。
  const app = Fastify({logger: false, bodyLimit: 8 * 1024 * 1024});
  await app.register(multipart, {limits: {files: 1, fileSize: 64 * 1024 * 1024}});
  app.addHook('onRequest', async (request) => requireCsrfHeader(request));

  app.get('/api/health', async () => ({ok: true, workspaceRoot, version: '0.1.0'}));
  app.get('/api/schema', async () => JSON.parse(await readFile(await resolveSchemaPath(), 'utf8')) as unknown);
  app.get('/api/projects', async () => service.listProjects());
  app.post<{Body: {projectPath: string; project?: VideoProject}}>('/api/projects', async (request, reply) => reply.code(201).send(await service.createProject(request.body)));
  app.get<{Querystring: {path: string}}>('/api/project', async (request) => service.getProject(request.query.path));
  app.get<{Querystring: {path: string}}>('/api/preview-lock', async (request) => readCurrentPreviewLock(workspaceRoot, service, request.query.path));
  app.get<{Querystring: {path: string}}>('/api/review', async (request) => {
    const envelope = await service.getProject(request.query.path);
    const projectFilename = assertWorkspacePath(workspaceRoot, request.query.path);
    const reviewReference = `.json-video-work/${envelope.project.meta.id}/review.json`;
    try {
      const reviewPath = await resolveSafeAssetPath(path.dirname(projectFilename), reviewReference);
      return JSON.parse(await readFile(reviewPath, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {status: 'missing'};
      throw error;
    }
  });
  app.put<{Querystring: {path: string}; Body: {revision: number; project: VideoProject}}>('/api/project', async (request) => service.updateProject({projectPath: request.query.path, revision: request.body.revision, project: request.body.project}));
  app.post<{Body: {projectPath?: string; project: VideoProject}}>('/api/validate', async (request) => service.validateProject(request.body));
  app.get('/api/voicevox/speakers', async () => service.listVoicevoxSpeakers());
  app.post<{Body: {speakerUuid: string; styleId: number; text: string}}>('/api/voicevox/test', async (request) => service.synthesizeVoicevoxTest(request.body));
  app.post<{Querystring: {projectPath: string}}>('/api/assets', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({code: 'FILE_REQUIRED', message: 'ファイルが必要です'});
    const bytes = await file.toBuffer();
    assertSafeUpload(file.filename, file.mimetype, bytes);
    return service.uploadAsset({projectPath: request.query.projectPath, filename: file.filename, bytes, mime: file.mimetype});
  });
  app.get<{Querystring: {projectPath: string; assetId: string}}>('/api/asset', async (request, reply) => {
    const envelope = await service.getProject(request.query.projectPath);
    const asset = envelope.project.assets.find((item) => item.id === request.query.assetId);
    const projectFilename = assertWorkspacePath(workspaceRoot, request.query.projectPath);
    let reference = asset?.path;
    if (!reference && envelope.lockState === 'current') {
      const lock = await readCurrentPreviewLock(workspaceRoot, service, request.query.projectPath);
      reference = lock.assets.find((item) => item.id === request.query.assetId)?.resolvedPath;
    }
    if (!reference) return reply.code(404).send({code: 'ASSET_NOT_FOUND', message: '素材が見つかりません'});
    const opened = await openSafeProjectFile(path.dirname(projectFilename), reference);
    return reply.type(mime.lookup(opened.filename) || 'application/octet-stream').send(opened.stream);
  });
  app.get<{Querystring: {projectPath: string}}>('/api/outputs', async (request) => service.listOutputs(request.query.projectPath));
  app.get<{Querystring: {projectPath: string}}>('/api/storyboards', async (request) => service.listStoryboards(request.query.projectPath));
  app.get<{Querystring: {projectPath: string; lockHash: string; filename: string}}>('/api/storyboard-frame', async (request, reply) => {
    const {projectPath, lockHash, filename: frameName} = request.query;
    if (!STORYBOARD_LOCK_HASH.test(lockHash ?? '') || !STORYBOARD_FRAME_NAME.test(frameName ?? '')) {
      return reply.code(400).send({code: 'INVALID_STORYBOARD_REFERENCE', message: 'storyboard参照が不正です'});
    }
    const runs = await service.listStoryboards(projectPath);
    const run = runs.find((item) => item.lockHash === lockHash);
    if (!run || !run.frames.some((frame) => frame.filename === frameName)) {
      return reply.code(404).send({code: 'STORYBOARD_FRAME_NOT_FOUND', message: 'storyboardフレームが見つかりません'});
    }
    const envelope = await service.getProject(projectPath);
    const projectFilename = assertWorkspacePath(workspaceRoot, projectPath);
    const frameReference = `.json-video-work/${envelope.project.meta.id}/storyboard/${lockHash}/${frameName}`;
    const opened = await openSafeProjectFile(path.dirname(projectFilename), frameReference);
    return reply
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .type('image/png')
      .send(opened.stream);
  });
  app.get<{Querystring: {projectPath: string; path: string}}>('/api/output', async (request, reply) => {
    const outputs = await service.listOutputs(request.query.projectPath);
    if (!outputs.some((entry) => entry.path === request.query.path)) return reply.code(404).send({code: 'OUTPUT_NOT_FOUND', message: '成果物が見つかりません'});
    const projectFilename = assertWorkspacePath(workspaceRoot, request.query.projectPath);
    const projectRoot = path.dirname(projectFilename);
    const requested = assertWorkspacePath(workspaceRoot, request.query.path);
    const reference = path.relative(projectRoot, requested).split(path.sep).join('/');
    const opened = await openSafeProjectFile(projectRoot, reference);
    const contentType = mime.lookup(opened.filename) || 'application/octet-stream';
    const disposition = contentType.startsWith('image/') || contentType.startsWith('video/') ? 'inline' : 'attachment';
    return reply.header('content-disposition', `${disposition}; filename="${path.basename(opened.filename).replace(/["\\]/gu, '')}"`).type(contentType).send(opened.stream);
  });

  app.get('/api/jobs', async () => options.jobQueue?.list() ?? []);
  app.post<{Body: {kind: JobKind; projectPath: string; dryRun?: boolean}}>('/api/jobs', async (request, reply) => {
    if (!options.jobQueue) return reply.code(503).send({code: 'JOB_QUEUE_UNAVAILABLE', message: 'job queueが接続されていません'});
    if (!request.body || !JOB_KINDS.has(request.body.kind) || typeof request.body.projectPath !== 'string') return reply.code(400).send({code: 'INVALID_JOB_REQUEST', message: '不正なjobリクエストです'});
    if (request.body.kind === 'render') {
      const envelope = await service.getProject(request.body.projectPath);
      if (envelope.lockState !== 'current') {
        return reply.code(409).send({code: 'LOCK_NOT_CURRENT', message: '現在のprojectに対応するlockがありません。先にresolveしてください'});
      }
      const lock = await readCurrentPreviewLock(workspaceRoot, service, request.body.projectPath);
      try {
        const projectFilename = assertWorkspacePath(workspaceRoot, request.body.projectPath);
        await assertPassingReview(path.dirname(projectFilename), envelope.project.meta.id, lock.lockHash);
      } catch (error) {
        const structured = error as {code?: string; message?: string};
        return reply.code(409).send({
          code: structured.code ?? 'REVIEW_REQUIRED',
          message: structured.message ?? 'current lockのreview passが必要です',
        });
      }
    }
    return reply.code(202).send(await options.jobQueue.start(
      request.body.kind,
      request.body.projectPath,
      request.body.kind === 'resolve' && request.body.dryRun === true ? {dryRun: true} : undefined,
    ));
  });
  app.get<{Params: {id: string}}>('/api/jobs/:id', async (request, reply) => {
    const job = await options.jobQueue?.get(request.params.id);
    return job ?? reply.code(404).send({code: 'JOB_NOT_FOUND', message: 'jobが見つかりません'});
  });
  app.delete<{Params: {id: string}}>('/api/jobs/:id', async (request, reply) => {
    const job = await options.jobQueue?.cancel(request.params.id);
    return job ?? reply.code(404).send({code: 'JOB_NOT_FOUND', message: 'jobが見つかりません'});
  });

  const webRoot = fileURLToPath(new URL('../../dist/web/', import.meta.url));
  try {
    await access(path.join(webRoot, 'index.html'));
    await app.register(fastifyStatic, {root: webRoot, prefix: '/'});
    app.setNotFoundHandler(async (request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({code: 'NOT_FOUND'}) : reply.sendFile('index.html'));
  } catch {
    app.get('/', async (_request, reply) => reply.type('text/html').send('<!doctype html><meta charset="utf-8"><title>JSON Video Studio</title><p>Web UIを先にビルドしてください: npm run build:web</p>'));
  }

  await app.listen({host, port});
  const socketAddress = app.server.address();
  const actualPort = typeof socketAddress === 'object' && socketAddress ? socketAddress.port : port;
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::1' ? '[::1]' : host;
  const address = `http://${displayHost}:${actualPort}`;
  return {app, address, close: () => app.close()};
};
