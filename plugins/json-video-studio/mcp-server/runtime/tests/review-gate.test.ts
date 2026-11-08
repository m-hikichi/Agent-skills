import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {assertPassingReview} from '../src/render/api.js';
import {passingReviewGates} from '../src/shared/review.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('render review gate', () => {
  it('requires a pass for the exact current project and lock', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'json-video-review-gate-'));
    roots.push(root);
    const projectId = 'reviewed-video';
    const lockHash = 'a'.repeat(64);
    const reviewDirectory = path.join(root, '.json-video-work', projectId);
    await mkdir(reviewDirectory, {recursive: true});

    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_REQUIRED'});
    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash,
      iteration: 1,
      status: 'fail',
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_NOT_PASSED'});

    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash: 'b'.repeat(64),
      iteration: 1,
      status: 'pass',
      gates: passingReviewGates(),
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_LOCK_MISMATCH'});

    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash,
      iteration: 4,
      status: 'pass',
      gates: passingReviewGates(),
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_INVALID'});

    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash,
      iteration: 2,
      status: 'pass',
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_GATES_NOT_PASSED'});

    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash,
      iteration: 2,
      status: 'pass',
      gates: {...passingReviewGates(), thumbnailReadable: false},
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_GATES_NOT_PASSED'});

    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash,
      iteration: 2,
      status: 'pass',
      gates: {...passingReviewGates(), misspelledGate: true},
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_GATES_NOT_PASSED'});

    await writeFile(path.join(reviewDirectory, 'review.json'), 'null');
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_INVALID'});

    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash,
      iteration: 2,
      status: 'pass',
      gates: passingReviewGates(),
      issues: [{severity: 'error', problem: 'clipped title'}],
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_ISSUES_PRESENT'});

    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash,
      iteration: 2,
      status: 'pass',
      gates: passingReviewGates(),
      issues: [{severity: 'warning', problem: 'minor spacing difference'}],
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).rejects.toMatchObject({code: 'REVIEW_ISSUES_PRESENT'});

    await writeFile(path.join(reviewDirectory, 'review.json'), JSON.stringify({
      projectId,
      lockHash,
      iteration: 2,
      status: 'pass',
      gates: passingReviewGates(),
      issues: [{severity: 'warning', problem: 'minor spacing difference', fix: 'Increase the title gap by 4px.'}],
    }));
    await expect(assertPassingReview(root, projectId, lockHash)).resolves.toBeUndefined();
  });
});
