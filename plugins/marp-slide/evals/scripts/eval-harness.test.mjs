import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'eval-harness.mjs');
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function sizedPng(mark = 0, width = 2400, height = 1350) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const scanlines = Buffer.alloc((width + 1) * height);
  scanlines[1] = mark;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG_A = sizedPng(0);
const PNG_B = sizedPng(255);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(result.status, expectedStatus, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function dummyPlugin(path, label) {
  await mkdir(join(path, 'skills', 'main'), { recursive: true });
  await writeFile(join(path, 'skills', 'main', 'SKILL.md'), `---\nname: main\n---\n${label}\n`);
}

async function populateVisualOutputs(iterationDir) {
  const manifest = await json(join(iterationDir, 'run-manifest.json'));
  for (const item of manifest.evals) {
    for (const configuration of ['with_skill', 'without_skill']) {
      const output = join(iterationDir, item.directory, configuration, 'run-1', 'outputs');
      await mkdir(output, { recursive: true });
      await writeFile(join(output, 'deck.pdf'), PDF);
      await writeFile(join(output, 'contact-sheet.png'), PNG_A);
      await writeFile(join(output, 'page-001.png'), PNG_A);
    }
  }
  return manifest;
}

async function completeFormalResults(iterationDir, manifest) {
  for (const item of manifest.evals) {
    for (const configuration of ['with_skill', 'without_skill']) {
      const path = join(iterationDir, item.directory, configuration, 'run-1', 'formal-results.json');
      const value = await json(path);
      for (const check of Object.values(value.checks)) {
        check.passed = true;
        check.evidence = 'independent fixture check passed';
      }
      await writeJson(path, value);
    }
  }
}

test('five fixture-backed evals validate', () => {
  const result = run(['validate']);
  assert.equal(JSON.parse(result.stdout).eval_count, 5);
});

test('init, blind packaging, and acceptance are reproducible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marp-eval-'));
  const baseline = join(root, 'v08');
  const candidate = join(root, 'v10');
  const workspace = join(root, 'workspace');
  await dummyPlugin(baseline, 'baseline');
  await dummyPlugin(candidate, 'candidate');

  run(['init', '--workspace', workspace, '--baseline-plugin', baseline, '--candidate-plugin', candidate]);
  const iterationDir = join(workspace, 'iteration-1');
  const manifest = await populateVisualOutputs(iterationDir);
  assert.equal(manifest.evals.length, 5);
  const metadata = await json(join(iterationDir, manifest.evals[0].directory, 'eval_metadata.json'));
  assert.ok(Array.isArray(metadata.assertions));
  assert.ok(metadata.assertions.length > 0);

  run(['blind', '--workspace', workspace, '--seed', 'fixed-test-seed']);
  assert.equal((await json(join(iterationDir, 'blind-review', 'index.json'))).evals.length, 5);
  assert.ok(await readFile(join(workspace, '_private', 'blind-map.iteration-1.json')));
  const anonymousPdf = await readFile(join(iterationDir, 'blind-review', manifest.evals[0].directory, 'A', 'deck.pdf'));
  assert.equal(anonymousPdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(anonymousPdf.includes(Buffer.from('/Author', 'ascii')), false);
  assert.notDeepEqual(anonymousPdf, PDF);
  const initialMapping = await json(join(workspace, '_private', 'blind-map.iteration-1.json'));
  const candidateAs = initialMapping.assignments.filter((entry) => entry.labels.A === 'with_skill').length;
  assert.ok(candidateAs === 2 || candidateAs === 3);
  run(['acceptance', '--workspace', workspace], 1);

  await completeFormalResults(iterationDir, manifest);
  const mapping = await json(join(workspace, '_private', 'blind-map.iteration-1.json'));
  for (const item of manifest.evals) {
    const assignment = mapping.assignments.find((entry) => entry.eval_id === item.eval_id);
    const candidateLabel = assignment.labels.A === 'with_skill' ? 'A' : 'B';
    const reviewPath = join(iterationDir, 'blind-review', item.directory, 'review.json');
    const review = await json(reviewPath);
    review.reviewer_id = 'blind-reviewer-1';
    review.preferred = candidateLabel;
    review.reasoning = 'Candidate communicates the fixture evidence more clearly.';
    for (const side of ['A', 'B']) {
      for (const key of Object.keys(review.scores[side])) review.scores[side][key] = side === candidateLabel ? 5 : 4;
    }
    await writeJson(reviewPath, review);
  }
  const accepted = run(['acceptance', '--workspace', workspace]);
  assert.equal(JSON.parse(accepted.stdout).pass, true);
  assert.equal((await json(join(iterationDir, 'acceptance-report.json'))).candidate_preferences, 5);
});

test('gold deck exact visual regression detects a changed page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marp-gold-'));
  const renders = join(root, 'renders');
  const baseline = join(root, 'baseline.json');
  for (const id of ['executive-decision', 'analytical-read-ahead', 'technical-training']) {
    const deck = join(renders, id);
    await mkdir(join(deck, 'rendered-pages'), { recursive: true });
    await writeFile(join(deck, 'contact-sheet.png'), PNG_A);
    for (let page = 1; page <= 8; page += 1) {
      await writeFile(join(deck, 'rendered-pages', `page-${String(page).padStart(3, '0')}.png`), PNG_A);
    }
    await writeJson(join(deck, 'render-manifest.json'), {
      slide_count: 8,
      environment: {
        marp_cli: '4.4.0',
        marp_core: '4.3.0',
        chromium: 'pinned',
        node: '20.19.4',
        platform: 'linux',
        fonts: [{ name: 'Noto Sans CJK JP', url: 'local://font', sha256: '0'.repeat(64) }],
      },
    });
  }
  run(['gold-record', '--render-root', renders, '--output', baseline]);
  run(['gold-compare', '--baseline', baseline, '--render-root', renders]);
  await writeFile(join(renders, 'technical-training', 'rendered-pages', 'page-004.png'), PNG_B);
  run(['gold-compare', '--baseline', baseline, '--render-root', renders], 1);
  const report = await json(join(renders, 'visual-regression-report.json'));
  assert.equal(report.pass, false);
  assert.ok(report.differences.some((value) => value.includes('technical-training: page 4 changed')));
});
