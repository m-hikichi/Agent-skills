import {describe, expect, it} from 'vitest';
import type {ProjectLock, SceneVisual} from '../src/shared/video-types.js';
import {BOUNDARY_OFFSETS, planReviewFrames, sceneSampleFrames} from '../src/core/review-frames.js';

const scene = (id: string, startFrame: number, durationInFrames: number, visual: SceneVisual) =>
  ({id, startFrame, durationInFrames, visual}) as unknown as ProjectLock['scenes'][number];

describe('final review frame plan', () => {
  it('samples entry, middle and end inside each scene, clamped to short scenes', () => {
    expect(sceneSampleFrames(100, 60)).toEqual([102, 130, 157]);
    expect(sceneSampleFrames(10, 2)).toEqual([11, 11, 10]);
  });

  it('adds boundary strips only where the same layout continues', () => {
    const page: SceneVisual = {type: 'bullets', items: ['a', 'b'], highlight: [0]};
    const samePage: SceneVisual = {type: 'bullets', items: ['a', 'b'], highlight: [1]};
    const other: SceneVisual = {type: 'outro', title: 'end'};
    const plan = planReviewFrames({
      totalFrames: 300,
      scenes: [scene('one', 0, 100, page), scene('two', 100, 100, samePage), scene('three', 200, 100, other)],
    });
    expect(plan.scenes.map((item) => item.sceneId)).toEqual(['one', 'two', 'three']);
    expect(plan.boundaries).toHaveLength(1);
    expect(plan.boundaries[0]).toMatchObject({beforeSceneId: 'one', afterSceneId: 'two', boundaryFrame: 100});
    expect(plan.boundaries[0]!.frames).toEqual(BOUNDARY_OFFSETS.map((offset) => 100 + offset));
    expect(plan.uniqueFrames).toEqual([...plan.uniqueFrames].sort((a, b) => a - b));
    expect(new Set(plan.uniqueFrames).size).toBe(plan.uniqueFrames.length);
  });
});
