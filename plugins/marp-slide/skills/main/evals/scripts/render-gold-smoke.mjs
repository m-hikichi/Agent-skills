#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const [pluginRoot, outputRoot, deckFilter] = process.argv.slice(2);
if (!pluginRoot || !outputRoot) {
  throw new Error('usage: render-gold-smoke.mjs <plugin-root> <output-root>');
}

const { renderDeck } = await import(process.env.MARP_RENDERING_MODULE ?? '/app/dist/rendering.js');
const mainRoot = path.join(pluginRoot, 'skills', 'main');
const config = JSON.parse(await readFile(path.join(mainRoot, 'evals', 'gold-decks.json'), 'utf8'));
const selectedDecks = deckFilter
  ? config.decks.filter((deck) => deck.id === deckFilter)
  : config.decks;
if (selectedDecks.length === 0) throw new Error(`unknown gold deck: ${deckFilter}`);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function imageUses(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let frontmatterClosed = lines[0]?.replace(/^\uFEFF/, '') !== '---';
  let slide = 1;
  const uses = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!frontmatterClosed) {
      if (index > 0 && line.trim() === '---') frontmatterClosed = true;
      continue;
    }
    if (line.trim() === '---') {
      slide += 1;
      continue;
    }
    for (const match of line.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
      const target = match[2] ?? match[3];
      const current = uses.get(target) ?? { alt: match[1], pages: new Set() };
      current.pages.add(slide);
      uses.set(target, current);
    }
  }
  return uses;
}

async function buildAssetManifest(workspace, markdown) {
  const assets = [];
  let sequence = 1;
  for (const [target, use] of imageUses(markdown)) {
    const assetPath = path.join(workspace, 'slides', target);
    const stem = path.basename(assetPath, path.extname(assetPath));
    const sources = path.join(workspace, 'slides', 'assets', 'sources');
    const vegaSpec = path.join(sources, `${stem}.vl.json`);
    const csv = path.join(sources, `${stem}.csv`);
    const mermaid = path.join(sources, `${stem}.mmd`);
    let source = { kind: 'generated', path: null, url: null };
    let generator = { kind: 'other', spec_path: null, model: null, prompt_sha256: null };
    let type = 'illustration';
    if (existsSync(vegaSpec) && existsSync(csv)) {
      source = { kind: 'data', path: relative(workspace, csv), url: null };
      generator = {
        kind: 'vega-lite',
        spec_path: relative(workspace, vegaSpec),
        model: null,
        prompt_sha256: null,
      };
      type = 'chart';
    } else if (existsSync(mermaid)) {
      source = { kind: 'data', path: relative(workspace, mermaid), url: null };
      generator = {
        kind: 'mermaid',
        spec_path: relative(workspace, mermaid),
        model: null,
        prompt_sha256: null,
      };
      type = 'diagram';
    }
    assets.push({
      id: `G-${String(sequence).padStart(3, '0')}`,
      path: relative(workspace, assetPath),
      pages: [...use.pages].sort((a, b) => a - b),
      type,
      source,
      license: null,
      alt: use.alt,
      decorative: false,
      crop: null,
      generator,
      sha256: sha256(await readFile(assetPath)),
    });
    sequence += 1;
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    assets,
  };
}

function requestYaml(deck) {
  const deliveryMode = deck.id === 'analytical-read-ahead' ? 'read-ahead' : 'hybrid';
  return `topic: ${deck.id} gold regression\n` +
    `audience: marp-slide maintainers\n` +
    `presentation_type: gold-deck\n` +
    `goal: rendererとvisual QAの回帰を検出する\n` +
    `target_slide_count: ${deck.expected_slide_count}\n` +
    `slide_count_mode: exact\n` +
    `delivery_mode: ${deliveryMode}\n` +
    `output_formats:\n  - pdf\n  - png\n  - notes\n` +
    `must_include: []\nsource_materials: []\n` +
    `language: ja-JP\nauthor: agent-skills\n` +
    `approval_mode: autonomous\nimage_policy: local-only\n` +
    `brand_strictness: guided\naccessibility_target: standard\n`;
}

await mkdir(outputRoot, { recursive: true });
const results = [];
for (const deck of selectedDecks) {
  const workspace = path.join(outputRoot, deck.id);
  const slides = path.join(workspace, 'slides');
  const work = path.join(workspace, '.slide-work');
  await mkdir(slides, { recursive: true });
  await mkdir(work, { recursive: true });

  const source = path.join(mainRoot, deck.source);
  const theme = path.join(mainRoot, deck.theme);
  const markdown = await readFile(source, 'utf8');
  await writeFile(path.join(slides, 'presentation.md'), markdown);
  await writeFile(path.join(slides, 'theme.css'), await readFile(theme));
  await cp(path.join(mainRoot, deck.assets), path.join(slides, 'assets'), { recursive: true });
  await writeFile(path.join(work, 'request.yaml'), requestYaml(deck));
  await writeFile(
    path.join(work, 'asset-manifest.json'),
    `${JSON.stringify(await buildAssetManifest(workspace, markdown), null, 2)}\n`,
  );

  const renderInput = {
    source: 'slides/presentation.md',
    theme: 'slides/theme.css',
    formats: ['pdf', 'png'],
    output_dir: '.slide-work',
    image_scale: 2,
  };
  const first = await renderDeck(workspace, renderInput);
  const prior = first.manifest;
  prior.improvements = [{
    iteration: 2,
    description: 'render 1の全ページPNGとcontact sheetを確認し、最終候補を同一条件で再検証',
    slides: [1],
  }];
  await writeFile(path.join(work, 'render-manifest.json'), `${JSON.stringify(prior, null, 2)}\n`);
  const second = await renderDeck(workspace, renderInput);

  const failures = [];
  if (second.manifest.slide_count !== deck.expected_slide_count) failures.push('slide count');
  if (second.manifest.page_images.length !== deck.expected_slide_count) failures.push('PNG count');
  if (second.manifest.render_iteration !== 2) failures.push('render iteration');
  if (second.manifest.improvements.length < 1) failures.push('improvement history');
  if (!second.manifest.contact_sheet) failures.push('contact sheet');
  if (!second.manifest.formats.includes('notes')) failures.push('notes format');
  if (second.machine_qa.status !== 'pass') failures.push('machine QA');
  if (failures.length) {
    throw new Error(`${deck.id} failed: ${failures.join(', ')}\n${JSON.stringify(second.machine_qa, null, 2)}`);
  }
  results.push({
    id: deck.id,
    workspace,
    slide_count: second.manifest.slide_count,
    render_iteration: second.manifest.render_iteration,
    machine_qa: second.machine_qa.status,
    page_size: `${second.manifest.page_images[0].width}x${second.manifest.page_images[0].height}`,
    contact_sheet: second.manifest.contact_sheet.path,
    pdf: second.manifest.outputs.find((item) => item.format === 'pdf')?.path ?? null,
    notes: second.manifest.outputs.find((item) => item.format === 'notes')?.path ?? null,
  });
}

process.stdout.write(`${JSON.stringify({ ok: true, output_root: outputRoot, results }, null, 2)}\n`);
