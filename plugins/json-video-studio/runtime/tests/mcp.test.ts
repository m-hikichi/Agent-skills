import {readFile, mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {getDefaultEnvironment, StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {afterEach, describe, expect, it} from 'vitest';
import type {VideoProject} from '../src/shared/video-types.js';
import type {JobRecord} from '../src/shared/contracts.js';

const temporaryRoots: string[] = [];
const runtimeRoot = resolve(import.meta.dirname, '..');
const schemaPath = resolve(import.meta.dirname, '../../schemas/video-project.schema.json');
const examplePath = resolve(import.meta.dirname, '../../examples/minimal.video-project.json');

const expectedTools = [
  'doctor',
  'job_cancel',
  'job_status',
  'output_inspect',
  'project_create',
  'project_get',
  'project_update',
  'project_validate',
  'render_start',
  'resolve_start',
  'storyboard_start',
  'ui_info',
] as const;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'json-video-mcp-'));
  temporaryRoots.push(root);
  return root;
}

function textJson<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const first = result.content[0];
  if (first?.type !== 'text') throw new Error('MCP tool did not return JSON text content');
  return JSON.parse(first.text) as T;
}

async function waitForJob(client: Client, jobId: string): Promise<JobRecord> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = textJson<JobRecord>(await client.callTool({name: 'job_status', arguments: {jobId}}));
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(result.status)) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for MCP job ${jobId}`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

function silentWav(): Buffer {
  const sampleRate = 8_000;
  const samples = 800;
  const dataSize = samples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('stdio MCP server', () => {
  it('exposes the complete tool contract and validates an in-memory project', async () => {
    const root = await temporaryRoot();
    const workspaceRoot = resolve(root, 'workspace');
    const dataRoot = resolve(root, 'plugin-data');
    await Promise.all([mkdir(workspaceRoot, {recursive: true}), mkdir(dataRoot, {recursive: true})]);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/mcp/index.ts'],
      cwd: runtimeRoot,
      env: {
        ...getDefaultEnvironment(),
        JSON_VIDEO_WORKSPACE_ROOT: workspaceRoot,
        JSON_VIDEO_DATA_ROOT: dataRoot,
        JSON_VIDEO_SCHEMA_PATH: schemaPath,
        JSON_VIDEO_UI_HOST: '127.0.0.1',
        JSON_VIDEO_UI_PORT: '0',
      },
      stderr: 'pipe',
    });
    const client = new Client({name: 'json-video-studio-integration-test', version: '0.1.0'});

    try {
      await client.connect(transport);

      const listed = await client.listTools();
      expect(listed.tools.map(({name}) => name).sort()).toEqual(expectedTools);
      const byName = Object.fromEntries(listed.tools.map((entry) => [entry.name, entry]));
      expect(byName.resolve_start?.inputSchema).toMatchObject({properties: {projectPath: {}, dryRun: {}}});
      expect(byName.resolve_start?.inputSchema).not.toMatchObject({properties: {outputDir: {}}});
      expect(byName.storyboard_start?.inputSchema).toMatchObject({properties: {projectPath: {}, outputDir: {}}});
      expect(byName.storyboard_start?.inputSchema).not.toMatchObject({properties: {dryRun: {}}});
      expect(byName.render_start?.inputSchema).not.toMatchObject({properties: {dryRun: {}}});

      const project = JSON.parse(await readFile(examplePath, 'utf8')) as VideoProject;
      const result = await client.callTool({name: 'project_validate', arguments: {project}});
      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      const first = result.content[0];
      expect(first?.type).toBe('text');
      if (first?.type !== 'text') throw new Error('project_validate did not return text content');
      expect(JSON.parse(first.text)).toMatchObject({valid: true, project: {schemaVersion: '1.0.0'}});

      await client.callTool({
        name: 'project_create',
        arguments: {projectPath: 'projects/demo/video-project.json', project},
      });
      const started = textJson<JobRecord>(await client.callTool({
        name: 'resolve_start',
        arguments: {projectPath: 'projects/demo/video-project.json', dryRun: true},
      }));
      const completed = await waitForJob(client, started.id);
      expect(completed).toMatchObject({
        kind: 'resolve',
        status: 'succeeded',
        result: {
          dryRun: true,
          lockPath: 'projects/demo/.json-video-work/minimal-demo/project.lock.json',
        },
      });
      expect(JSON.stringify(completed.result)).not.toContain(workspaceRoot);
      expect(String(completed.result?.lockPath)).not.toMatch(/^(?:[a-zA-Z]:[\\/]|\/)/u);

      const resolved = textJson<JobRecord>(await client.callTool({
        name: 'resolve_start',
        arguments: {projectPath: 'projects/demo/video-project.json'},
      }));
      const resolvedCompleted = await waitForJob(client, resolved.id);
      expect(resolvedCompleted).toMatchObject({
        status: 'succeeded',
        result: {
          lockPath: 'projects/demo/.json-video-work/minimal-demo/project.lock.json',
          captionsPath: 'projects/demo/.json-video-work/minimal-demo/captions.srt',
          chaptersPath: 'projects/demo/.json-video-work/minimal-demo/chapters.txt',
          creditsPath: 'projects/demo/.json-video-work/minimal-demo/credits.txt',
        },
      });
      expect(JSON.stringify(resolvedCompleted.result)).not.toContain(workspaceRoot);

      const mediaReference = 'projects/demo/silence.wav';
      await writeFile(resolve(workspaceRoot, mediaReference), silentWav());
      const inspected = textJson<{mediaPath: string}>(await client.callTool({
        name: 'output_inspect',
        arguments: {mediaPath: mediaReference},
      }));
      expect(inspected.mediaPath).toBe(mediaReference);
      expect(JSON.stringify(inspected)).not.toContain(workspaceRoot);
    } finally {
      await client.close();
    }
  });
});
