import {copyFile, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import {afterEach, describe, expect, it} from 'vitest';
import {digestFile} from '../src/core/fs-safe.js';
import {resolveProject} from '../src/core/resolver.js';
import {storyboardProject} from '../src/render/api.js';

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

interface DecodedPng {
  width: number;
  height: number;
  rgb: Buffer;
}

const paeth = (left: number, above: number, upperLeft: number): number => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

/** Decode the non-interlaced 8-bit RGB/RGBA PNGs emitted by Chromium. */
const decodePng = async (filename: string): Promise<DecodedPng> => {
  const encoded = await readFile(filename);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!encoded.subarray(0, 8).equals(signature)) throw new Error(`${filename} is not a PNG.`);
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = -1;
  let interlace = -1;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 12 <= encoded.length;) {
    const length = encoded.readUInt32BE(offset);
    const type = encoded.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > encoded.length) throw new Error(`${filename} contains a truncated PNG chunk.`);
    if (type === 'IHDR') {
      width = encoded.readUInt32BE(start);
      height = encoded.readUInt32BE(start + 4);
      bitDepth = encoded[start + 8] ?? -1;
      colorType = encoded[start + 9] ?? -1;
      interlace = encoded[start + 12] ?? -1;
    } else if (type === 'IDAT') {
      compressed.push(encoded.subarray(start, end));
    }
    offset = end + 4;
    if (type === 'IEND') break;
  }
  if (width <= 0 || height <= 0 || bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(`${filename} must be a non-interlaced 8-bit RGB or RGBA PNG.`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const filtered = inflateSync(Buffer.concat(compressed));
  if (filtered.length !== (stride + 1) * height) throw new Error(`${filename} has an unexpected scanline size.`);
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * (stride + 1)] ?? -1;
    if (filter < 0 || filter > 4) throw new Error(`${filename} uses unsupported PNG filter ${filter}.`);
    const sourceStart = row * (stride + 1) + 1;
    const targetStart = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const source = filtered[sourceStart + column] ?? 0;
      const left = column >= channels ? (pixels[targetStart + column - channels] ?? 0) : 0;
      const above = row > 0 ? (pixels[targetStart + column - stride] ?? 0) : 0;
      const upperLeft = row > 0 && column >= channels ? (pixels[targetStart + column - stride - channels] ?? 0) : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      pixels[targetStart + column] = (source + predictor) & 0xff;
    }
  }
  if (channels === 3) return {width, height, rgb: pixels};
  const rgb = Buffer.alloc(width * height * 3);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 3) {
    const alpha = (pixels[source + 3] ?? 0) / 255;
    // Compare visible premultiplied color so hidden RGB in transparent pixels
    // cannot create a false regression.
    rgb[target] = Math.round((pixels[source] ?? 0) * alpha);
    rgb[target + 1] = Math.round((pixels[source + 1] ?? 0) * alpha);
    rgb[target + 2] = Math.round((pixels[source + 2] ?? 0) * alpha);
  }
  return {width, height, rgb};
};

const comparePngs = async (actualPath: string, expectedPath: string) => {
  const [actual, expected] = await Promise.all([decodePng(actualPath), decodePng(expectedPath)]);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {sameSize: false, meanAbsoluteError: Number.POSITIVE_INFINITY, changedPixelRatio: 1};
  }
  let absoluteDifference = 0;
  let changedPixels = 0;
  for (let pixel = 0; pixel < actual.width * actual.height; pixel += 1) {
    let largestChannelDifference = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const index = pixel * 3 + channel;
      const difference = Math.abs((actual.rgb[index] ?? 0) - (expected.rgb[index] ?? 0));
      absoluteDifference += difference;
      largestChannelDifference = Math.max(largestChannelDifference, difference);
    }
    if (largestChannelDifference > 24) changedPixels += 1;
  }
  return {
    sameSize: true,
    meanAbsoluteError: absoluteDifference / actual.rgb.length,
    changedPixelRatio: changedPixels / (actual.width * actual.height),
  };
};

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
      await readFile(path.resolve(process.cwd(), '..', 'examples', 'all-templates.video-project.json')),
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
