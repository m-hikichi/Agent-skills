import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LifecycleError,
  buildFingerprint,
  countSlides,
  extractMarkdownAssetReferences,
  extractPresenterNotes,
  fileFingerprint,
  finalizeRun,
  gateRun,
  initializeRun,
  lintDeck,
  parseSimpleYaml,
  pngDimensions,
  prepareReview,
  sha256Buffer,
  sha256File,
  transitionRun,
  validateCurrentReview,
} from '../lib/core.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'marp-slide.mjs');
const FIXTURES = path.resolve(HERE, '..', 'fixtures');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('Markdown image discovery includes explicit resources and ignores fenced examples', () => {
  const markdown = `![inline](assets/inline.svg)\n![full][chart]\n![collapsed][]\n![shortcut]\n<img src="assets/html.svg">\n<style>.hero { background: url('assets/style.svg'); }</style>\n<!-- _backgroundImage: url('assets/background.svg') -->\n\n[chart]: <assets/chart.svg> "Chart"\n[collapsed]: assets/collapsed.svg\n[shortcut]: assets/shortcut.svg\n\n\`![inline example](assets/not-inline.svg)\`\n\`\`\`markdown\n![example](assets/not-a-runtime-asset.svg)\n<!-- _backgroundImage: url('assets/not-a-background.svg') -->\n\`\`\`\n`;
  assert.deepEqual(extractMarkdownAssetReferences(markdown), [
    'assets/inline.svg',
    'assets/chart.svg',
    'assets/collapsed.svg',
    'assets/shortcut.svg',
    'assets/html.svg',
    'assets/style.svg',
    'assets/background.svg',
  ]);
});

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function requestYaml(overrides = {}) {
  const request = {
    topic: '信頼性改善',
    audience: '経営会議',
    audience_knowledge: '概要を理解',
    presentation_context: '意思決定',
    presentation_type: 'proposal',
    goal: '次期施策を承認する',
    target_slide_count: 2,
    slide_count_mode: 'exact',
    delivery_mode: 'hybrid',
    duration_minutes: 10,
    desired_tone: '明快',
    audience_decision_criteria: '費用対効果',
    output_formats: ['pdf', 'png', 'notes'],
    must_include: ['現状', '提案'],
    source_materials: ['source.csv'],
    evidence_policy: 'cite-or-label-assumption',
    design_reference: null,
    brand_constraints: null,
    available_assets: ['slides/assets/chart.svg'],
    language: 'ja-JP',
    author: 'Test Author',
    approval_mode: 'single-checkpoint',
    image_policy: 'hybrid',
    brand_strictness: 'guided',
    accessibility_target: 'standard',
    ...overrides,
  };
  const scalar = (value) => {
    if (value === null) return '';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    return String(value);
  };
  return Object.entries(request)
    .map(([key, value]) => {
      if (Array.isArray(value)) return value.length ? `${key}:\n${value.map((item) => `  - ${item}`).join('\n')}` : `${key}: []`;
      return `${key}: ${scalar(value)}`;
    })
    .join('\n') + '\n';
}

function markdown(asset = 'assets/chart.svg') {
  return `---
marp: true
theme: test-theme
lang: ja-JP
title: 長い日本語タイトル with English terminology that remains readable
description: テスト用資料
author: Test Author
---

# 障害の半分は同じ経路で発生する

![障害経路の比較](${asset})

<!-- 比較期間と母数を口頭で補足する。 -->

---

# 監視統合で復旧時間を短縮できる
`;
}

function themeCss() {
  return `/* @theme test-theme */
@import 'default';
section { color: #111; background: #fff; }
`;
}

