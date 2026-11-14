import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {resolveProject} from '../src/core/resolver.js';
import {storyboardProject} from '../src/render/api.js';
import {comparePngs, decodePng} from './support/png-compare.js';

// Connection diagram (two states of one page), nest, timeline, a scaled and
// centred slide with a code block, and the logo-less cover, in the deck frame
// without the footer row. Update by copying fresh storyboard stills here.
const GOLDEN_FILES = ['diagram-001-request.png', 'diagram-002-response.png', 'diagram-003-nest.png', 'diagram-004-timeline.png', 'diagram-005-slide-code.png', 'diagram-006-outro.png'] as const;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('diagram visuals golden frames', () => {
  it('renders the diagram example within the golden tolerance, with a full-bleed cover', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-diagrams-'));
    roots.push(root);
    const projectRoot = path.join(root, 'diagrams');
    await mkdir(projectRoot, {recursive: true});
    const projectPath = path.join(projectRoot, 'video-project.json');
    await writeFile(projectPath, await readFile(path.resolve(import.meta.dirname, '..', '..', 'examples', 'diagrams.video-project.json')));
    const resolved = await resolveProject({
      projectPath: 'diagrams/video-project.json',
      workspaceRoot: root,
      cacheRoot: path.join(root, 'cache'),
      ...(process.env.JSON_VIDEO_SCHEMA_PATH ? {schemaPath: process.env.JSON_VIDEO_SCHEMA_PATH} : {}),
    });
    if (resolved.dryRun) throw new Error('Golden resolve unexpectedly ran as dry-run.');
    const result = await storyboardProject({projectPath, lockPath: resolved.lockPath, outputDir: path.join(projectRoot, '.json-video-work', 'golden')});
    expect(result.storyboard).toHaveLength(GOLDEN_FILES.length);
    // Every content page is measured, and none of them leaves a third of the card empty.
    expect(result.layoutMetrics.map((metric) => metric.sceneId)).toEqual(['diagram-request', 'diagram-response', 'nest-menu', 'timeline-service', 'slide-code']);
    expect(result.warnings.filter((warning) => warning.message.includes('空白'))).toEqual([]);
    for (const [index, name] of GOLDEN_FILES.entries()) {
      const comparison = await comparePngs(result.storyboard?.[index] ?? '', path.resolve(import.meta.dirname, 'fixtures', 'golden', name));
      expect(comparison.sameSize, `${name} dimensions`).toBe(true);
      expect(comparison.meanAbsoluteError, `${name} mean pixel error`).toBeLessThanOrEqual(0.75);
      expect(comparison.changedPixelRatio, `${name} changed pixel ratio`).toBeLessThanOrEqual(0.015);
    }
    // Without a cover logo the gradient reaches the bottom edge: no white band.
    const cover = await decodePng(result.storyboard!.at(-1)!);
    const bottomRow = cover.rgb.subarray((cover.height - 2) * cover.width * 3, (cover.height - 1) * cover.width * 3);
    const white = bottomRow.filter((_, offset) => offset % 3 === 0 && bottomRow[offset]! > 245 && bottomRow[offset + 1]! > 245 && bottomRow[offset + 2]! > 245).length;
    expect(white / cover.width).toBeLessThan(0.02);
  }, 300_000);
});
