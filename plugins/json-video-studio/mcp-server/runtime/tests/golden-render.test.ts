import {copyFile, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {digestFile} from '../src/core/fs-safe.js';
import {resolveProject} from '../src/core/resolver.js';
import {storyboardProject} from '../src/render/api.js';
import {comparePngs} from './support/png-compare.js';

const GOLDEN_HASHES = [
  'f9cdae0b6f6bf1f0b09194c5651a5f7f16229b37e61aaa019edf1cfecc0ac520',
  'd56607c62b34dfec7a61adc5ad75c24d311b6d99b9f1c5671b681997e7527cf2',
  'a4f006cb23a02fcba9922b821d9cbca460ca2a87c71074ea4478022e5dda0054',
  '9bbf1833f40265ee7c3d0c4e310e148c7399b0b70424c0caa2f3c500262403e5',
  '157e8c04a1be9722258844f60b04c95d864c4a8344cf9e3daa3b002ab17993a9',
  '15276efabdd639837bbdf91467fca430e55fa4bfcb68801e3b68338a31c5aa88',
  '16581d461c7bfd785e785d0b06791b8d1b635ca6597c6b2be243138acd302bf6',
  'd4db5f9aa6380479f6400f1c8f99016bd7b7027b0be8acf1c0423b502837961e',
] as const;

const GOLDEN_FILES = [
  '001-template-title.png',
  '002-template-bullets.png',
  '003-template-split.png',
  '004-template-media.png',
  '005-template-code.png',
  '006-template-quote.png',
  '007-template-metric.png',
  '008-template-outro.png',
] as const;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('pinned Remotion golden frames', () => {
  it('renders all eight visual templates pixel-identically for the same lock', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-golden-'));
    roots.push(root);
    const projectRoot = path.join(root, 'all-templates');
    const assets = path.join(projectRoot, 'assets');
    await mkdir(assets, {recursive: true});
    await copyFile(
      path.resolve(process.cwd(), 'tests', 'fixtures', 'all-templates-media.png'),
      path.join(assets, 'all-templates-media.png'),
    );
    const projectPath = path.join(projectRoot, 'video-project.json');
    await writeFile(
      projectPath,
      await readFile(path.resolve(import.meta.dirname, 'fixtures', 'all-templates.video-project.json')),
    );

    const resolved = await resolveProject({
      projectPath: 'all-templates/video-project.json',
      workspaceRoot: root,
      cacheRoot: path.join(root, 'cache'),
      ...(process.env.JSON_VIDEO_SCHEMA_PATH ? {schemaPath: process.env.JSON_VIDEO_SCHEMA_PATH} : {}),
    });
    if (resolved.dryRun) throw new Error('Golden resolve unexpectedly ran as dry-run.');

    const first = await storyboardProject({
      projectPath,
      lockPath: resolved.lockPath,
      outputDir: path.join(projectRoot, '.json-video-work', 'golden-first'),
    });
    const second = await storyboardProject({
      projectPath,
      lockPath: resolved.lockPath,
      outputDir: path.join(projectRoot, '.json-video-work', 'golden-second'),
    });
    const firstHashes = await Promise.all((first.storyboard ?? []).map(digestFile));
    const secondHashes = await Promise.all((second.storyboard ?? []).map(digestFile));

    expect(firstHashes).toHaveLength(8);
    expect(secondHashes).toEqual(firstHashes);
    const comparisons = await Promise.all(GOLDEN_FILES.map((name, index) => comparePngs(
      first.storyboard?.[index] ?? '',
      path.resolve(process.cwd(), 'tests', 'fixtures', 'golden', name),
    )));
    for (const [index, comparison] of comparisons.entries()) {
      expect(comparison.sameSize, `${GOLDEN_FILES[index]} dimensions`).toBe(true);
      // Pinned Chromium is exact on the reference platform. Small Skia/font
      // rasterization differences on another CPU architecture are tolerated;
      // movement, clipping, overlap, and color/layout regressions are not.
      expect(comparison.meanAbsoluteError, `${GOLDEN_FILES[index]} mean pixel error`).toBeLessThanOrEqual(0.75);
      expect(comparison.changedPixelRatio, `${GOLDEN_FILES[index]} changed pixel ratio`).toBeLessThanOrEqual(0.015);
    }
    if (process.env.JSON_VIDEO_UPDATE_GOLDEN === '1') {
      process.stderr.write(`JSON_VIDEO_GOLDEN_HASHES=${JSON.stringify(firstHashes)}\n`);
    } else if (
      process.env.JSON_VIDEO_REQUIRE_EXACT_GOLDEN === '1'
      || (process.platform === 'linux' && process.arch === 'x64')
    ) {
      expect(firstHashes).toEqual(GOLDEN_HASHES);
    }
  }, 300_000);
});
