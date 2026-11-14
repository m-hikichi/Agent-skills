import type {Scene, SceneVisual, VideoProject} from '../shared/video-types.js';
import {buildPreviewScenes, codeFontSize, isCoverVisual, isDeckFrame, sceneContinuity, splitSubtitle, subtitleLineUnits, textUnits} from '../render/layout.js';
import {linkLabelUnits} from '../render/diagrams.js';

/**
 * Advisory checks of an authored project that a machine can decide from the
 * JSON alone. They never block a job: each finding names the scenes, the
 * measured value and a concrete way to act on it, and the reviewers decide
 * whether it matters for this video. Checks that need eyes (focus, whether a
 * diagram fits its meaning, pacing) are left to the review agents.
 */
export interface LintFinding {
  code: string;
  severity: 'warning' | 'info';
  /** A: technical, B: legibility, C: explanation, D: visual language. */
  category: 'technical' | 'legibility' | 'explanation' | 'visual';
  sceneIds: string[];
  message: string;
  hint: string;
  /** The number or text the finding was derived from. */
  evidence?: string | number;
}

/**
 * Smallest subtitle size that stays readable when the 1920px frame is shown
 * 640px wide (a phone in portrait, an embedded player): 40px becomes about
 * 13px, the usual lower bound for body text on screens.
 */
export const MIN_SUBTITLE_FONT_SIZE = 40;
/** Code drawn smaller than this becomes unreadable at 640px wide (32px → about 11px, the limit for monospace). */
export const MIN_CODE_FONT_SIZE = 32;
/** Videos at least this long open with a title page; a short clip or a single-message spot may start directly. */
export const MIN_SECONDS_FOR_TITLE = 30;
/** Above this VOICEVOX speedScale the narration is shortened by talking faster rather than by saying less. */
export const MAX_SPEED_SCALE = 1.15;
/** A page whose only change for this many scenes is the emphasis reads as one static picture. */
export const MAX_EMPHASIS_ONLY_SCENES = 6;

/**
 * On-screen sentence counted as a repeat of the narration when this share of
 * its 2-character sequences occurs in what is spoken on the same page. A
 * paraphrase that only changes particles and the sentence ending scores about 0.7.
 */
export const REPEATED_TEXT_CONTAINMENT = 0.65;

const ABSOLUTE_TERMS =['必ず', '絶対', '常に', '完全に', '一切', '誰でも', 'すべて', '全て', 'ずれません', 'ずれない', '同じになる', '同じになります', '同じ動画になります', '間違いなく', '100%'];

/** Visual types whose form itself carries a relation (order, hand-off, containment, time, comparison, a real artefact). */
const RELATIONAL_TYPES = new Set<SceneVisual['type']>(['flow', 'diagram', 'nest', 'timeline', 'split', 'code', 'media', 'metric']);

const normalize = (text: string): string => text.replace(/[\s、。，．,.!！?？「」『』（）()：:・]/gu, '');

/** Share of the 2-character sequences of `part` that also occur in `whole`. */
export const bigramContainment = (part: string, whole: string): number => {
  const a = normalize(part);
  const b = normalize(whole);
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Set<string>();
  for (let index = 0; index < b.length - 1; index += 1) grams.add(b.slice(index, index + 2));
  let hits = 0;
  for (let index = 0; index < a.length - 1; index += 1) if (grams.has(a.slice(index, index + 2))) hits += 1;
  return hits / (a.length - 1);
};

const visibleTexts = (visual: SceneVisual): string[] => {
  const texts: string[] = [];
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === 'string') {
      if (key !== 'type' && key !== 'kind' && key !== 'id' && key !== 'from' && key !== 'to' && key !== 'group' && key !== 'variant' && key !== 'language' && key !== 'assetId' && key !== 'code') texts.push(value);
    } else if (Array.isArray(value)) {
      if (key !== 'highlight' && key !== 'emphasis') value.forEach((item) => visit(item, key));
    } else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
    }
  };
  visit(visual);
  return texts;
};

interface Page {scenes: Scene[]; visual: SceneVisual}

const pagesOf = (project: VideoProject): Page[] => {
  const scenes = project.sections.flatMap((section) => section.scenes);
  const continuity = sceneContinuity(scenes);
  const pages: Page[] = [];
  scenes.forEach((scene, index) => {
    if (continuity[index]?.fromPrevious && pages.length) pages.at(-1)!.scenes.push(scene);
    else pages.push({scenes: [scene], visual: scene.visual});
  });
  return pages;
};

