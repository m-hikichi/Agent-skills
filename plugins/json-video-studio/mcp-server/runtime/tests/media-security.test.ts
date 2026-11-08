import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {assertExpectedMedia, sniffMediaMime, type MediaInspection} from '../src/core/media.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

const inspection = (path: string, mime: string, codec: string): MediaInspection => ({
  path,
  mime,
  sizeBytes: 16,
  codecs: [codec],
  streamTypes: ['video'],
  width: 1,
  height: 1,
});

describe('media signature and declared MIME agreement', () => {
  it('detects image bytes independently of a misleading extension', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'json-video-mime-'));
    roots.push(root);
    const renamed = resolve(root, 'renamed.png');
    await writeFile(renamed, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

    const detected = await sniffMediaMime(renamed);
    expect(detected).toBe('image/jpeg');
    expect(() => assertExpectedMedia('image', inspection(renamed, detected!, 'mjpeg'), renamed))
      .toThrowError(expect.objectContaining({code: 'ASSET_MIME_MISMATCH'}));
  });

  it('accepts matching PNG magic, extension, stream, and codec', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'json-video-mime-'));
    roots.push(root);
    const png = resolve(root, 'pixel.png');
    await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]));

    const detected = await sniffMediaMime(png);
    expect(detected).toBe('image/png');
    expect(() => assertExpectedMedia('image', inspection(png, detected!, 'png'), png)).not.toThrow();
  });
});
