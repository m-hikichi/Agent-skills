import {describe, expect, it} from 'vitest';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertPassingNarrationReview} from '../src/render/api.js';
import {hasPassingNarrationReview} from '../src/shared/narration-review.js';
import type {ProjectLock} from '../src/shared/video-types.js';

const lock = {
  lockHash: 'a'.repeat(64),
  assets: [{id: 'voice:intro', sha256: 'b'.repeat(64), voice: {synthesisText: 'ジェーソンから動画へ。', kana: "ジェーソンカラド'ーガエ。"}}],
} as ProjectLock;
const review = () => ({
  projectId: 'demo', lockHash: lock.lockHash, status: 'pass', method: 'engine-kana', listeningPerformed: false,
  unresolvedReadings: [] as string[],
  evidence: [{assetId: 'voice:intro', sha256: lock.assets[0]!.sha256, synthesisText: lock.assets[0]!.voice!.synthesisText, kana: lock.assets[0]!.voice!.kana, readingsConfirmed: true, coverage: 'full-utterance'}],
});

describe('pronunciation review evidence', () => {
  it('requires current matching evidence at the render file boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'json-video-narration-review-'));
    try {
      await expect(assertPassingNarrationReview(root, 'demo', lock)).rejects.toMatchObject({code: 'NARRATION_REVIEW_REQUIRED'});
      const directory = join(root, '.json-video-work', 'demo');
      await mkdir(directory, {recursive: true});
      const filename = join(directory, 'narration-review.json');
      await writeFile(filename, JSON.stringify({...review(), lockHash: 'c'.repeat(64)}));
      await expect(assertPassingNarrationReview(root, 'demo', lock)).rejects.toMatchObject({code: 'NARRATION_REVIEW_NOT_PASSED'});
      await writeFile(filename, JSON.stringify(review()));
      await expect(assertPassingNarrationReview(root, 'demo', lock)).resolves.toBeUndefined();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
  it('accepts a kana review without claiming a listening test', () => {
    expect(hasPassingNarrationReview(review(), 'demo', lock)).toBe(true);
    expect(hasPassingNarrationReview({...review(), listeningPerformed: true}, 'demo', lock)).toBe(false);
  });
  it('rejects stale locks, omitted voices, and changed synthesis evidence', () => {
    expect(hasPassingNarrationReview({...review(), lockHash: 'c'.repeat(64)}, 'demo', lock)).toBe(false);
    expect(hasPassingNarrationReview({...review(), evidence: []}, 'demo', lock)).toBe(false);
    for (const field of ['sha256', 'synthesisText', 'kana'] as const) {
      const changed = review();
      changed.evidence[0]![field] = 'different';
      expect(hasPassingNarrationReview(changed, 'demo', lock)).toBe(false);
    }
    expect(hasPassingNarrationReview({...review(), evidence: [...review().evidence, ...review().evidence]}, 'demo', lock)).toBe(false);
  });
  it('rejects old audio metadata without kana and rejects unconfirmed readings', () => {
    expect(hasPassingNarrationReview({...review(), unresolvedReadings: ['地名の読みが不明']}, 'demo', lock)).toBe(false);
    const partial = review();
    partial.evidence[0]!.coverage = 'dictionary-terms-only';
    expect(hasPassingNarrationReview(partial, 'demo', lock)).toBe(false);
    const old = structuredClone(lock);
    delete old.assets[0]!.voice!.kana;
    expect(hasPassingNarrationReview(review(), 'demo', old)).toBe(false);
    const unconfirmed = review();
    unconfirmed.evidence[0]!.readingsConfirmed = false;
    expect(hasPassingNarrationReview(unconfirmed, 'demo', lock)).toBe(false);
  });
});
