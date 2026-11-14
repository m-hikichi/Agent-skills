import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {ProjectLock, SceneVisual, Speaker, VideoProject} from '../src/shared/video-types.js';
import {digestFile} from '../src/core/fs-safe.js';
import {bigramContainment, lintBrief, lintProject, MIN_SUBTITLE_FONT_SIZE} from '../src/core/lint.js';
import {resolveProject, type VoiceProvider} from '../src/core/resolver.js';
import {CUE_OFFSETS, MOTION_OFFSETS, TRANSITION_OFFSETS, planReviewFrames} from '../src/core/review-frames.js';
import {clearSchemaCacheForTests, validateProject} from '../src/core/schema.js';
import {speechMilliseconds} from '../src/core/voicevox.js';
import {DIMMED_OPACITY, stepColumns} from '../src/render/deck.js';
import {diagramLayout, linkGeometry, linkLanes, packetPosition, STAGE, timelineTicks} from '../src/render/diagrams.js';
import {CODE_PANEL, DECK_FRAME, PAGE_FADE_IN_FRAMES, codeFontSize, deckGeometry, pageOpacity, splitSubtitle, subtitleAtFrame, timeSubtitleCues, visualLayoutKey} from '../src/render/layout.js';
import {BLANK_BOTTOM_WARNING_RATIO, blankLayoutWarnings, lastInkRow} from '../src/render/layout-metrics.js';
import {hasCompletePassingReviewGatesV2, isPassingReviewForLock, passingReviewGates, passingReviewGatesV2} from '../src/shared/review.js';

const schemaPath = resolve(import.meta.dirname, '../../schemas/video-project.schema.json');
const example = async (name: string): Promise<VideoProject> => JSON.parse(await readFile(resolve(import.meta.dirname, '../../examples', name), 'utf8')) as VideoProject;
const roots: string[] = [];