function deckPlan() {
  return {
    schema_version: 1,
    deck_thesis: '監視統合で復旧時間を短縮する',
    success_criteria: ['意思決定者が施策を判断できる'],
    visual_direction: {
      concept: 'signal over noise',
      palette: ['#ffffff', '#153e75'],
      type: 'BIZ UDPGothic',
      spacing: 'generous',
      image_treatment: 'contained diagrams',
      motif: 'signal line',
      density: 'balanced',
    },
    ghost_deck_status: 'pass',
    integrated_approval: {
      mode: 'autonomous',
      options: ['.slide-work/design-a.png', '.slide-work/design-b.png', '.slide-work/design-c.png'],
      recommended: '.slide-work/design-a.png',
      selected: '.slide-work/design-a.png',
      approved_at: new Date().toISOString(),
      rationale: '経営会議で結論と根拠を最短で対応付けられるため',
    },
    slides: [
      {
        number: 1,
        role: 'evidence',
        action_title: '障害の半分は同じ経路で発生する',
        narrative_goal: '集中箇所を示す',
        evidence_ids: ['E-001'],
        visual_kind: 'chart',
        visual_brief: '障害経路の偏りを読み取らせる',
        layout: 'assertion-chart',
        density: 'balanced',
        citation: ['source.csv'],
        alt: '障害経路の比較',
        speaker_notes: '比較期間を説明する',
      },
      {
        number: 2,
        role: 'closing',
        action_title: '監視統合で復旧時間を短縮できる',
        narrative_goal: '次の行動を示す',
        evidence_ids: [],
        visual_kind: 'closing',
        visual_brief: '判断事項を一文で残す',
        layout: 'closing',
        density: 'sparse',
        citation: [],
        alt: '',
        speaker_notes: '判断を確認する',
      },
    ],
  };
}

async function createWorkspace({
  renderIteration = 2,
  improvements = null,
  withContactSheet = true,
  requestOverrides = {},
  notesContent = 'Slide 1 notes\nSlide 2 notes\n',
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'marp-slide-test-'));
  await mkdir(path.join(root, 'slides', 'assets'), { recursive: true });
  await mkdir(path.join(root, '.slide-work', 'rendered-pages'), { recursive: true });
  await writeFile(path.join(root, 'slides', 'presentation.md'), markdown());
  await writeFile(path.join(root, 'slides', 'theme.css'), themeCss());
  await writeFile(path.join(root, 'slides', 'assets', 'chart.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><title>比較</title><rect width="10" height="10"/></svg>');
  await writeFile(path.join(root, 'slides', 'assets', 'chart.vl.json'), '{"mark":"bar"}\n');
  await writeFile(path.join(root, 'source.csv'), 'name,value\nA,1\n');
  await writeFile(path.join(root, '.slide-work', 'request.yaml'), requestYaml(requestOverrides));
  await writeFile(path.join(root, '.slide-work', 'storyboard.md'), '# Storyboard\n\n障害の集中から監視統合の判断へ進む。\n');
  await writeJson(path.join(root, '.slide-work', 'deck-plan.json'), deckPlan());

  const chartHash = await sha256File(path.join(root, 'slides', 'assets', 'chart.svg'));
  await writeJson(path.join(root, '.slide-work', 'asset-manifest.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    assets: [
      {
        id: 'chart',
        path: 'slides/assets/chart.svg',
        pages: [1],
        type: 'chart',
        source: { kind: 'data', path: 'source.csv', url: null },
        license: null,
        alt: '障害経路の比較',
        decorative: false,
        crop: null,
        generator: { kind: 'vega-lite', spec_path: 'slides/assets/chart.vl.json', model: null, prompt_sha256: null },
        sha256: chartHash,
      },
    ],
  });
  await initializeRun({ root });

  for (let page = 1; page <= 2; page += 1) {
    await writeFile(path.join(root, '.slide-work', 'rendered-pages', `page-${String(page).padStart(3, '0')}.png`), PNG);
  }
  await writeFile(path.join(root, '.slide-work', 'presentation.pdf'), 'PDF fixture');
  await writeFile(path.join(root, '.slide-work', 'presentation-notes.txt'), notesContent);
  if (withContactSheet) await writeFile(path.join(root, '.slide-work', 'contact-sheet.png'), PNG);

  const context = await buildFingerprint({ root });
  const byKind = (kind) => context.files.filter((file) => file.kind === kind).map(({ path: filePath, sha256 }) => ({ path: filePath, sha256 }));
  const pageHash = sha256Buffer(PNG);
  const renderManifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    artifact_fingerprint: context.fingerprint,
    render_iteration: renderIteration,
    improvements: improvements ?? (renderIteration >= 2 ? [{ iteration: 2, description: '図表の結論注釈と余白を改善', slides: [1] }] : []),
    slide_count: 2,
    source: byKind('source')[0],
    request: byKind('request')[0],
    theme: byKind('theme')[0],
    assets: byKind('asset'),
    formats: ['pdf', 'png', 'notes'],
    outputs: [
      { format: 'pdf', path: '.slide-work/presentation.pdf', sha256: await sha256File(path.join(root, '.slide-work', 'presentation.pdf')) },
      { format: 'notes', path: '.slide-work/presentation-notes.txt', sha256: await sha256File(path.join(root, '.slide-work', 'presentation-notes.txt')) },
    ],
    page_images: [1, 2].map((slide) => ({
      slide,
      path: `.slide-work/rendered-pages/page-${String(slide).padStart(3, '0')}.png`,
      sha256: pageHash,
      width: 1,
      height: 1,
    })),
    contact_sheet: withContactSheet
      ? { path: '.slide-work/contact-sheet.png', sha256: pageHash, width: 1, height: 1 }
      : null,
    environment: {
      marp_cli: '4.4.0',
      marp_core: '4.3.0',
      chromium: 'test',
      node: process.version,
      platform: process.platform,
      fonts: [{ name: 'Noto Sans CJK JP', url: 'apt:fonts-noto-cjk', sha256: 'a'.repeat(64) }],
    },
  };
  await writeJson(path.join(root, '.slide-work', 'render-manifest.json'), renderManifest);
  return { root, context, renderManifest };
}

