import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('../src/render/api.js', () => ({
  inspectOutput: vi.fn(async ({mediaPath}: {mediaPath: string}) => ({
    mediaPath,
    durationSeconds: 1,
    sizeBytes: 100,
  })),
  inspectArtifactOutput: vi.fn(async ({outputDirectory}: {outputDirectory: string}) => ({
    outputDirectory,
    media: {
      mediaPath: resolve(outputDirectory, 'video.mp4'),
      durationSeconds: 1,
      sizeBytes: 100,
    },
  })),
  storyboardProject: vi.fn(),
  renderProject: vi.fn(),
}));

import {RuntimeService} from '../src/core/runtime.js';
import {inspectOutput} from '../src/render/api.js';

const roots: string[] = [];

async function fixture(): Promise<{root: string; media: string; output: string}> {
  const root = await mkdtemp(resolve(tmpdir(), 'json-video-runtime-inspect-'));
  roots.push(root);
  const output = resolve(root, 'projects', 'demo', 'dist', 'demo', 'lock-hash');
  const media = resolve(output, 'video.mp4');
  await mkdir(output, {recursive: true});
  await writeFile(media, 'mock media');
  return {root, media, output};
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('portable RuntimeService inspection results', () => {
  it('returns workspace-relative POSIX paths for media and complete artifact inspection', async () => {
    const {root} = await fixture();
    const runtime = new RuntimeService({workspaceRoot: root});
    const outputReference = 'projects/demo/dist/demo/lock-hash';
    const mediaReference = `${outputReference}/video.mp4`;

    await expect(runtime.inspect(mediaReference)).resolves.toMatchObject({mediaPath: mediaReference});
    await expect(runtime.inspectArtifacts(outputReference)).resolves.toMatchObject({
      outputDirectory: outputReference,
      media: {mediaPath: mediaReference},
    });
  });

  it('fails closed if an inspector returns a workspace-external absolute path', async () => {
    const {root} = await fixture();
    const runtime = new RuntimeService({workspaceRoot: root});
    vi.mocked(inspectOutput).mockResolvedValueOnce({
      mediaPath: resolve(root, '..', 'escaped-video.mp4'),
      durationSeconds: 1,
      sizeBytes: 100,
    });

    await expect(runtime.inspect('projects/demo/dist/demo/lock-hash/video.mp4')).rejects.toMatchObject({
      code: 'JOB_RESULT_PATH_OUTSIDE_WORKSPACE',
      category: 'policy',
    });
  });
});