afterEach(async () => {
  clearSchemaCacheForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe('subtitle cues', () => {
  it('keeps a subtitle whole when it fits one line or has no sentence boundary', () => {
    expect(splitSubtitle('短い字幕です。', 30)).toEqual(['短い字幕です。']);
    expect(splitSubtitle('あ'.repeat(40), 30)).toEqual(['あ'.repeat(40)]);
  });

  it('splits at sentence ends and merges neighbours that fit one line together', () => {
    expect(splitSubtitle('最初の文はここまでです。次の文はここから始まります。最後。', 18)).toEqual(['最初の文はここまでです。', '次の文はここから始まります。最後。']);
  });

  it('cuts a sentence longer than the line limit at the comma nearest its middle', () => {
    const cues = splitSubtitle('とても長い前半の説明が続いていて、後半にもまだ長い説明が続いている文です。', 12, 2);
    expect(cues).toEqual(['とても長い前半の説明が続いていて、', '後半にもまだ長い説明が続いている文です。']);
  });

  it('times cues in proportion to their weights and ends the last cue with the speech', () => {
    expect(timeSubtitleCues(['a', 'b'], [1000, 3000], 120)).toEqual([
      {text: 'a', startFrame: 0, endFrame: 30},
      {text: 'b', startFrame: 30, endFrame: 120},
    ]);
    expect(timeSubtitleCues(['one'], [1], 120)).toBeUndefined();
    expect(timeSubtitleCues(['a', 'b'], [1, 1], 6)).toBeUndefined();
  });

  it('shows the cue of the current frame, keeps the last one, and previews the longest', () => {
    const scene = {subtitleText: '短い。とても長い二つ目の文。', subtitleCues: [{text: '短い。', startFrame: 0, endFrame: 20}, {text: 'とても長い二つ目の文。', startFrame: 20, endFrame: 60}]};
    expect(subtitleAtFrame(scene, 0)).toBe('短い。');
    expect(subtitleAtFrame(scene, 20)).toBe('とても長い二つ目の文。');
    expect(subtitleAtFrame(scene, 500)).toBe('とても長い二つ目の文。');
    expect(subtitleAtFrame(scene, 0, true)).toBe('とても長い二つ目の文。');
    expect(subtitleAtFrame({subtitleText: '全文'}, 10)).toBe('全文');
  });

  it('sums mora and pause lengths of an audio query at the given speed', () => {
    const query = {accent_phrases: [
      {moras: [{consonant_length: 0.05, vowel_length: 0.1}, {vowel_length: 0.1}], pause_mora: {vowel_length: 0.25}},
      {moras: [{consonant_length: 0.1, vowel_length: 0.1}]},
    ]};
    expect(speechMilliseconds(query, 1)).toBeCloseTo(700);
    expect(speechMilliseconds(query, 2)).toBeCloseTo(350);
    expect(speechMilliseconds(null, 1)).toBe(0);
  });

  it('writes measured cues to the lock and one SRT entry per cue', async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), 'json-video-cues-'));
    roots.push(workspace);
    const project = await example('animated-flow.video-project.json');
    const scene = project.sections[0]!.scenes[1]!;
    delete scene.subtitle;
    project.sections[0]!.scenes = [scene];
    project.theme.subtitleStyle = {...project.theme.subtitleStyle, fontSize: 60};
    const source = resolve(workspace, 'mock.wav');
    await writeFile(source, Buffer.from('RIFF-mocked-voice-data'));
    const sha256 = await digestFile(source);
    const measured: string[] = [];
    const provider: VoiceProvider = {
      version: async () => 'test-engine',
      plan: async () => ({engineVersion: 'test-engine', cacheKey: 'd'.repeat(64), cacheHit: true, durationMs: 6000, speakerName: '四国めたん', styleName: 'ノーマル'}),
      measure: async (text: string) => { measured.push(text); return text.length * 100; },
      synthesize: async (text: string, _speaker: Speaker) => ({
        path: source, relativePath: 'mock.wav', sha256, sizeBytes: 22, durationMs: 6000, engineVersion: 'test-engine', cacheKey: 'd'.repeat(64), cacheHit: true,
        speakerName: '四国めたん', styleName: 'ノーマル', synthesisText: text, kana: 'カナ',
      }),
    };
    await writeFile(resolve(workspace, 'video-project.json'), JSON.stringify(project));
    const runtime = {node: 'v', remotion: 'r', ffmpeg: 'f', chrome: 'c', font: 'Noto Sans CJK JP'};
    const result = await resolveProject({projectPath: 'video-project.json', workspaceRoot: workspace, schemaPath, runtimeVersions: runtime, voiceProvider: provider, cacheRoot: resolve(workspace, 'cache')});
    if (result.dryRun) throw new Error('unexpected dry run');
    const cues = result.lock.scenes[0]!.subtitleCues!;
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues.map((cue) => cue.text).join('')).toBe(scene.text);
    expect(cues[0]!.startFrame).toBe(0);
    expect(cues.at(-1)!.endFrame).toBe(180);
    cues.slice(1).forEach((cue, index) => expect(cue.startFrame).toBe(cues[index]!.endFrame));
    // The dictionary reading is what gets measured, not the displayed spelling.
    expect(measured.some((text) => text.includes('ジェーソン'))).toBe(true);
    expect(measured.every((text) => !text.includes('JSON'))).toBe(true);
    const srt = await readFile(result.captionsPath, 'utf8');
    expect(srt.match(/-->/gu)).toHaveLength(cues.length);

    project.theme.subtitleStyle = {...project.theme.subtitleStyle, split: 'none'};
    await writeFile(resolve(workspace, 'video-project.json'), JSON.stringify(project));
    const whole = await resolveProject({projectPath: 'video-project.json', workspaceRoot: workspace, schemaPath, runtimeVersions: runtime, voiceProvider: provider, cacheRoot: resolve(workspace, 'cache')});
    if (whole.dryRun) throw new Error('unexpected dry run');
    expect(whole.lock.scenes[0]!.subtitleCues).toBeUndefined();
  });
});

