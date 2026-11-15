import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {SceneVisual, VideoProject} from '../src/shared/video-types.js';
import {clearSchemaCacheForTests, validateProject} from '../src/core/schema.js';
import {navigationState, sceneContinuity, sceneOpacity, scenePageNumbers, shortPageWarnings, visualLayoutKey} from '../src/render/layout.js';
import {markRuns} from '../src/render/deck.js';
import {emphasisRuns} from '../src/render/templates.js';

const schemaPath = resolve(import.meta.dirname, '../../schemas/video-project.schema.json');
const examplePath = resolve(import.meta.dirname, '../../examples/minimal.video-project.json');

const minimal = async (): Promise<VideoProject> => JSON.parse(await readFile(examplePath, 'utf8')) as VideoProject;

const withVisual = async (visual: SceneVisual): Promise<VideoProject> => {
  const project = await minimal();
  project.sections[0]!.scenes[0]!.visual = visual;
  return project;
};

const table = (overrides: Partial<Extract<SceneVisual, {type: 'table'}>> = {}): SceneVisual => ({
  type: 'table',
  title: '別表',
  columns: ['A', 'B'],
  rows: [{label: '行1', cells: ['1', '2']}, {label: '行2', cells: ['3', '4']}],
  ...overrides,
});

afterEach(() => clearSchemaCacheForTests());

describe('scene continuity', () => {
  it('treats visuals that differ only by emphasis as the same layout', () => {
    const plain: SceneVisual = {type: 'bullets', title: 'T', items: ['a', 'b']};
    const highlighted: SceneVisual = {type: 'bullets', title: 'T', items: ['a', 'b'], highlight: [1]};
    expect(visualLayoutKey(plain)).toBe(visualLayoutKey(highlighted));
    expect(visualLayoutKey(table({highlightRows: [0]}))).toBe(visualLayoutKey(table({highlightColumns: [1]})));
    expect(visualLayoutKey({type: 'bullets', items: ['a']})).not.toBe(visualLayoutKey({type: 'bullets', items: ['b']}));
  });

  it('never chains flow scenes, which keep their own step motion', () => {
    const flow: SceneVisual = {type: 'flow', steps: [{title: 'a'}, {title: 'b'}], activeStep: 0};
    expect(sceneContinuity([{visual: flow}, {visual: flow}])).toEqual([
      {fromPrevious: false, toNext: false},
      {fromPrevious: false, toNext: false},
    ]);
  });

  it('marks shared edges and keeps them opaque', () => {
    const a: SceneVisual = {type: 'bullets', items: ['x'], highlight: [0]};
    const b: SceneVisual = {type: 'bullets', items: ['x']};
    const c: SceneVisual = {type: 'outro', title: 'end'};
    const continuity = sceneContinuity([{visual: a}, {visual: b}, {visual: c}]);
    expect(continuity).toEqual([
      {fromPrevious: false, toNext: true},
      {fromPrevious: true, toNext: false},
      {fromPrevious: false, toNext: false},
    ]);
    expect(sceneOpacity(0, 60, continuity[1])).toBe(1);
    expect(sceneOpacity(59, 60, continuity[0])).toBe(1);
    expect(sceneOpacity(59, 60, continuity[1])).toBeLessThan(1);
    expect(sceneOpacity(0, 60, continuity[2])).toBe(0);
  });
});

describe('navigation state', () => {
  it('marks done, current and upcoming groups from section order', async () => {
    const project = await minimal();
    const scene = project.sections[0]!.scenes[0]!;
    project.sections = ['s1', 's2', 's3', 's4'].map((id) => ({id, title: id, scenes: [{...scene, id: `${id}-scene`}]}));
    project.navigation = {groups: [{title: '前半', sectionIds: ['s1', 's2']}, {title: '中盤', sectionIds: ['s3']}, {title: '後半', sectionIds: ['s4']}]};
    expect(navigationState(project, 's3', 50, 100)).toEqual({
      groups: [{title: '前半', status: 'done'}, {title: '中盤', status: 'current'}, {title: '後半', status: 'upcoming'}],
      progress: 0.5,
    });
    expect(navigationState({...project, navigation: undefined} as VideoProject, 's3', 0, 100)).toBeUndefined();
  });

  it('rejects unknown or repeated navigation sections', async () => {
    const project = await minimal();
    const sectionId = project.sections[0]!.id;
    project.navigation = {groups: [{title: 'A', sectionIds: [sectionId]}, {title: 'B', sectionIds: ['missing-section']}]};
    await expect(validateProject(project, {schemaPath})).rejects.toMatchObject({code: 'UNKNOWN_SECTION'});
    project.navigation = {groups: [{title: 'A', sectionIds: [sectionId]}, {title: 'B', sectionIds: [sectionId]}]};
    await expect(validateProject(project, {schemaPath})).rejects.toMatchObject({code: 'DUPLICATE_NAVIGATION_SECTION'});
  });
});