export const lintProject = (project: VideoProject): LintFinding[] => {
  const findings: LintFinding[] = [];
  const scenes = project.sections.flatMap((section) => section.scenes);
  const pages = pagesOf(project);
  const contentPages = pages.filter((page) => !isCoverVisual(page.visual));

  // B. Legibility
  const fontSize = project.theme.subtitleStyle?.fontSize ?? 48;
  if (scenes.some((scene) => scene.subtitle ?? scene.text) && fontSize < MIN_SUBTITLE_FONT_SIZE) {
    findings.push({
      code: 'SUBTITLE_SMALL', severity: 'warning', category: 'legibility', sceneIds: [], evidence: fontSize,
      message: `字幕が${fontSize}pxです。幅640pxの表示では約${Math.round(fontSize / 3)}pxになり読みにくくなります`,
      hint: `theme.subtitleStyle.fontSizeを${MIN_SUBTITLE_FONT_SIZE}以上にする。長い台詞は自動で文ごとに分割表示されるので、1行に収めるために小さくしない`,
    });
  }
  const lineUnits = subtitleLineUnits(project);
  const maxLines = project.theme.subtitleStyle?.maxLines ?? 2;
  const overflowing = scenes.filter((scene) => {
    const text = scene.subtitle ?? scene.text ?? '';
    const cues = (project.theme.subtitleStyle?.split ?? 'auto') === 'auto' ? splitSubtitle(text, lineUnits, maxLines) : [text];
    return cues.some((cue) => textUnits(cue) > lineUnits * maxLines);
  });
  if (overflowing.length) {
    findings.push({
      code: 'SUBTITLE_TOO_LONG', severity: 'warning', category: 'legibility', sceneIds: overflowing.map((scene) => scene.id), evidence: `${lineUnits}文字×${maxLines}行`,
      message: '文ごとに分けても字幕の枠に収まらない台詞があります',
      hint: '読点で区切れる文にするか、sceneを分ける。文字を小さくして収めない',
    });
  }

  const smallCode = contentPages.filter((page) => page.visual.type === 'code' && codeFontSize(page.visual.code) < MIN_CODE_FONT_SIZE);
  if (smallCode.length) {
    findings.push({
      code: 'CODE_TEXT_SMALL', severity: 'warning', category: 'legibility', sceneIds: smallCode.map((page) => page.scenes[0]!.id),
      evidence: smallCode.map((page) => `${codeFontSize((page.visual as Extract<SceneVisual, {type: 'code'}>).code)}px`).join(', '),
      message: `コードが長く、文字が${MIN_CODE_FONT_SIZE}px未満に縮小されます。幅640pxの表示では読めません`,
      hint: '説明している行だけを切り出す。長い行は短くするか省略記号で切る',
    });
  }

  const longLabels = contentPages.flatMap((page) => {
    const visual = page.visual;
    if (visual.type !== 'diagram') return [];
    const ids = visual.nodes.map((node) => node.id);
    const limit = linkLabelUnits(visual.nodes.length);
    const labels = visual.links.filter((link) => link.label && Math.abs(ids.indexOf(link.from) - ids.indexOf(link.to)) === 1 && textUnits(link.label) > limit).map((link) => link.label!);
    return labels.length ? [{id: page.scenes[0]!.id, labels, limit}] : [];
  });
  if (longLabels.length) {
    findings.push({
      code: 'DIAGRAM_LABEL_LONG', severity: 'warning', category: 'legibility', sceneIds: longLabels.map((item) => item.id),
      evidence: longLabels.map((item) => `${item.labels.join('・')}（上限${item.limit}文字）`).join(' / '),
      message: '接続図の矢印のラベルが、node同士の間隔に収まりません',
      hint: 'ラベルを渡るものの名前だけに短くする。状態（成功・失敗）はnoteかnodeのdetailに書く',
    });
  }

  // C. Explanation
  // A video that opens straight into an explanation feels cut off: the viewer is not told what they are watching.
  const opening = scenes[0];
  const totalSeconds = buildPreviewScenes(project).reduce((sum, scene) => sum + scene.durationInFrames, 0) / project.canvas.fps;
  if (opening && opening.visual.type !== 'title' && totalSeconds >= MIN_SECONDS_FOR_TITLE) {
    findings.push({
      code: 'OPENING_TITLE_MISSING', severity: 'warning', category: 'explanation', sceneIds: [opening.id], evidence: opening.visual.type,
      message: '最初の場面がタイトル画面（visual.type: title）ではありません。何の動画かを示さずに説明が始まり、途中から始まったように見えます',
      hint: '先頭にtitleの場面（タイトルと、誰向けの何の動画かを示す副題）を置く。問いや具体例はその直後に続ける。利用者の指定で省く場合はlintDecisionsに理由を書く',
    });
  }
  for (const speaker of project.speakers) {
    const speed = speaker.voice?.speedScale ?? speaker.speed ?? 1;
    if (speed > MAX_SPEED_SCALE) {
      findings.push({
        code: 'SPEECH_FAST', severity: 'warning', category: 'explanation', sceneIds: [], evidence: speed,
        message: `話者${speaker.id}の話速が${speed}です。尺を詰めるために話速を上げると、初見の視聴者が追えなくなります`,
        hint: `speedScaleを${MAX_SPEED_SCALE}以下にし、尺は台詞と扱う範囲を減らして合わせる`,
      });
    }
  }
  const absolute = scenes.flatMap((scene) => {
    const spoken = scene.text ?? '';
    const terms = ABSOLUTE_TERMS.filter((term) => spoken.includes(term) || visibleTexts(scene.visual).some((text) => text.includes(term)));
    return terms.length ? [{id: scene.id, terms}] : [];
  });
  if (absolute.length) {
    findings.push({
      code: 'ABSOLUTE_CLAIM', severity: 'info', category: 'explanation', sceneIds: absolute.map((item) => item.id),
      evidence: [...new Set(absolute.flatMap((item) => item.terms))].join('・'),
      message: '言い切りの表現があります。成立する条件（端数処理、例外、前提）を確認してください',
      hint: '条件付きでしか成り立たない場合は、条件を台詞か画面に添えるか、言い切りをやめる',
    });
  }
  const duplicated = contentPages.flatMap((page) => {
    if (page.visual.type !== 'slide') return [];
    const narration = page.scenes.map((scene) => scene.text ?? '').join('');
    return page.visual.blocks.some((block) => {
      if (block.kind !== 'callout' && block.kind !== 'text') return false;
      // A short lead-in label ("ポイント：") is not part of the sentence being compared.
      const body = block.text.replace(/^[^：:。、]{1,8}[：:]/u, '');
      return Array.from(body).length >= 16 && bigramContainment(body, narration) >= REPEATED_TEXT_CONTAINMENT;
    }) ? [page.scenes[0]!.id] : [];
  });
  if (duplicated.length) {
    findings.push({
      code: 'TEXT_REPEATS_NARRATION', severity: 'warning', category: 'explanation', sceneIds: duplicated,
      message: '画面の文章（本文・ポイント欄）が台詞とほぼ同じです。字幕も同じ文を出すため、同じ文が三重になります',
      hint: '画面は図・数値・短い見出しにして台詞に説明を任せるか、ポイント欄を削る',
    });
  }

  // D. Visual language
  const relationalPages = contentPages.filter((page) => RELATIONAL_TYPES.has(page.visual.type));
  if (contentPages.length >= 4 && relationalPages.length === 0) {
    findings.push({
      code: 'NO_RELATIONAL_VISUAL', severity: 'warning', category: 'visual', sceneIds: [], evidence: `${contentPages.length}ページ`,
      message: '全ページがカード・表・箇条書きです。流れ・受け渡し・包含・時間・比較・実物のいずれかを説明しているなら、その関係を形で見せる画面がありません',
      hint: 'references/visual-guidelines.mdの「意味と形式の対応」を見て、該当する場面をflow・diagram・nest・timeline・split・codeに置き換える。並列の列挙だけの動画ならこのままでよい',
    });
  }
  // A diagram whose packet moves, a timeline whose cursor moves and a flow that advances change more than emphasis.
  const moves = (visual: SceneVisual): boolean => visual.type === 'flow'
    || (visual.type === 'diagram' && visual.active?.packet !== undefined)
    || (visual.type === 'timeline' && visual.cursor !== undefined);
  const longRuns = contentPages.filter((page) => page.scenes.filter((scene) => !moves(scene.visual)).length > MAX_EMPHASIS_ONLY_SCENES);
  if (longRuns.length) {
    findings.push({
      code: 'LONG_EMPHASIS_RUN', severity: 'info', category: 'visual', sceneIds: longRuns.map((page) => page.scenes[0]!.id),
      evidence: Math.max(...longRuns.map((page) => page.scenes.length)),
      message: `同じ画面のまま強調だけを切り替えるsceneが${MAX_EMPHASIS_ONLY_SCENES}回を超えて続きます`,
      hint: '論点の切れ目でページを分けるか、途中に実例・図・比較を挟む',
    });
  }
  if (isDeckFrame(project) && contentPages.length >= 2) {
    const sparse = contentPages.filter((page) => page.visual.type === 'slide' && (page.visual.scale ?? 'normal') === 'normal' && page.visual.blocks.length <= 2);
    if (sparse.length) {
      findings.push({
        code: 'SPARSE_SLIDE', severity: 'info', category: 'legibility', sceneIds: sparse.map((page) => page.scenes[0]!.id),
        message: 'ブロックが2個以下のページがあります。カードの下に大きな空白ができ、文字が相対的に小さく見える可能性があります',
        hint: 'slideのscaleをlarge/xlargeにしalignをcenterにする。storyboardのlayoutMetricsで空白率を確認する',
      });
    }
  }
  return findings;
};

/** Fields of the brief that the production steps rely on; reported when request.json lacks them. */
export const BRIEF_FIELDS = ['audience', 'viewerQuestion', 'outcome', 'coreMessage'] as const;

export const lintBrief = (request: unknown): LintFinding[] => {
  const brief = request && typeof request === 'object' ? (request as {brief?: unknown}).brief : undefined;
  const record = brief && typeof brief === 'object' ? brief as Record<string, unknown> : {};
  const missing = BRIEF_FIELDS.filter((field) => typeof record[field] !== 'string' || !(record[field] as string).trim());
  return missing.length ? [{
    code: 'BRIEF_INCOMPLETE', severity: 'warning', category: 'explanation', sceneIds: [], evidence: missing.join(', '),
    message: `request.jsonのbriefに未記入の項目があります: ${missing.join(', ')}`,
    hint: '依頼文から合理的に補って記入する。利用者にしか分からない場合だけ質問する',
  }] : [];
};