describe('page transitions and deck geometry', () => {
  it('keeps the outgoing page opaque and makes the incoming page readable within the fade-in', () => {
    const none = {fromPrevious: false, toNext: false};
    expect(pageOpacity(59, 60, none)).toBe(1);
    expect(pageOpacity(PAGE_FADE_IN_FRAMES - 1, 60, none)).toBe(1);
    expect(pageOpacity(0, 60, none)).toBeGreaterThan(0);
    expect(pageOpacity(0, 60, {fromPrevious: true, toNext: false})).toBe(1);
    expect(pageOpacity(59, 60, none, true)).toBeLessThan(1);
  });

  it('keeps the legacy geometry by default and gives the freed footer to the card', () => {
    const project = (footer?: 'full' | 'progress' | 'none', fontSize = 34, maxLines: 1 | 2 = 2) => ({theme: {subtitleStyle: {fontSize, maxLines}, frame: {style: 'deck' as const, ...(footer ? {footer} : {})}}}) as unknown as VideoProject;
    expect(deckGeometry(project())).toMatchObject({subtitleTop: DECK_FRAME.subtitleTop, card: DECK_FRAME.card});
    const large = deckGeometry(project('full', 48, 2));
    expect(large.subtitleTop + large.subtitleHeight).toBeLessThanOrEqual(DECK_FRAME.footerTop);
    const progress = deckGeometry(project('progress', 44, 1));
    expect(progress.card.bottom).toBeLessThan(DECK_FRAME.card.bottom);
    expect(progress.subtitleTop + progress.subtitleHeight).toBeLessThanOrEqual(1080 - DECK_FRAME.progressHeight);
    expect(1080 - progress.card.bottom).toBeLessThan(progress.subtitleTop);
  });

  it('draws short code large and shrinks long code to fit the panel', () => {
    expect(codeFontSize('$ git log --oneline -1')).toBe(CODE_PANEL.maxFont);
    const command = '$ git commit --amend -m "fix: ログイン画面のバグ修正"';
    expect(codeFontSize(command)).toBeGreaterThanOrEqual(40);
    expect(codeFontSize('x'.repeat(200))).toBe(CODE_PANEL.minFont);
    expect(codeFontSize(Array.from({length: 20}, () => 'a').join('\n'))).toBeLessThan(CODE_PANEL.maxFont);
  });

  it('does not fade unselected items below a readable level', () => {
    expect(DIMMED_OPACITY).toBeGreaterThanOrEqual(0.7);
    expect(stepColumns(4)).toBe(4);
    expect(stepColumns(5)).toBe(3);
    expect(stepColumns(6)).toBe(3);
  });
});

