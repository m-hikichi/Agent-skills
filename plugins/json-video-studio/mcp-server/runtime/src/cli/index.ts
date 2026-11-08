#!/usr/bin/env node
import {Command, CommanderError} from 'commander';
import {basename, resolve} from 'node:path';
import {stat} from 'node:fs/promises';
import {asAppError} from '../core/errors.js';
import {doctor} from '../core/doctor.js';
import {readJson, resolveInside} from '../core/fs-safe.js';
import {defaultProject, ProjectService} from '../core/project.js';
import {publishResolveArtifacts, resolveProject} from '../core/resolver.js';
import {portableWorkspaceResult, RuntimeService} from '../core/runtime.js';
import {createWebJobQueue, createWebServiceAdapter} from '../core/web-adapter.js';
import {inspectArtifactOutput, inspectOutput, renderProject, storyboardProject} from '../render/api.js';
import {startWebServer} from '../web/server.js';
import type {ProjectLock, VideoProject} from '../shared/video-types.js';

interface GlobalOptions {
  workspace: string;
  schema?: string;
  json?: boolean;
}

function globalOptions(command: Command): GlobalOptions {
  const options = command.optsWithGlobals<GlobalOptions>();
  return {...options, schema: process.env.JSON_VIDEO_SCHEMA_PATH};
}

