#!/usr/bin/env node
import {resolve} from 'node:path';
import {McpServer, type ToolCallback} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {AppError, asAppError} from '../core/errors.js';
import {doctor} from '../core/doctor.js';
import {RuntimeService} from '../core/runtime.js';
import {createWebJobQueue, createWebServiceAdapter} from '../core/web-adapter.js';
import {validateProject} from '../core/schema.js';
import {startWebServer} from '../web/server.js';

const workspaceRoot = resolve(process.env.JSON_VIDEO_WORKSPACE_ROOT ?? '/workspace');
const dataRoot = resolve(process.env.JSON_VIDEO_DATA_ROOT ?? resolve(workspaceRoot, '.json-video-work'));
const schemaPath = process.env.JSON_VIDEO_SCHEMA_PATH;
const runtime = new RuntimeService({
  workspaceRoot,
  dataRoot,
  ...(schemaPath === undefined ? {} : {schemaPath}),
});

const mcp = new McpServer({name: 'json-video-studio', version: '0.1.0'});

function textResult(value: unknown): CallToolResult {
  return {content: [{type: 'text' as const, text: JSON.stringify(value, null, 2)}]};
}

function errorResult(error: unknown): CallToolResult {
  const appError = asAppError(error);
  return {isError: true, content: [{type: 'text' as const, text: JSON.stringify(appError.toJSON(), null, 2)}]};
}

function tool<Input extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Input,
  handler: (input: z.output<z.ZodObject<Input>>) => Promise<unknown>,
): void {
  const callback = (async (input: unknown): Promise<CallToolResult> => {
    try {
      // The SDK's Zod v3/v4 compatibility mapper and Zod's object output are
      // structurally equivalent after registerTool has parsed the raw shape.
      return textResult(await handler(input as z.output<z.ZodObject<Input>>));
    } catch (error) {
      return errorResult(error);
    }
  }) as ToolCallback<Input>;
  mcp.registerTool<Input, Input>(name, {description, inputSchema: shape}, callback);
}

tool('doctor', 'Check Schema, FFmpeg, ffprobe, and VOICEVOX availability.', {}, async () =>
  doctor({workspaceRoot, dataRoot, ...(schemaPath === undefined ? {} : {schemaPath})}));

tool('project_create', 'Create a validated JSON video project.', {
  projectPath: z.string().min(1),
  project: z.unknown().optional(),
}, async ({projectPath, project}) => runtime.createProject(projectPath, project));

tool('project_get', 'Read a project with revision, digest, and lock state.', {
  projectPath: z.string().min(1),
}, async ({projectPath}) => runtime.getProject(projectPath));

tool('project_update', 'Update a project using optimistic revision control.', {
  projectPath: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  project: z.unknown(),
}, async ({projectPath, expectedRevision, project}) => runtime.updateProject(projectPath, project, expectedRevision));

tool('project_validate', 'Validate a project file or an in-memory project.', {
  projectPath: z.string().min(1).optional(),
  project: z.unknown().optional(),
}, async ({projectPath, project}) => {
  if (project !== undefined) {
    const validated = await validateProject(project, schemaPath === undefined ? {} : {schemaPath});
    return {valid: true, project: validated};
  }
  if (projectPath) return {valid: true, ...(await runtime.validateProjectPath(projectPath))};
  throw new AppError('PROJECT_INPUT_REQUIRED', 'projectPathまたはprojectが必要です', {category: 'schema'});
});

tool('ui_info', 'Return the loopback Web UI address.', {}, async () => ({
  address: `http://127.0.0.1:${Number.parseInt(process.env.JSON_VIDEO_UI_PORT ?? '43120', 10)}`,
  running: true,
}));

tool('resolve_start', 'Start a resolve job in the persistent single-worker queue.', {
  projectPath: z.string().min(1),
  dryRun: z.boolean().optional(),
}, async ({projectPath, dryRun}) => runtime.jobs.start({
  kind: 'resolve',
  projectPath,
  ...(dryRun === undefined ? {} : {input: {dryRun}}),
}));

for (const [name, kind] of [
  ['storyboard_start', 'storyboard'],
  ['render_start', 'render'],
] as const) {
  tool(name, `Start a ${kind} job in the persistent single-worker queue.`, {
    projectPath: z.string().min(1),
    outputDir: z.string().min(1).optional(),
  }, async ({projectPath, outputDir}) => runtime.jobs.start({
    kind,
    projectPath,
    ...(outputDir === undefined ? {} : {input: {outputDir}}),
  }));
}

tool('job_status', 'Get a persistent job record.', {jobId: z.string().uuid()}, async ({jobId}) => runtime.jobs.get(jobId));
tool('job_cancel', 'Cancel a queued or running job.', {jobId: z.string().uuid()}, async ({jobId}) => runtime.jobs.cancel(jobId));
tool('output_inspect', 'Inspect a rendered media file with ffprobe.', {
  mediaPath: z.string().min(1).optional(),
  outputDirectory: z.string().min(1).optional(),
  expectedLockHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}, async ({mediaPath, outputDirectory, expectedLockHash}) => {
  if (outputDirectory) return runtime.inspectArtifacts(outputDirectory, expectedLockHash);
  if (mediaPath) return runtime.inspect(mediaPath);
  throw new AppError('INSPECT_INPUT_REQUIRED', 'mediaPathまたはoutputDirectoryが必要です', {category: 'schema'});
});

async function main(): Promise<void> {
  await runtime.initialize();
  const web = await startWebServer({
    workspaceRoot,
    host: process.env.JSON_VIDEO_UI_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.JSON_VIDEO_UI_PORT ?? '43120', 10),
    jobQueue: createWebJobQueue(runtime),
    service: createWebServiceAdapter(runtime),
  });
  const transport = new StdioServerTransport();
  const shutdown = async () => {
    await Promise.allSettled([web.close(), mcp.close()]);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await mcp.connect(transport);
}

main().catch((error: unknown) => {
  const appError = asAppError(error, 'MCP_START_FAILED');
  process.stderr.write(`${JSON.stringify(appError.toJSON())}\n`);
  process.exitCode = appError.exitCode;
});