describe('diagram visuals', () => {
  it('keeps the page when only the active state, highlight or cursor changes', async () => {
    const project = await example('diagrams.video-project.json');
    const [request, response] = project.sections[0]!.scenes;
    expect(visualLayoutKey(request!.visual)).toBe(visualLayoutKey(response!.visual));
    const timeline = project.sections[0]!.scenes[3]!.visual as Extract<SceneVisual, {type: 'timeline'}>;
    expect(visualLayoutKey(timeline)).toBe(visualLayoutKey({...timeline, cursor: 3, highlight: []}));
    const code: SceneVisual = {type: 'code', variant: 'source', code: 'a\nb', highlightLines: [1]};
    expect(visualLayoutKey(code)).toBe(visualLayoutKey({...code, highlightLines: [2]}));
  });

  it('lays nodes out inside the stage and stacks links between the same pair', () => {
    for (const count of [2, 3, 4, 5]) {
      const layout = diagramLayout(count);
      expect(layout.x(0)).toBeGreaterThanOrEqual(0);
      expect(layout.x(count - 1) + layout.nodeWidth).toBeLessThanOrEqual(STAGE.width);
      expect(layout.gap).toBeGreaterThanOrEqual(100);
    }
    const lanes = linkLanes([{from: 'a', to: 'b'}, {from: 'b', to: 'a'}, {from: 'b', to: 'c'}]);
    expect(lanes).toEqual([{lane: 0, lanes: 2}, {lane: 1, lanes: 2}, {lane: 0, lanes: 1}]);
    const forward = linkGeometry(0, 1, 3, 0, 2);
    const back = linkGeometry(1, 0, 3, 1, 2);
    expect(forward.point(0).x).toBeLessThan(forward.point(1).x);
    expect(back.point(0).x).toBeGreaterThan(back.point(1).x);
    expect(forward.point(0).y).not.toBe(back.point(0).y);
    // A packet on a straight link rests inside the gap, clear of both nodes.
    const rest = packetPosition(forward, 1, 120, true);
    expect(rest.x + 60).toBeLessThanOrEqual(forward.point(1).x);
    expect(packetPosition(forward, 0, 120, true).x - 60).toBeGreaterThanOrEqual(forward.point(0).x);
    expect(packetPosition(back, 1, 120, true).x - 60).toBeGreaterThanOrEqual(back.point(1).x);
    const arc = linkGeometry(0, 2, 3, 0, 1);
    expect(arc.point(0.5).y).toBeLessThan(arc.point(0).y);
    // The arc peaks clear above a group frame (top edge 72px) and its label sits above the arc.
    expect(arc.point(0.5).y).toBeLessThan(72 - 20);
    expect(arc.label.y + 40).toBeLessThan(arc.point(0.5).y);
    // In a narrow gap (4 nodes) a short label stays beside its arrow; a long one moves below the nodes.
    const short = linkGeometry(0, 1, 4, 0, 1, 60);
    const long = linkGeometry(0, 1, 4, 0, 1, 400);
    expect(short.label.y).toBeLessThan(short.point(0).y);
    expect(long.label.y).toBeGreaterThan(long.point(0).y + 100);
    expect(timelineTicks({end: 10, tracks: [{label: 't', segments: [{id: 'a', label: 'a', start: 0, end: 4}, {id: 'b', label: 'b', start: 4, end: 10}]}]})).toEqual([0, 4, 10]);
  });

  it('accepts the diagrams example and rejects inconsistent diagrams', async () => {
    await expect(validateProject(await example('diagrams.video-project.json'), {schemaPath})).resolves.toBeTruthy();
    const broken = async (mutate: (scenes: VideoProject['sections'][number]['scenes']) => void) => {
      const project = await example('diagrams.video-project.json');
      mutate(project.sections[0]!.scenes);
      return validateProject(project, {schemaPath});
    };
    type Diagram = Extract<SceneVisual, {type: 'diagram'}>;
    type Nest = Extract<SceneVisual, {type: 'nest'}>;
    type Timeline = Extract<SceneVisual, {type: 'timeline'}>;
    await expect(broken((scenes) => { (scenes[0]!.visual as Diagram).links[0]!.to = 'nobody'; })).rejects.toMatchObject({code: 'UNKNOWN_DIAGRAM_NODE'});
    await expect(broken((scenes) => { (scenes[0]!.visual as Diagram).active!.packet!.link = 5; })).rejects.toMatchObject({code: 'HIGHLIGHT_OUT_OF_RANGE'});
    await expect(broken((scenes) => { (scenes[0]!.visual as Diagram).nodes[0]!.group = 'shop'; (scenes[0]!.visual as Diagram).nodes[1]!.group = undefined as unknown as string; delete (scenes[0]!.visual as Diagram).nodes[1]!.group; })).rejects.toMatchObject({code: 'DIAGRAM_GROUP_NOT_ADJACENT'});
    await expect(broken((scenes) => { (scenes[0]!.visual as Diagram).active = {groups: ['nowhere']}; })).rejects.toMatchObject({code: 'UNKNOWN_DIAGRAM_GROUP'});
    await expect(broken((scenes) => { (scenes[0]!.visual as Diagram).active = {groups: ['shop']}; })).resolves.toBeTruthy();
    await expect(broken((scenes) => { (scenes[2]!.visual as Nest).highlight = ['missing']; })).rejects.toMatchObject({code: 'HIGHLIGHT_OUT_OF_RANGE'});
    await expect(broken((scenes) => { (scenes[3]!.visual as Timeline).tracks[0]!.segments[1]!.start = 2; })).rejects.toMatchObject({code: 'TIMELINE_SEGMENT_INVALID'});
    await expect(broken((scenes) => { (scenes[3]!.visual as Timeline).cursor = 99; })).rejects.toMatchObject({code: 'TIMELINE_CURSOR_INVALID'});
    await expect(broken((scenes) => { ((scenes[4]!.visual as Extract<SceneVisual, {type: 'slide'}>).blocks[0] as {highlightLines: number[]}).highlightLines = [9]; })).rejects.toMatchObject({code: 'HIGHLIGHT_OUT_OF_RANGE'});
  });
});