function print(value: unknown, json = true): void {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${String(value)}\n`);
}

function progress(event: {progress: number; message: string}): void {
  process.stderr.write(`[${Math.round(event.progress * 100)}%] ${event.message}\n`);
}

function workspace(options: GlobalOptions): string {
  return resolve(options.workspace || process.env.JSON_VIDEO_WORKSPACE_ROOT || process.cwd());
}

function service(options: GlobalOptions): ProjectService {
  return new ProjectService({
    workspaceRoot: workspace(options),
    ...(options.schema === undefined ? {} : {schemaPath: options.schema}),
  });
}

const program = new Command()
  .name('json-video')
  .description('JSON Video Studio CLI')
  .version('0.1.0')
  .option('-w, --workspace <directory>', 'workspace root', process.env.JSON_VIDEO_WORKSPACE_ROOT ?? process.cwd())
  .option('--json', 'print machine-readable JSON', true)
  .showHelpAfterError()
  .exitOverride();

program.command('init')
  .description('create a starter video-project.json')
  .argument('[project]', 'project path', 'video-project.json')
  .option('--id <id>', 'project id')
  .option('--title <title>', 'project title', 'はじめての動画')
  .action(async (projectPath: string, local: {id?: string; title: string}, command: Command) => {
    const options = globalOptions(command);
    const id = local.id ?? basename(projectPath, '.json').replace(/[^a-zA-Z0-9_-]+/gu, '-').toLowerCase();
    const result = await service(options).create(projectPath, defaultProject(id || 'my-video', local.title));
    print(result);
  });

program.command('doctor')
  .description('check runtime dependencies')
  .action(async (_local: unknown, command: Command) => {
    const options = globalOptions(command);
    const report = await doctor({
      workspaceRoot: workspace(options),
      dataRoot: process.env.JSON_VIDEO_DATA_ROOT,
      ...(options.schema === undefined ? {} : {schemaPath: options.schema}),
    });
    print(report);
    if (!report.ok) process.exitCode = 3;
  });

program.command('validate')
  .description('validate a project')
  .argument('[project]', 'project path', 'video-project.json')
  .action(async (projectPath: string, _local: unknown, command: Command) => {
    const result = await service(globalOptions(command)).get(projectPath);
    print({valid: true, ...result});
  });

program.command('resolve')
  .description('inspect assets, synthesize speech, and create project.lock.json')
  .argument('[project]', 'project path', 'video-project.json')
  .option('--dry-run', 'show provider operations without writing')
  .action(async (projectPath: string, local: {dryRun?: boolean}, command: Command) => {
    const options = globalOptions(command);
    const result = await resolveProject({
      projectPath,
      workspaceRoot: workspace(options),
      dryRun: local.dryRun ?? false,
      cacheRoot: resolve(process.env.JSON_VIDEO_DATA_ROOT ?? resolve(workspace(options), '.json-video-work'), 'cache', 'voicevox'),
      ...(options.schema === undefined ? {} : {schemaPath: options.schema}),
      onProgress: progress,
    });
    const output = result.dryRun ? result : {
      lockPath: result.lockPath,
      lockHash: result.lock.lockHash,
      totalFrames: result.lock.totalFrames,
      captionsPath: result.captionsPath,
      chaptersPath: result.chaptersPath,
      creditsPath: result.creditsPath,
    };
    print(await portableWorkspaceResult(workspace(options), output));
  });

program.command('storyboard')
  .description('render scene stills and a contact sheet')
  .argument('[project]', 'project path', 'video-project.json')
  .option('-o, --output <directory>', 'output directory')
  .action(async (projectPath: string, local: {output?: string}, command: Command) => {
    const options = globalOptions(command);
    const absolute = await service(options).projectPath(projectPath, true);
    const outputDir = local.output === undefined ? undefined : await resolveInside(workspace(options), local.output);
    const result = await storyboardProject({
      projectPath: absolute,
      ...(outputDir === undefined ? {} : {outputDir}),
      onProgress: progress,
    });
    print(await portableWorkspaceResult(workspace(options), result));
  });

program.command('render')
  .description('render MP4 and thumbnail from a current lock')
  .argument('[project]', 'project path', 'video-project.json')
  .option('-o, --output <directory>', 'output directory')
  .option('--frozen-lock', 'require project.lock.json to match the project', true)
  .action(async (projectPath: string, local: {output?: string; frozenLock: boolean}, command: Command) => {
    const options = globalOptions(command);
    const projects = service(options);
    const absolute = await projects.projectPath(projectPath, true);
    const project = await readJson<VideoProject>(absolute);
    const lockPath = await projects.safeLockPath(absolute, project.meta.id, true);
    const lock = await readJson<ProjectLock>(lockPath);
    const outputDir = local.output === undefined ? undefined : await resolveInside(workspace(options), local.output);
    const result = await renderProject({
      projectPath: absolute,
      lockPath,
      frozenLock: local.frozenLock,
      ...(outputDir === undefined ? {} : {outputDir}),
      onProgress: progress,
    });
    print(await portableWorkspaceResult(workspace(options), await publishResolveArtifacts(absolute, lock, result)));
  });

program.command('inspect')
  .description('inspect a rendered media file or complete output directory')
  .argument('<path>', 'media file or output directory')
  .option('--lock-hash <sha256>', 'expected frozen lock hash')
  .action(async (inputPath: string, local: {lockHash?: string}, command: Command) => {
    const options = globalOptions(command);
    const inspectedPath = await resolveInside(workspace(options), inputPath, {mustExist: true});
    const result = (await stat(inspectedPath)).isDirectory()
      ? await inspectArtifactOutput({outputDirectory: inspectedPath, ...(local.lockHash ? {expectedLockHash: local.lockHash} : {})})
      : await inspectOutput({mediaPath: inspectedPath});
    print(await portableWorkspaceResult(workspace(options), result));
  });

program.command('ui')
  .description('start the local Web UI')
  .option('--host <host>', 'loopback host', '127.0.0.1')
  .option('--port <port>', 'port', (value) => Number.parseInt(value, 10), 43120)
  .action(async (local: {host: string; port: number}, command: Command) => {
    const options = globalOptions(command);
    const runtime = new RuntimeService({
      workspaceRoot: workspace(options),
      dataRoot: process.env.JSON_VIDEO_DATA_ROOT,
      ...(options.schema === undefined ? {} : {schemaPath: options.schema}),
    });
    await runtime.initialize();
    const queue = createWebJobQueue(runtime);
    const server = await startWebServer({
      workspaceRoot: runtime.workspaceRoot,
      host: local.host,
      port: local.port,
      jobQueue: queue,
      service: createWebServiceAdapter(runtime),
    });
    print({address: server.address});
    await waitForShutdown(server.close);
  });

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    const done = () => resolvePromise();
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
  await close();
}

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError && ['commander.helpDisplayed', 'commander.version'].includes(error.code)) return;
  const appError = asAppError(error);
  process.stderr.write(`${JSON.stringify(appError.toJSON(), null, 2)}\n`);
  process.exitCode = appError.exitCode;
});