function check(status = 'pass', evidence = '確認済み') {
  return { status, evidence };
}

function score(value = 4) {
  return { score: value, reason: '実用水準' };
}

async function writePassReview(root, overrides = {}) {
  const context = await buildFingerprint({ root });
  const render = JSON.parse(await readFile(path.join(root, '.slide-work', 'render-manifest.json'), 'utf8'));
  const review = {
    rubric_version: 3,
    status: 'pass',
    reviewed_at: new Date().toISOString(),
    artifact_fingerprint: context.fingerprint,
    review_attempt: 1,
    render_iteration: render.render_iteration,
    missing_required: [],
    questions_for_user: [],
    issues: [],
    strengths: ['結論が明確'],
    machine_qa: {
      status: 'pass',
      checks: {
        asset_integrity: check(),
        overflow: check(),
        clipping: check(),
        slide_count: check(),
        minimum_text_size: check(),
        contrast: check(),
        alt_text: check(),
        manifest_integrity: check(),
      },
    },
    content_review: {
      status: 'pass',
      hard_gates: {
        audience_goal_fit: check(),
        must_include_coverage: check(),
        evidence_integrity: check(),
        story_coherence: check(),
      },
      scores: { story_audience_fit: score(), evidence_content_quality: score() },
    },
    visual_review: {
      status: 'pass',
      contact_sheet: render.contact_sheet?.path ?? null,
      checked_page_count: render.slide_count,
      page_images: render.page_images.map((page) => page.path),
      hard_gates: { rendered_readability: check(), visual_semantics: check(), accessibility: check() },
      scores: { visual_hierarchy_semantics: score(), cohesion_polish: score() },
      page_findings: [],
    },
    ...overrides,
  };
  await writeJson(path.join(root, '.slide-work', 'review.json'), review);
  return review;
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

test('CRLF and LF decks produce the same slide count and ignore separators inside fences', async () => {
  const fixture = JSON.parse(await readFile(path.join(FIXTURES, 'crlf-deck.fixture.json'), 'utf8'));
  assert.equal(countSlides(fixture.content), 2);
  assert.equal(countSlides(fixture.content.replaceAll('\r\n', '\n')), 2);
});

test('simple YAML parser supports request arrays and rejects duplicate keys and tabs', () => {
  assert.deepEqual(parseSimpleYaml('a: 1\nb:\n  - x\n  - y\n'), { a: 1, b: ['x', 'y'] });
  assert.throws(() => parseSimpleYaml('a: 1\na: 2\n'), /repeats key/);
  assert.throws(() => parseSimpleYaml('a:\t1\n'), /spaces, not tabs/);
});

test('presenter note discovery ignores Marpit directives and keeps real notes', () => {
  assert.deepEqual(
    extractPresenterNotes('<!-- _class: cover -->\n<!--\n説明用の補足です。\n-->\n'),
    ['説明用の補足です。'],
  );
});

test('lint is CRLF-safe, accepts long mixed-language titles, and rejects external or missing assets', async () => {
  const { root } = await createWorkspace();
  try {
    const source = path.join(root, 'slides', 'presentation.md');
    await writeFile(source, (await readFile(source, 'utf8')).replaceAll('\n', '\r\n'));
    const valid = await lintDeck({ root, target: '2', slideCountMode: 'exact' });
    assert.equal(valid.ok, true, valid.failures.join('\n'));
    await writeFile(source, markdown().replace('<!-- 比較期間と母数を口頭で補足する。 -->', ''));
    const missingNotes = await lintDeck({ root });
    assert.equal(missingNotes.ok, false);
    assert.match(missingNotes.failures.join('\n'), /presenter notes are required/);
    await writeFile(source, markdown().replace('marp: true', 'marp: true\nheadingDivider: 2'));
    const implicitSlides = await lintDeck({ root });
    assert.equal(implicitSlides.ok, false);
    assert.match(implicitSlides.failures.join('\n'), /headingDivider is disabled/);
    await writeFile(source, markdown('https://example.com/chart.svg'));
    const external = await lintDeck({ root });
    assert.equal(external.ok, false);
    assert.match(external.failures.join('\n'), /remote, data, or file URL/);
    await writeFile(source, markdown('assets/missing.svg'));
    const missing = await lintDeck({ root });
    assert.equal(missing.ok, false);
    assert.match(missing.failures.join('\n'), /does not exist/);
  } finally {
    await cleanup(root);
  }
});

test('read-ahead decks may preserve an empty notes artifact', async () => {
  const { root } = await createWorkspace({
    requestOverrides: { delivery_mode: 'read-ahead' },
    notesContent: '',
  });
  try {
    await writePassReview(root);
    const validated = await validateCurrentReview({ root }, { syncState: false });
    assert.equal(validated.review.review.status, 'pass');
  } finally {
    await cleanup(root);
  }
});

test('fingerprint covers request, source, theme, asset manifest, local asset, data, and generator spec', async () => {
  const { root } = await createWorkspace();
  try {
    const first = await fileFingerprint({ root });
    assert.deepEqual(first.files.map((file) => file.kind), ['asset', 'asset', 'asset', 'asset_manifest', 'request', 'source', 'theme']);
    const mutations = [
      ['.slide-work/request.yaml', '\n# request changed\n'],
      ['slides/presentation.md', '\n<!-- source changed -->\n'],
      ['slides/theme.css', '\n/* theme changed */\n'],
      ['source.csv', 'B,2\n'],
      ['slides/assets/chart.vl.json', '\n'],
    ];
    let previous = first.fingerprint;
    for (const [relative, addition] of mutations) {
      const file = path.join(root, relative);
      await writeFile(file, `${await readFile(file, 'utf8')}${addition}`);
      const current = await fileFingerprint({ root });
      assert.notEqual(current.fingerprint, previous, `${relative} should invalidate fingerprint`);
      previous = current.fingerprint;
    }
    await writeFile(path.join(root, 'slides', 'assets', 'chart.svg'), '<svg/>');
    await assert.rejects(() => fileFingerprint({ root }), /asset manifest semantic validation failed/);
  } finally {
    await cleanup(root);
  }
});

test('asset provenance requires licensed web sources and reproducible data/generated assets', async () => {
  const { root } = await createWorkspace();
  try {
    const file = path.join(root, '.slide-work', 'asset-manifest.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.assets[0].source = { kind: 'web', path: null, url: null };
    manifest.assets[0].license = null;
    manifest.assets[0].generator = null;
    await writeJson(file, manifest);
    await assert.rejects(() => fileFingerprint({ root }), /url.*string|license.*string/);

    manifest.assets[0].source = { kind: 'generated', path: null, url: null };
    manifest.assets[0].generator = { kind: 'image-generation', spec_path: null, model: null, prompt_sha256: null };
    await writeJson(file, manifest);
    await assert.rejects(() => fileFingerprint({ root }), /model.*string|prompt_sha256.*string/);
  } finally {
    await cleanup(root);
  }
});

test('path traversal, SVG active content, and invalid PNG files are rejected', async () => {
  const { root } = await createWorkspace();
  try {
    await writeFile(path.join(root, 'slides', 'presentation.md'), markdown('../outside.svg'));
    await assert.rejects(() => fileFingerprint({ root }), /traverses outside/);
    await writeFile(path.join(root, 'slides', 'presentation.md'), markdown());
    await writeFile(path.join(root, 'slides', 'assets', 'chart.svg'), '<svg><script>alert(1)</script></svg>');
    const assetManifest = JSON.parse(await readFile(path.join(root, '.slide-work', 'asset-manifest.json'), 'utf8'));
    assetManifest.assets[0].sha256 = await sha256File(path.join(root, 'slides', 'assets', 'chart.svg'));
    await writeJson(path.join(root, '.slide-work', 'asset-manifest.json'), assetManifest);
    await assert.rejects(() => fileFingerprint({ root }), /SVG assets may not contain/);
    assert.throws(() => pngDimensions(Buffer.alloc(32)), /PNG signature/);
  } finally {
    await cleanup(root);
  }
});

test('prepare-review emits rubric v3 fingerprint and increments only valid v3 attempts', async () => {
  const { root } = await createWorkspace();
  try {
    const first = await prepareReview({ root });
    assert.equal(first.rubric_version, 3);
    assert.equal(first.review_attempt, 1);
    await writePassReview(root);
    const second = await prepareReview({ root });
    assert.equal(second.review_attempt, 2);
    const legacy = JSON.parse(await readFile(path.join(root, '.slide-work', 'review.json'), 'utf8'));
    legacy.rubric_version = 2;
    await writeJson(path.join(root, '.slide-work', 'review.json'), legacy);
    const reset = await prepareReview({ root });
    assert.equal(reset.review_attempt, 1);
  } finally {
    await cleanup(root);
  }
});

test('strict rubric v3 rejects unknown keys, fake page evidence, low scores, and major findings', async () => {
  const { root } = await createWorkspace();
  try {
    const review = await writePassReview(root);
    const valid = await validateCurrentReview({ root }, { syncState: false });
    assert.equal(valid.review.review.status, 'pass');

    review.unexpected = true;
    await writeJson(path.join(root, '.slide-work', 'review.json'), review);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /does not satisfy review/);
    delete review.unexpected;
    review.visual_review.page_images = ['.slide-work/rendered-pages/fake.png'];
    await writeJson(path.join(root, '.slide-work', 'review.json'), review);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /must exactly match/);
    review.visual_review.page_images = ['.slide-work/rendered-pages/page-001.png', '.slide-work/rendered-pages/page-002.png'];
    review.content_review.scores.story_audience_fit.score = 3;
    await writeJson(path.join(root, '.slide-work', 'review.json'), review);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /scores must be at least 4/);
    review.content_review.scores.story_audience_fit.score = 4;
    review.visual_review.page_findings.push({ slide: 1, severity: 'major', finding: '図が読めない' });
    await writeJson(path.join(root, '.slide-work', 'review.json'), review);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /major visual finding/);
  } finally {
    await cleanup(root);
  }
});

