import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {portableWorkspaceResult, RuntimeService} from '../src/core/runtime.js';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'json-video-runtime-paths-'));
  roots.push(root);
  await mkdir(resolve(root, 'projects', 'demo'), {recursive: true});
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('portable RuntimeService job results', () => {
  it('recursively converts resolve, storyboard, render, and nested inspection paths to workspace-relative POSIX paths', async () => {
    const root = await workspace();
    const runtime = new RuntimeService({workspaceRoot: root});
    const projectRoot = resolve(root, 'projects', 'demo');

    const result = await runtime.portableResult({
      resolve: {
        lockPath: resolve(projectRoot, '.json-video-work', 'demo', 'project.lock.json'),
        captionsPath: resolve(projectRoot, '.json-video-work', 'demo', 'captions.srt'),
      },
      storyboard: {
        outputDirectory: resolve(projectRoot, '.json-video-work', 'demo', 'storyboard', 'lock-hash'),
        storyboard: [resolve(projectRoot, '.json-video-work', 'demo', 'storyboard', 'lock-hash', '001-intro.png')],
      },
      render: {
        outputDirectory: resolve(projectRoot, 'dist', 'demo', 'lock-hash'),
        video: resolve(projectRoot, 'dist', 'demo', 'lock-hash', 'video.mp4'),
        inspection: {mediaPath: resolve(projectRoot, 'dist', 'demo', 'lock-hash', 'video.mp4')},
      },
      relativeManifestPath: 'storyboard/001-intro.png',
    });

    expect(result).toEqual({
      resolve: {
        lockPath: 'projects/demo/.json-video-work/demo/project.lock.json',
        captionsPath: 'projects/demo/.json-video-work/demo/captions.srt',
      },
      storyboard: {
        outputDirectory: 'projects/demo/.json-video-work/demo/storyboard/lock-hash',
        storyboard: ['projects/demo/.json-video-work/demo/storyboard/lock-hash/001-intro.png'],
      },
      render: {
        outputDirectory: 'projects/demo/dist/demo/lock-hash',
        video: 'projects/demo/dist/demo/lock-hash/video.mp4',
        inspection: {mediaPath: 'projects/demo/dist/demo/lock-hash/video.mp4'},
      },
      relativeManifestPath: 'storyboard/001-intro.png',
    });
    expect(JSON.stringify(result)).not.toContain('\\');
  });

  it('fails closed when any recursively nested absolute path is outside the workspace', async () => {
    const root = await workspace();
    const outside = resolve(root, '..', 'not-in-workspace', 'video.mp4');

    await expect(portableWorkspaceResult(root, {
      outputDirectory: resolve(root, 'projects', 'demo', 'dist'),
      inspection: {mediaPath: outside},
    })).rejects.toMatchObject({
      code: 'JOB_RESULT_PATH_OUTSIDE_WORKSPACE',
      category: 'policy',
    });
  });
});
