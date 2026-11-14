#!/usr/bin/env node
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {McpServer, type ToolCallback} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {AppError, asAppError} from '../core/errors.js';
import {doctor} from '../core/doctor.js';
import {RuntimeService} from '../core/runtime.js';
import {validateProject} from '../core/schema.js';

const workspaceRoot = resolve(process.env.JSON_VIDEO_WORKSPACE_ROOT ?? '/workspace');
const dataRoot = resolve(process.env.JSON_VIDEO_DATA_ROOT ?? resolve(workspaceRoot, '.json-video-work'));
const schemaPath = process.env.JSON_VIDEO_SCHEMA_PATH;
// Job state is private to this server process so concurrent sessions do not
// see or interrupt each other's jobs. The VOICEVOX cache under dataRoot is shared.
const runtime = new RuntimeService({
  workspaceRoot,
  dataRoot,
  jobsRoot: await mkdtemp(resolve(tmpdir(), 'json-video-jobs-')),
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

tool('project_lint', 'Advisory quality findings for a project file: subtitle size, speech rate, on-screen text that repeats the narration, uniform layouts, absolute claims, and missing fields of the production brief (request.json). Returns findings only, never the project.', {
  projectPath: z.string().min(1),
}, async ({projectPath}) => runtime.lintProjectPath(projectPath));

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

tool('speakers_list', 'List the VOICEVOX speakers and styles (speakerUuid, styleId) the Engine offers.', {}, async () =>
  runtime.listSpeakers());

tool('speech_synthesize', 'Synthesize one utterance with VOICEVOX without a project and return the WAV path, the Engine kana reading, and the duration. text is the exact synthesis text (no pronunciation dictionary is applied). The cache is shared with resolve.', {
  text: z.string().min(1).max(2000).regex(/\S/u),
  speakerUuid: z.string().regex(/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u),
  styleId: z.number().int().min(0),
  speedScale: z.number().min(0.5).max(2).optional(),
  volumeScale: z.number().min(0).max(2).optional(),
  pitchScale: z.number().min(-0.15).max(0.15).optional(),
  intonationScale: z.number().min(0).max(2).optional(),
}, async (input) => runtime.synthesizeSpeech(input));

tool('job_status','Get a persistent job record.', {jobId: z.string().uuid()}, async ({jobId}) => runtime.jobs.get(jobId));
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

tool('output_review_frames', 'Sample a rendered MP4 for the final visual review, tiled into sheets under .json-video-work/<project-id>/final-frames/<lock-hash>/: 3 frames per scene (entry, middle, end); 7 frames around every boundary where the same layout continues; 7 frames across every page change (to check the new page is readable when its narration starts); the first frames of every subtitle cue; and motion states of animated scenes. Every sampled frame is also kept as an individual 640x360 PNG for checking legibility at reduced size.', {
  outputDirectory: z.string().min(1),
}, async ({outputDirectory}) => runtime.reviewFrames(outputDirectory));

async function main(): Promise<void> {
  await runtime.initialize();
  // Exit when the client disconnects (stdin closes) so the container does not outlive the session.
  const shutdown = () => void mcp.close().finally(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);
  await mcp.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const appError = asAppError(error, 'MCP_START_FAILED');
  process.stderr.write(`${JSON.stringify(appError.toJSON())}\n`);
  process.exitCode = appError.exitCode;
});