test('render validation rejects missing/extra/wrong-hash PNGs and source-overwriting outputs', async () => {
  const { root, renderManifest } = await createWorkspace();
  try {
    await writePassReview(root);
    await writeFile(path.join(root, '.slide-work', 'rendered-pages', 'page-999.png'), PNG);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /does not exactly match manifest/);
    await rm(path.join(root, '.slide-work', 'rendered-pages', 'page-999.png'));
    renderManifest.page_images[0].sha256 = '0'.repeat(64);
    await writeJson(path.join(root, '.slide-work', 'render-manifest.json'), renderManifest);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /hash mismatch/);
    renderManifest.page_images[0].sha256 = sha256Buffer(PNG);
    renderManifest.page_images.pop();
    await writeJson(path.join(root, '.slide-work', 'render-manifest.json'), renderManifest);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /page_images count/);
    renderManifest.page_images.push({
      slide: 2,
      path: '.slide-work/rendered-pages/page-002.png',
      sha256: sha256Buffer(PNG),
      width: 1,
      height: 1,
    });
    renderManifest.outputs[0] = { format: 'pdf', path: 'slides/presentation.md', sha256: await sha256File(path.join(root, 'slides', 'presentation.md')) };
    await writeJson(path.join(root, '.slide-work', 'render-manifest.json'), renderManifest);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /must use \.pdf|overwrites an input file/);
  } finally {
    await cleanup(root);
  }
});

