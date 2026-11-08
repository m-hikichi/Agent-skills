import {describe, expect, it} from 'vitest';
import type {VideoProject} from '../src/shared/video-types.js';
import {
  buildPreviewScenes,
  collectLayoutWarnings,
  createSubtitleLayoutStyles,
  effectiveDurationInFrames,
  estimateTextLines,
  metricPolylinePoints,
  sceneOpacity,
  storyboardCellLayout,
} from '../src/render/layout.js';

const project = (): VideoProject => ({
  schemaVersion: '1.0.0',
  meta: {id: 'layout-test', title: 'Layout test', language: 'ja-JP'},
  canvas: {preset: 'youtube-1080p', fps: 30},
  theme: {
    backgroundColor: '#000000', foregroundColor: '#ffffff', accentColor: '#00ffff', fontFamily: 'Noto Sans CJK JP',
    subtitleStyle: {fontSize: 48, maxLines: 2},
  },
  assets: [], speakers: [],
  sections: [{
    id: 'section-a', title: 'Section A', scenes: [
      {id: 'one', text: '最初のシーン', durationMs: 1_000, holdAfterMs: 500, visual: {type: 'title', title: 'Title'}},
      {id: 'two', text: 'Second scene', durationMs: 2_000, visual: {type: 'outro', title: 'Done'}},
    ],
  }],
  thumbnail: {textLines: ['Test']},
  outputs: {video: true, captions: true, chapters: true, thumbnail: true, storyboard: true},
  policies: {allowUnknownRights: false, maxDurationMinutes: 30},
});

describe('render timeline layout', () => {
  it.each([1, 2, 3, 8, 9, 16, 17, 100])('keeps %i-frame scenes visible with bounded fades', (duration) => {
    const opacity = Array.from({length: duration}, (_, frame) => sceneOpacity(frame, duration));
    expect(opacity.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(Math.max(...opacity)).toBe(1);
    if (duration >= 17) {
      expect(opacity[0]).toBe(0);
      expect(opacity[8]).toBe(1);
      expect(opacity[duration - 1]).toBe(0.125);
    }
  });

  it('fits the entire storyboard image and subtitle area below its label', () => {
    const cell = storyboardCellLayout(1920, 1080);
    expect(cell.left).toBeGreaterThanOrEqual(0);
    // Floating-point scaling can place the edge a fraction of a pixel below zero.
    const epsilon = 1e-9;
    expect(cell.top + epsilon).toBeGreaterThanOrEqual(cell.labelHeight);
    expect(cell.left + 1920 * cell.scale).toBeLessThanOrEqual(cell.cellWidth);
    expect(cell.top + 1080 * cell.scale).toBeLessThanOrEqual(cell.cellHeight + epsilon);
    expect(cell.cellHeight * 4 + 54 + 56).toBe(1080);
  });

  it('builds cumulative frames including holdAfterMs', () => {
    const scenes = buildPreviewScenes(project());
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({startFrame: 0, durationInFrames: 45, subtitleText: '最初のシーン'});
    expect(scenes[1]).toMatchObject({startFrame: 45, durationInFrames: 60});
    expect(effectiveDurationInFrames(project())).toBe(105);
  });

  it('counts Japanese wide characters more conservatively than ASCII', () => {
    expect(estimateTextLines('あ'.repeat(20), 400, 40)).toBeGreaterThan(estimateTextLines('a'.repeat(20), 400, 40));
  });

  it('reports oversized subtitles, bullet lists and code blocks', () => {
    const value = project();
    value.sections[0]!.scenes = [
      {id: 'subtitle', subtitle: '長い字幕'.repeat(100), durationMs: 1000, visual: {type: 'bullets', items: Array.from({length: 8}, (_, index) => String(index))}},
      {id: 'code', durationMs: 1000, visual: {type: 'code', variant: 'source', code: Array.from({length: 25}, () => 'line').join('\n')}},
    ];
    expect(collectLayoutWarnings(value).map((warning) => warning.field)).toEqual(expect.arrayContaining(['subtitle', 'visual.items', 'visual.code']));
  });

  it.each([1, 2] as const)('clips subtitles to the configured %i-line box', (maxLines) => {
    const styles = createSubtitleLayoutStyles(48, maxLines);

    expect(styles.box).toMatchObject({
      minHeight: styles.minBoxHeightPx,
      maxHeight: styles.maxBoxHeightPx,
      boxSizing: 'border-box',
      overflow: 'hidden',
      contain: 'paint',
    });
    expect(styles.text).toMatchObject({
      width: '100%',
      maxWidth: '100%',
      maxHeight: styles.textHeightPx,
      display: '-webkit-box',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: maxLines,
      overflow: 'hidden',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
      whiteSpace: 'pre-wrap',
      textOverflow: 'clip',
    });
    expect(styles.minBoxHeightPx).toBe(128);
    expect(styles.textHeightPx + 36).toBeLessThanOrEqual(styles.maxBoxHeightPx);
  });

  it('normalizes metric line coordinates into the requested viewport', () => {
    expect(metricPolylinePoints([10, 20, 15], 100, 50)).toBe('0.0,50.0 50.0,0.0 100.0,25.0');
    expect(metricPolylinePoints([], 100, 50)).toBe('');
  });
});