describe('table, statement and highlight contracts', () => {
  it('accepts a well-formed table and statement', async () => {
    await expect(validateProject(await withVisual(table({highlightRows: [1], highlightColumns: [0], note: '注記'})), {schemaPath})).resolves.toBeTruthy();
    await expect(validateProject(await withVisual({type: 'statement', label: '第1条', text: '旅費を支給する。', emphasis: ['旅費']}), {schemaPath})).resolves.toBeTruthy();
  });

  it('rejects ragged rows, out-of-range highlights and missing emphasis', async () => {
    await expect(validateProject(await withVisual(table({rows: [{label: '行1', cells: ['1']}]})), {schemaPath})).rejects.toMatchObject({code: 'TABLE_SHAPE_MISMATCH'});
    await expect(validateProject(await withVisual(table({highlightRows: [2]})), {schemaPath})).rejects.toMatchObject({code: 'HIGHLIGHT_OUT_OF_RANGE'});
    await expect(validateProject(await withVisual(table({highlightColumns: [2]})), {schemaPath})).rejects.toMatchObject({code: 'HIGHLIGHT_OUT_OF_RANGE'});
    await expect(validateProject(await withVisual({type: 'bullets', items: ['a'], highlight: [1]}), {schemaPath})).rejects.toMatchObject({code: 'HIGHLIGHT_OUT_OF_RANGE'});
    await expect(validateProject(await withVisual({type: 'statement', text: '本文', emphasis: ['別の語']}), {schemaPath})).rejects.toMatchObject({code: 'EMPHASIS_NOT_FOUND'});
  });

  it('splits statement text into emphasized runs without losing characters', () => {
    const text = '片道50km以遠なら新幹線を利用できる';
    const runs = emphasisRuns(text, ['50km以遠', '新幹線']);
    expect(runs.map((run) => run.text).join('')).toBe(text);
    expect(runs.filter((run) => run.emphasized).map((run) => run.text)).toEqual(['50km以遠', '新幹線']);
    expect(emphasisRuns(text)).toEqual([{text, emphasized: false}]);
  });
});

describe('deck slide pages', () => {
  const slide = (overrides: Record<string, unknown> = {}): SceneVisual => ({
    type: 'slide', tag: '第1章', title: 'ページ',
    blocks: [
      {kind: 'text', label: '第2条', text: 'あらかじめ上長の許可を得る。', emphasis: ['上長の許可']},
      {kind: 'table', columns: ['A', 'B'], rows: [{label: '行', cells: ['1', '2']}], highlightRows: [0]},
    ],
    ...overrides,
  } as SceneVisual);

  it('numbers pages by layout changes, ignoring emphasis moves', () => {
    const a = slide();
    const b = slide({blocks: [{kind: 'text', label: '第2条', text: 'あらかじめ上長の許可を得る。'}, {kind: 'table', columns: ['A', 'B'], rows: [{label: '行', cells: ['1', '2']}], highlightColumns: [1]}]});
    const c = slide({title: '次のページ'});
    expect(scenePageNumbers([{visual: a}, {visual: b}, {visual: c}, {visual: c}])).toEqual([1, 1, 2, 2]);
  });

  it('validates slide block shapes, highlights and emphasis', async () => {
    await expect(validateProject(await withVisual(slide()), {schemaPath})).resolves.toBeTruthy();
    await expect(validateProject(await withVisual(slide({blocks: [{kind: 'table', columns: ['A'], rows: [{label: 'x', cells: ['1', '2']}]}]})), {schemaPath})).rejects.toMatchObject({code: 'TABLE_SHAPE_MISMATCH'});
    await expect(validateProject(await withVisual(slide({blocks: [{kind: 'list', items: ['a'], highlight: [1]}]})), {schemaPath})).rejects.toMatchObject({code: 'HIGHLIGHT_OUT_OF_RANGE'});
    await expect(validateProject(await withVisual(slide({blocks: [{kind: 'callout', text: '本文', emphasis: ['なし']}]})), {schemaPath})).rejects.toMatchObject({code: 'EMPHASIS_NOT_FOUND'});
  });

  it('rejects a frame logo that is not a declared image asset', async () => {
    const project = await withVisual(slide());
    project.theme.frame = {style: 'deck', footerLogoAssetId: 'missing-logo'};
    await expect(validateProject(project, {schemaPath})).rejects.toMatchObject({code: 'UNKNOWN_ASSET'});
  });

  it('marks every emphasized run and keeps the text intact', () => {
    const text = '領収書を添付し、承認された場合に限り実費を支給する。';
    const runs = markRuns(text, ['承認された場合に限り', '実費']);
    expect(runs.map((run) => run.text).join('')).toBe(text);
    expect(runs.filter((run) => run.marked).map((run) => run.text)).toEqual(['承認された場合に限り', '実費']);
  });
});

describe('short page warning', () => {
  it('warns about a page shown briefly and stays quiet for a long, emphasis-driven page', async () => {
    const project = await minimal();
    const base = project.sections[0]!.scenes[0]!;
    const page: SceneVisual = {type: 'bullets', title: 'まとめ', items: ['a', 'b']};
    const narration = (id: string, visual: SceneVisual) => ({...base, id, durationMs: 6_000, visual});
    project.sections[0]!.scenes = [
      narration('short-page', {type: 'bullets', items: ['単独のページ']}),
      narration('long-1', {...page, highlight: [0]}),
      narration('long-2', {...page, highlight: [1]}),
      narration('long-3', page),
    ];
    // The guideline belongs to deck (document-style) videos only.
    expect(shortPageWarnings(project)).toEqual([]);
    project.theme.frame = {style: 'deck'};
    const warnings = shortPageWarnings(project);
    expect(warnings.map((warning) => warning.sceneId)).toEqual(['short-page']);
  });
});
