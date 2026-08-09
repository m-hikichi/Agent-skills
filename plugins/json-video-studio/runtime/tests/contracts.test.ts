import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import type {VideoProject} from '../src/shared/video-types.js';
import {clearSchemaCacheForTests, validateProject, validateProjectLock} from '../src/core/schema.js';

const pluginRoot = resolve(import.meta.dirname, '..', '..');
const schemaPath = resolve(pluginRoot, 'schemas', 'video-project.schema.json');
const fixture = async (name: string): Promise<VideoProject> => JSON.parse(
  await readFile(resolve(pluginRoot, 'examples', name), 'utf8'),
) as VideoProject;

beforeEach(() => clearSchemaCacheForTests());

describe('authoring Schema and semantic policy', () => {
  it('accepts all canonical valid fixtures and rejects the canonical invalid fixture', async () => {
    await expect(validateProject(await fixture('minimal.video-project.json'), {schemaPath})).resolves.toBeTruthy();
    await expect(validateProject(await fixture('dialogue.video-project.json'), {schemaPath})).resolves.toBeTruthy();
    await expect(validateProject(await fixture('all-templates.video-project.json'), {schemaPath})).resolves.toBeTruthy();
    await expect(validateProject(await fixture('invalid.video-project.json'), {schemaPath})).rejects.toMatchObject({code: 'SCHEMA_VALIDATION_FAILED'});
  });

  it.each([
    ['unknown version', (project: Record<string, unknown>) => { project.schemaVersion = '2.0.0'; }, 'SCHEMA_VALIDATION_FAILED'],
    ['unknown field', (project: Record<string, unknown>) => { project.unknown = true; }, 'SCHEMA_VALIDATION_FAILED'],
    ['negative duration', (project: Record<string, unknown>) => { ((project.sections as Array<{scenes: Array<Record<string, unknown>>}>)[0]!.scenes[0]!).durationMs = -1; }, 'SCHEMA_VALIDATION_FAILED'],
    ['long title', (project: Record<string, unknown>) => { ((project.meta as Record<string, unknown>).title) = 'a'.repeat(201); }, 'SCHEMA_VALIDATION_FAILED'],
    ['non-bundled font', (project: Record<string, unknown>) => { ((project.theme as Record<string, unknown>).fontFamily) = 'Arial'; }, 'SCHEMA_VALIDATION_FAILED'],
    ['disabled required video output', (project: Record<string, unknown>) => { ((project.outputs as Record<string, unknown>).video) = false; }, 'SCHEMA_VALIDATION_FAILED'],
    ['disabled required storyboard output', (project: Record<string, unknown>) => { ((project.outputs as Record<string, unknown>).storyboard) = false; }, 'SCHEMA_VALIDATION_FAILED'],
  ])('rejects %s', async (_label, mutate, code) => {
    const project = await fixture('minimal.video-project.json') as unknown as Record<string, unknown>;
    mutate(project);
    await expect(validateProject(project, {schemaPath})).rejects.toMatchObject({code});
  });

  it('allows only captions, chapters, and thumbnail to be disabled', async () => {
    const project = await fixture('minimal.video-project.json');
    project.outputs = {...project.outputs, captions: false, chapters: false, thumbnail: false};
    await expect(validateProject(project, {schemaPath})).resolves.toMatchObject({
      outputs: {video: true, storyboard: true, captions: false, chapters: false, thumbnail: false},
    });
  });

  it('rejects duplicate IDs and unknown references', async () => {
    const duplicate = await fixture('minimal.video-project.json');
    duplicate.sections.push(structuredClone(duplicate.sections[0]!));
    await expect(validateProject(duplicate, {schemaPath})).rejects.toMatchObject({code: 'DUPLICATE_ID'});

    const reference = await fixture('minimal.video-project.json');
    reference.sections[0]!.scenes[0]!.visual = {type: 'media', assetId: 'missing'};
    await expect(validateProject(reference, {schemaPath})).rejects.toMatchObject({code: 'UNKNOWN_ASSET'});
  });

  it.each(['../escape.png', '/etc/passwd', 'C:\\private\\file.png', '\\\\server\\share\\file.png', 'https://example.com/file.png', 'assets/evil.svg'])('rejects unsafe asset path %s', async (assetPath) => {
    const project = await fixture('minimal.video-project.json');
    project.assets.push({id: 'unsafe', type: 'image', path: assetPath, rights: {status: 'owned'}});
    await expect(validateProject(project, {schemaPath})).rejects.toMatchObject({category: expect.stringMatching(/schema|policy/u)});
  });

  it('rejects mismatched metric labels and values', async () => {
    const project = await fixture('minimal.video-project.json');
    project.sections[0]!.scenes[0]!.visual = {type: 'metric', variant: 'bar', label: 'x', values: [1, 2], labels: ['one']};
    await expect(validateProject(project, {schemaPath})).rejects.toMatchObject({code: 'METRIC_LENGTH_MISMATCH'});
  });
});

describe('frozen lock Schema', () => {
  it('validates frame continuity and asset references', async () => {
    const lock = {
      lockVersion: '1.0.0',
      projectDigest: 'a'.repeat(64), lockHash: 'b'.repeat(64), generatedAt: new Date(0).toISOString(),
      runtime: {node: 'v24.0.0', remotion: '4.0.503', ffmpeg: 'ffmpeg', chrome: 'chromium', font: 'Noto'},
      assets: [],
      scenes: [{id: 'one', visual: {type: 'title', title: 'one'}, sectionId: 'section', sectionTitle: 'Section', startFrame: 0, durationInFrames: 30, audioDurationMs: 0, durationMs: 1000, subtitleText: ''}],
      totalFrames: 30, fps: 30, credits: [], warnings: [],
    };
    await expect(validateProjectLock(lock, {projectSchemaPath: schemaPath})).resolves.toMatchObject({totalFrames: 30});
    await expect(validateProjectLock({...lock, totalFrames: 31}, {projectSchemaPath: schemaPath})).rejects.toMatchObject({code: 'LOCK_TIMELINE_INVALID'});
    const broken = structuredClone(lock);
    broken.scenes[0]!.resolvedAudioAssetId = 'missing';
    await expect(validateProjectLock(broken, {projectSchemaPath: schemaPath})).rejects.toMatchObject({code: 'LOCK_ASSET_REFERENCE_INVALID'});
  });
});
