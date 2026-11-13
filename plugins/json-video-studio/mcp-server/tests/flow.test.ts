import {describe, expect, it} from 'vitest';
import {flowProgress} from '../src/render/flow.js';

describe('flow transport timing', () => {
  it.each([24, 30, 60])('arrives after one second at %i fps and never overshoots', (fps) => {
    expect(flowProgress(-1, fps)).toEqual({progress: 0, arrival: 0});
    expect(flowProgress(fps / 2, fps).progress).toBe(0.5);
    expect(flowProgress(fps, fps)).toEqual({progress: 1, arrival: 0});
    expect(flowProgress(fps * 2, fps)).toEqual({progress: 1, arrival: 1});
  });

  it('shows the completed arrival in a frame-zero storyboard', () => {
    expect(flowProgress(0, 30, true)).toEqual({progress: 1, arrival: 1});
  });
});