describe('project lint', () => {
  const slide = (title: string, blocks: Extract<SceneVisual, {type: 'slide'}>['blocks']): SceneVisual => ({type: 'slide', title, blocks});
  const deck = async (): Promise<VideoProject> => {
    const project = await example('animated-flow.video-project.json');
    project.theme.frame = {style: 'deck'};
    return project;
  };

  it('reports small subtitles, fast speech, repeated text and absolute claims with evidence', async () => {
    const project = await deck();
    project.theme.subtitleStyle = {...project.theme.subtitleStyle, fontSize: 34};
    project.speakers[0]!.voice!.speedScale = 1.3;
    project.sections[0]!.scenes = [{
      id: 'only', speakerId: 'narrator', text: '画面も字幕も音声も同じ開始フレームに置くので、必ずずれません。',
      visual: slide('同期', [{kind: 'callout', text: 'ポイント：画面・字幕・音声を同じ開始フレームに置くので、ずれない。'}]),
    }];
    const codes = lintProject(project).map((finding) => finding.code);
    expect(codes).toEqual(expect.arrayContaining(['SUBTITLE_SMALL', 'SPEECH_FAST', 'TEXT_REPEATS_NARRATION', 'ABSOLUTE_CLAIM']));
    const small = lintProject(project).find((finding) => finding.code === 'SUBTITLE_SMALL')!;
    expect(small.evidence).toBe(34);
    expect(small.hint).toContain(String(MIN_SUBTITLE_FONT_SIZE));
  });

  it('flags a video made only of cards and tables, but not one that shows relations', async () => {
    const project = await deck();
    const pages = ['a', 'b', 'c', 'd'].map((id) => ({id, durationMs: 12000, visual: slide(`ページ${id}`, [{kind: 'cards' as const, items: [{title: id, body: '本文'}, {title: `${id}2`, body: '本文'}, {title: `${id}3`, body: '本文'}]}, {kind: 'list' as const, items: ['x']}, {kind: 'kpis' as const, items: [{label: 'l', value: 'v'}]}])}));
    project.speakers = [];
    project.sections[0]!.scenes = pages;
    expect(lintProject(project).map((finding) => finding.code)).toContain('NO_RELATIONAL_VISUAL');
    project.sections[0]!.scenes = [...pages, {id: 'flow', durationMs: 5000, visual: {type: 'flow', steps: [{title: 'a'}, {title: 'b'}], activeStep: 0}}];
    expect(lintProject(project).map((finding) => finding.code)).not.toContain('NO_RELATIONAL_VISUAL');
  });

  it('asks for an opening title page in videos of 30 seconds or more', async () => {
    const project = await deck();
    project.speakers = [];
    const body = (id: string): VideoProject['sections'][number]['scenes'][number] => ({id, durationMs: 20000, visual: {type: 'flow', steps: [{title: 'a'}, {title: 'b'}], activeStep: 0}});
    project.sections[0]!.scenes = [body('first'), body('second')];
    expect(lintProject(project).find((finding) => finding.code === 'OPENING_TITLE_MISSING')).toMatchObject({sceneIds: ['first']});
    project.sections[0]!.scenes = [{id: 'cover', durationMs: 3000, visual: {type: 'title', title: 'タイトル'}}, body('first'), body('second')];
    expect(lintProject(project).map((finding) => finding.code)).not.toContain('OPENING_TITLE_MISSING');
    project.sections[0]!.scenes = [{...body('short'), durationMs: 10000}];
    expect(lintProject(project).map((finding) => finding.code)).not.toContain('OPENING_TITLE_MISSING');
  });

  it('is quiet for the bundled examples and reports an incomplete brief', async () => {
    expect(lintProject(await example('diagrams.video-project.json')).filter((finding) => finding.severity === 'warning')).toEqual([]);
    expect(lintBrief(undefined)[0]).toMatchObject({code: 'BRIEF_INCOMPLETE'});
    expect(lintBrief({brief: {audience: 'a', viewerQuestion: 'q', outcome: 'o', coreMessage: 'm'}})).toEqual([]);
    expect(bigramContainment('同じ開始フレーム', '画面も字幕も同じ開始フレームに置く')).toBe(1);
    expect(bigramContainment('まったく別の話', '画面も字幕も同じ開始フレームに置く')).toBeLessThan(0.3);
  });
});

