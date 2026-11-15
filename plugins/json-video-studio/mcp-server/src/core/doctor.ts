import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {VERSION as REMOTION_VERSION} from 'remotion/version';
import {BUNDLED_FONT_FAMILY} from '../shared/video-types.js';
import {lockValidator, projectValidator, resolveSchemaPath} from './schema.js';
import {toolVersion} from './media.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  value?: string;
  hint?: string;
}

export interface DoctorReport {
  ok: boolean;
  checkedAt: string;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  schemaPath?: string;
  voicevoxUrl?: string;
  workspaceRoot?: string;
  dataRoot?: string;
}

async function capture(name: string, work: () => Promise<string>, hint: string): Promise<DoctorCheck> {
  try {
    return {name, ok: true, value: await work()};
  } catch (error) {
    return {name, ok: false, value: error instanceof Error ? error.message : String(error), hint};
  }
}

async function assertWritable(root: string): Promise<string> {
  await mkdir(root, {recursive: true});
  const temporary = await mkdtemp(resolve(root, '.json-video-doctor-'));
  try {
    const probe = resolve(temporary, 'write-test');
    await writeFile(probe, 'ok', {encoding: 'utf8', flag: 'wx'});
    if (await readFile(probe, 'utf8') !== 'ok') throw new Error('write verification failed');
    return root;
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

function approvedVoicevoxUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || !['voicevox', 'localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(parsed.hostname)) {
    throw new Error('VOICEVOX URL must point to an approved local host.');
  }
  return parsed;
}

export async function doctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const voicevoxUrl = (options.voicevoxUrl ?? process.env.VOICEVOX_URL ?? process.env.JSON_VIDEO_VOICEVOX_URL ?? 'http://voicevox:50021').replace(/\/$/u, '');
  const workspaceRoot = resolve(options.workspaceRoot ?? process.env.JSON_VIDEO_WORKSPACE_ROOT ?? process.cwd());
  const dataRoot = resolve(options.dataRoot ?? process.env.JSON_VIDEO_DATA_ROOT ?? resolve(workspaceRoot, '.json-video-work'));
  const chrome = process.env.CHROME_BIN ?? process.env.REMOTION_BROWSER_EXECUTABLE ?? 'chromium';
  const checks = await Promise.all([
    capture('node', async () => process.version, 'Use the Docker image.'),
    capture('workspace-write', () => assertWritable(workspaceRoot), 'Check the ${CLAUDE_PROJECT_DIR} Docker mount and permissions.'),
    capture('plugin-data-write', () => assertWritable(dataRoot), 'Check the ${CLAUDE_PLUGIN_DATA} Docker mount and permissions.'),
    capture('schemas', async () => {
      const schemaPath = await resolveSchemaPath(options.schemaPath);
      await Promise.all([projectValidator(schemaPath), lockValidator(schemaPath)]);
      return `${schemaPath} (project 1.0.0 + lock 1.0.0)`;
    }, 'Set JSON_VIDEO_SCHEMA_PATH to the bundled video-project.schema.json.'),
    capture('ffmpeg', () => toolVersion(process.env.FFMPEG_PATH ?? 'ffmpeg'), 'Install FFmpeg or use the Docker image.'),
    capture('ffprobe', () => toolVersion(process.env.FFPROBE_PATH ?? 'ffprobe'), 'Install ffprobe or use the Docker image.'),
    capture('chrome', () => toolVersion(chrome, ['--version']), 'Use the image-bundled Chromium.'),
    capture('remotion', async () => REMOTION_VERSION, 'Rebuild the json-video-studio image.'),
    capture('font', () => toolVersion('fc-match', ['--format=%{family} %{version}\n', BUNDLED_FONT_FAMILY]), `Use the image-bundled ${BUNDLED_FONT_FAMILY} font.`),
    capture('voicevox-version', async () => {
      approvedVoicevoxUrl(voicevoxUrl);
      const response = await fetch(`${voicevoxUrl}/version`, {signal: AbortSignal.timeout(3000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return String(await response.json());
    }, 'Start the VOICEVOX Engine container.'),
    capture('voicevox-speakers', async () => {
      approvedVoicevoxUrl(voicevoxUrl);
      const response = await fetch(`${voicevoxUrl}/speakers`, {signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const speakers = await response.json() as unknown[];
      if (!Array.isArray(speakers) || speakers.length === 0) throw new Error('No VOICEVOX speakers were returned.');
      return `${speakers.length} speakers`;
    }, 'Confirm VOICEVOX models are available and review each speaker terms.'),
  ]);
  return {ok: checks.every((check) => check.ok), checkedAt: new Date().toISOString(), checks};
}