test('invalid JSON, path traversal in manifests, and corrupt run markers fail closed', async () => {
  const { root, renderManifest } = await createWorkspace();
  try {
    await writePassReview(root);
    await writeFile(path.join(root, '.slide-work', 'review.json'), '{ invalid json');
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /not valid JSON/);
    await writePassReview(root);
    renderManifest.outputs[0].path = '../outside.pdf';
    await writeJson(path.join(root, '.slide-work', 'render-manifest.json'), renderManifest);
    await assert.rejects(() => validateCurrentReview({ root }, { syncState: false }), /does not satisfy render-manifest/);
    await writeFile(path.join(root, '.slide-work', 'run-state.json'), '{ bad marker');
    await assert.rejects(
      () => gateRun({ root }),
      (error) => error instanceof LifecycleError && error.exitCode === 2 && /run marker is invalid/.test(error.message),
    );
  } finally {
    await cleanup(root);
  }
});

test('finalize requires a second render, improvement record, contact sheet, and exact pass review', async () => {
  const first = await createWorkspace({ renderIteration: 1, improvements: [] });
  try {
    await writePassReview(first.root);
    await assert.rejects(() => finalizeRun({ root: first.root }), /first render cannot be finalized/);
  } finally {
    await cleanup(first.root);
  }

  const noImprovement = await createWorkspace({ renderIteration: 2, improvements: [] });
  try {
    await writePassReview(noImprovement.root);
    await assert.rejects(() => finalizeRun({ root: noImprovement.root }), /improvement must be recorded/);
  } finally {
    await cleanup(noImprovement.root);
  }

  const noContact = await createWorkspace({ withContactSheet: false });
  try {
    await writePassReview(noContact.root);
    await assert.rejects(() => finalizeRun({ root: noContact.root }), /contact_sheet.*object/);
  } finally {
    await cleanup(noContact.root);
  }
});