describe('review schema 2.0.0', () => {
  const base = {schemaVersion: '2.0.0', projectId: 'p', lockHash: 'a'.repeat(64), iteration: 1, status: 'pass', issues: []};

  it('needs every gate of the three groups and still accepts schema 1.0.0 reviews', () => {
    expect(isPassingReviewForLock({...base, gates: passingReviewGatesV2()}, 'p', 'a'.repeat(64))).toBe(true);
    expect(isPassingReviewForLock({...base, gates: passingReviewGates()}, 'p', 'a'.repeat(64))).toBe(false);
    expect(isPassingReviewForLock({...base, gates: {...passingReviewGatesV2(), formFitsMeaning: false}}, 'p', 'a'.repeat(64))).toBe(false);
    expect(isPassingReviewForLock({projectId: 'p', lockHash: 'a'.repeat(64), iteration: 1, status: 'pass', gates: passingReviewGates(), issues: []}, 'p', 'a'.repeat(64))).toBe(true);
  });

  it('allows not_applicable only for optional gates and only with a reason', () => {
    const gates = {...passingReviewGatesV2(), variedPresentation: 'not_applicable'};
    expect(hasCompletePassingReviewGatesV2(gates, {variedPresentation: '30秒・1ページの告知'})).toBe(true);
    expect(hasCompletePassingReviewGatesV2(gates, {})).toBe(false);
    expect(hasCompletePassingReviewGatesV2({...passingReviewGatesV2(), claimsAccurate: 'not_applicable'}, {claimsAccurate: 'x'})).toBe(false);
  });

  it('requires warnings to say where, how it hurts and what it was seen in', () => {
    const warning = {severity: 'warning', sceneId: 's', problem: 'p', impact: 'i', evidence: 'e', fix: 'f'};
    expect(isPassingReviewForLock({...base, gates: passingReviewGatesV2(), issues: [warning]}, 'p', 'a'.repeat(64))).toBe(true);
    expect(isPassingReviewForLock({...base, gates: passingReviewGatesV2(), issues: [{...warning, timeSeconds: 12.5, sceneId: undefined}]}, 'p', 'a'.repeat(64))).toBe(true);
    expect(isPassingReviewForLock({...base, gates: passingReviewGatesV2(), issues: [{severity: 'warning', problem: 'p', fix: 'f'}]}, 'p', 'a'.repeat(64))).toBe(false);
    expect(isPassingReviewForLock({...base, gates: passingReviewGatesV2(), issues: [{...warning, severity: 'error'}]}, 'p', 'a'.repeat(64))).toBe(false);
  });
});

describe('rendered output checks', () => {
  const scene = (id: string, startFrame: number, durationInFrames: number, visual: SceneVisual, extra: Partial<ProjectLock['scenes'][number]> = {}) =>
    ({id, startFrame, durationInFrames, visual, ...extra}) as unknown as ProjectLock['scenes'][number];

  it('samples page changes, cue switches and animated scenes', () => {
    const page: SceneVisual = {type: 'bullets', items: ['a', 'b'], highlight: [0]};
    const flow: SceneVisual = {type: 'flow', steps: [{title: 'a'}, {title: 'b'}], activeStep: 1};
    const plan = planReviewFrames({
      totalFrames: 400,
      scenes: [
        scene('one', 0, 100, page, {subtitleCues: [{text: 'x', startFrame: 0, endFrame: 40}, {text: 'y', startFrame: 40, endFrame: 100}]}),
        scene('two', 100, 100, {...page, highlight: [1]}),
        scene('three', 200, 200, flow),
      ],
    });
    expect(plan.transitions.map((item) => [item.beforeSceneId, item.afterSceneId])).toEqual([[null, 'one'], ['two', 'three']]);
    expect(plan.transitions[1]!.frames).toEqual(TRANSITION_OFFSETS.map((offset) => 200 + offset));
    expect(plan.transitions[0]!.frames.every((frame) => frame >= 0)).toBe(true);
    expect(plan.cues).toEqual([{sceneId: 'one', cueIndex: 1, text: 'y', frames: CUE_OFFSETS.map((offset) => 40 + offset)}]);
    expect(plan.motion).toEqual([{sceneId: 'three', frames: MOTION_OFFSETS.map((offset) => 200 + offset)}]);
    expect(new Set(plan.uniqueFrames).size).toBe(plan.uniqueFrames.length);
  });

  it('measures the empty part of a card from the last row with content', () => {
    const width = 10;
    const height = 20;
    const gray = new Uint8Array(width * height).fill(255);
    expect(lastInkRow(gray, width, height)).toBe(-1);
    gray.fill(40, 11 * width, 12 * width);
    gray[15 * width] = 0; // a single stray pixel is not content
    expect(lastInkRow(gray, width, height)).toBe(11);
    expect(blankLayoutWarnings([{sceneId: 'low', blankBottomRatio: BLANK_BOTTOM_WARNING_RATIO - 0.05, blankBottomPx: 200}, {sceneId: 'high', blankBottomRatio: 0.4, blankBottomPx: 330}]).map((item) => item.sceneId)).toEqual(['high']);
  });
});
