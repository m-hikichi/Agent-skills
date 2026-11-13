import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {resolveProject} from '../src/core/resolver.js';
import {storyboardProject} from '../src/render/api.js';
import {comparePngs} from './support/png-compare.js';

// Cover, a text/list/table page and a cards/kpis/steps/callout page in the
// deck frame, each with emphasis applied. Compared with the same tolerance
// as the template goldens; update by copying fresh storyboard stills here.
const GOLDEN_FILES = ['deck-001-cover.png', 'deck-002-slide-a.png', 'deck-003-slide-b.png'] as const;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('deck frame golden frames', () => {
  it('renders the cover and slide pages within the golden tolerance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-deck-'));
    roots.push(root);
    const projectRoot = path.join(root, 'deck');
    await mkdir(projectRoot, {recursive: true});
    const projectPath = path.join(projectRoot, 'video-project.json');
    await writeFile(projectPath, await readFile(path.resolve(import.meta.dirname, 'fixtures', 'deck-slide.video-project.json')));
    const resolved = await resolveProject({
      projectPath: 'deck/video-project.json',
      workspaceRoot: root,
      cacheRoot: path.join(root, 'cache'),
      ...(process.env.JSON_VIDEO_SCHEMA_PATH ? {schemaPath: process.env.JSON_VIDEO_SCHEMA_PATH} : {}),
    });
    if (resolved.dryRun) throw new Error('Golden resolve unexpectedly ran as dry-run.');
    const result = await storyboardProject({projectPath, lockPath: resolved.lockPath, outputDir: path.join(projectRoot, '.json-video-work', 'golden')});
    expect(result.storyboard).toHaveLength(GOLDEN_FILES.length);
    for (const [index, name] of GOLDEN_FILES.entries()) {
      const comparison = await comparePngs(result.storyboard?.[index] ?? '', path.resolve(import.meta.dirname, 'fixtures', 'golden', name));
      expect(comparison.sameSize, `${name} dimensions`).toBe(true);
      expect(comparison.meanAbsoluteError, `${name} mean pixel error`).toBeLessThanOrEqual(0.75);
      expect(comparison.changedPixelRatio, `${name} changed pixel ratio`).toBeLessThanOrEqual(0.015);
    }
  }, 300_000);
});