test('state machine scopes gate, allows needs_user/blocked, and stale complete blocks', async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), 'marp-slide-empty-'));
  try {
    assert.equal((await gateRun({ root: empty })).scoped, false);
  } finally {
    await cleanup(empty);
  }

  const { root } = await createWorkspace();
  try {
    await assert.rejects(
      () => gateRun({ root }),
      (error) => error instanceof LifecycleError && error.exitCode === 2,
    );
    await transitionRun({ root, status: 'needs_user', message: 'デザイン案の選択待ち' });
    assert.equal((await gateRun({ root })).status, 'needs_user');
    await transitionRun({ root, status: 'active' });
    await assert.rejects(() => gateRun({ root }), (error) => error instanceof LifecycleError && error.exitCode === 2);
    await transitionRun({ root, status: 'blocked', message: '外部レンダラーの復旧待ち' });
    assert.equal((await gateRun({ root })).status, 'blocked');
    await transitionRun({ root, status: 'active' });
    await assert.rejects(() => transitionRun({ root, status: 'needs_user' }), /requires --message/);
    const review = await writePassReview(root, {
      status: 'needs_user',
      questions_for_user: ['ブランド色を確認してください'],
      machine_qa: { status: 'not_run', checks: Object.fromEntries(['asset_integrity', 'overflow', 'clipping', 'slide_count', 'minimum_text_size', 'contrast', 'alt_text', 'manifest_integrity'].map((key) => [key, check('not_run', '')])) },
    });
    await validateCurrentReview({ root });
    const needsUser = await gateRun({ root });
    assert.equal(needsUser.status, 'needs_user');
    assert.equal(needsUser.completed, false);

    const blockedReview = await writePassReview(root, {
      status: 'blocked',
      questions_for_user: ['レンダラー復旧後に再実行してください'],
      machine_qa: {
        status: 'blocked',
        checks: Object.fromEntries(['asset_integrity', 'overflow', 'clipping', 'slide_count', 'minimum_text_size', 'contrast', 'alt_text', 'manifest_integrity'].map((key) => [key, check('not_run', '')])),
      },
    });
    await validateCurrentReview({ root });
    const blocked = await gateRun({ root });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.completed, false);

    await writePassReview(root);
    await finalizeRun({ root });
    assert.equal((await gateRun({ root })).completed, true);
    await assert.rejects(() => transitionRun({ root, status: 'active' }), /complete run is immutable/);
    await writeFile(path.join(root, 'slides', 'presentation.md'), `${await readFile(path.join(root, 'slides', 'presentation.md'), 'utf8')}\n<!-- stale -->\n`);
    await assert.rejects(
      () => gateRun({ root }),
      (error) => error instanceof LifecycleError && error.exitCode === 2 && /no longer valid/.test(error.message),
    );
    assert.equal(review.rubric_version, 3);
    assert.equal(blockedReview.rubric_version, 3);
  } finally {
    await cleanup(root);
  }
});

test('CLI exits 0 for unrelated work and 1 for invalid options', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'marp-slide-cli-'));
  try {
    const success = await execFileAsync(process.execPath, [CLI, 'gate', '--root', root]);
    assert.equal(JSON.parse(success.stdout).scoped, false);
    await execFileAsync(process.execPath, [CLI, 'init', '--root', root]);
    const waiting = await execFileAsync(process.execPath, [
      CLI,
      'set-status',
      '--root',
      root,
      '--status',
      'needs_user',
      '--message',
      '統合デザイン確認待ち',
    ]);
    assert.equal(JSON.parse(waiting.stdout).state.status, 'needs_user');
    assert.equal(JSON.parse((await execFileAsync(process.execPath, [CLI, 'gate', '--root', root])).stdout).blocked, false);
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, 'lint', '--unknown', 'x', '--root', root]),
      (error) => error.code === 1 && /Unknown option/.test(error.stderr),
    );
  } finally {
    await cleanup(root);
  }
});
