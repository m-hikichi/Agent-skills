#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  lstat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = resolve(SCRIPT_DIR, '..');
const SKILL_ROOT = resolve(EVAL_ROOT, '..');
const PLUGIN_ROOT = resolve(SKILL_ROOT, '../..');
const EVALS_PATH = join(EVAL_ROOT, 'evals.json');
const POLICY_PATH = join(EVAL_ROOT, 'acceptance-policy.json');
const GOLD_CATALOG_PATH = join(EVAL_ROOT, 'gold-decks.json');
const SNAPSHOT_EXCLUDES = new Set(['.git', 'node_modules', 'dist', '.slide-work']);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_VOLATILE_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME', 'eXIf']);

class HarnessError extends Error {}

function usage() {
  return `marp-slide evaluation harness

Commands:
  validate
  init --workspace <dir> --baseline-plugin <v0.8-dir> [--candidate-plugin <v1-dir>] [--iteration <n>]
  blind --workspace <dir> [--iteration <n>] [--seed <secret>]
  acceptance --workspace <dir> [--iteration <n>] [--output <file>]
  gold-record --render-root <dir> --output <manifest.json> [--replace]
  gold-compare --baseline <manifest.json> --render-root <dir> [--report <file>]

The harness never runs model generation. init creates skill-creator-compatible run
directories and immutable plugin snapshots; operators or agents populate outputs.`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new HarnessError(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    const value = next && !next.startsWith('--') ? rest[++index] : true;
    if (Object.hasOwn(options, key)) {
      options[key] = Array.isArray(options[key]) ? [...options[key], value] : [options[key], value];
    } else {
      options[key] = value;
    }
  }
  return { command, options };
}

function requiredOption(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HarnessError(`--${key} is required`);
  }
  return value;
}

function iterationNumber(options) {
  const raw = options.iteration ?? '1';
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new HarnessError('--iteration must be a positive integer');
  return value;
}

async function readJson(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new HarnessError(`cannot read ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HarnessError(`invalid JSON in ${path}: ${error.message}`);
  }
}

async function writeJson(path, value, { replace = false } = {}) {
  if (existsSync(path) && !replace) throw new HarnessError(`refusing to overwrite ${path}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function assertOutside(path, parent, label) {
  if (isWithin(parent, path)) {
    throw new HarnessError(`${label} must be outside ${parent} to avoid snapshot recursion`);
  }
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(path) {
  return sha256Buffer(await readFile(path));
}

function excludedRelativePath(rel) {
  return rel.split(/[\\/]/).some((part) => SNAPSHOT_EXCLUDES.has(part));
}

async function walkFiles(root) {
  const output = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = relative(root, full).replaceAll('\\', '/');
      if (excludedRelativePath(rel)) continue;
      if (entry.isSymbolicLink()) throw new HarnessError(`symlink is not allowed in a snapshot: ${full}`);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) output.push({ full, rel });
    }
  }
  await walk(root);
  return output;
}

async function directoryFingerprint(root) {
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new HarnessError(`not a directory: ${root}`);
  const hash = createHash('sha256');
  for (const file of await walkFiles(root)) {
    hash.update(file.rel);
    hash.update('\0');
    hash.update(await readFile(file.full));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function copySnapshot(source, target, expectedFingerprint = null) {
  const sourceFingerprint = await directoryFingerprint(source);
  if (existsSync(target)) {
    const targetFingerprint = await directoryFingerprint(target);
    if (targetFingerprint !== sourceFingerprint || (expectedFingerprint && targetFingerprint !== expectedFingerprint)) {
      throw new HarnessError(`existing snapshot differs from source: ${target}`);
    }
    return sourceFingerprint;
  }
  await cp(source, target, {
    recursive: true,
    errorOnExist: true,
    filter: (path) => {
      const rel = relative(source, path).replaceAll('\\', '/');
      return rel === '' || !excludedRelativePath(rel);
    },
  });
  const copiedFingerprint = await directoryFingerprint(target);
  if (copiedFingerprint !== sourceFingerprint) throw new HarnessError(`snapshot verification failed: ${target}`);
  return sourceFingerprint;
}

async function loadAndValidateEvals() {
  const document = await readJson(EVALS_PATH);
  const errors = [];
  if (document.skill_name !== 'main') errors.push('skill_name must match SKILL.md frontmatter: main');
  if (!Array.isArray(document.evals) || document.evals.length !== 5) errors.push('exactly five evals are required');
  const ids = new Set();
  const names = new Set();
  for (const item of document.evals ?? []) {
    if (!Number.isInteger(item.id) || item.id < 1 || ids.has(item.id)) errors.push(`invalid or duplicate eval id: ${item.id}`);
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name || names.has(item.name)) errors.push(`invalid or duplicate eval name: ${item.name}`);
    names.add(item.name);
    for (const field of ['prompt', 'expected_output']) {
      if (typeof item[field] !== 'string' || !item[field].trim()) errors.push(`eval ${item.id}: ${field} is required`);
    }
    if (!Array.isArray(item.expectations) || item.expectations.length < 1 || item.expectations.some((v) => typeof v !== 'string' || !v.trim())) {
      errors.push(`eval ${item.id}: expectations must be non-empty strings`);
    }
    if (!Array.isArray(item.files) || item.files.length < 1) errors.push(`eval ${item.id}: fixture files are required`);
    for (const rel of item.files ?? []) {
      const full = resolve(SKILL_ROOT, rel);
      if (!isWithin(SKILL_ROOT, full)) errors.push(`eval ${item.id}: fixture escapes skill root: ${rel}`);
      else if (!existsSync(full)) errors.push(`eval ${item.id}: missing fixture: ${rel}`);
    }
  }
  if (errors.length) throw new HarnessError(`eval validation failed:\n- ${errors.join('\n- ')}`);
  return document;
}

function formalResultsTemplate(item, configuration, policy) {
  const keys = new Set([
    ...policy.non_regression_checks,
    ...policy.candidate_hard_gates,
    ...(policy.case_hard_gates[String(item.id)] ?? []),
  ]);
  return {
    schema_version: 1,
    eval_id: item.id,
    configuration,
    checks: Object.fromEntries([...keys].sort().map((key) => [key, { passed: null, evidence: '' }])),
  };
}

async function initWorkspace(options) {
  const evals = await loadAndValidateEvals();
  const policy = await readJson(POLICY_PATH);
  const workspace = resolve(requiredOption(options, 'workspace'));
  const baselinePlugin = resolve(requiredOption(options, 'baseline-plugin'));
  const candidatePlugin = resolve(options['candidate-plugin'] ?? PLUGIN_ROOT);
  const iteration = iterationNumber(options);
  assertOutside(workspace, baselinePlugin, 'workspace');
  assertOutside(workspace, candidatePlugin, 'workspace');

  const iterationDir = join(workspace, `iteration-${iteration}`);
  if (existsSync(iterationDir)) throw new HarnessError(`iteration already exists: ${iterationDir}`);
  await mkdir(workspace, { recursive: true });

  const baselineSnapshot = join(workspace, 'skill-snapshot');
  const candidateSnapshot = join(workspace, `candidate-snapshot-${iteration}`);
  const baselineFingerprint = await copySnapshot(baselinePlugin, baselineSnapshot);
  const candidateFingerprint = await copySnapshot(candidatePlugin, candidateSnapshot);
  await mkdir(iterationDir, { recursive: false });

  const evalRecords = [];
  for (const item of evals.evals) {
    const evalName = `eval-${String(item.id).padStart(2, '0')}-${slug(item.name)}`;
    const evalDir = join(iterationDir, evalName);
    const inputDir = join(evalDir, 'inputs');
    await mkdir(inputDir, { recursive: true });
    const stagedInputs = [];
    for (const rel of item.files) {
      const source = resolve(SKILL_ROOT, rel);
      const target = join(inputDir, basename(source));
      if (existsSync(target)) throw new HarnessError(`fixture filename collision in eval ${item.id}: ${basename(source)}`);
      await copyFile(source, target);
      stagedInputs.push(relative(evalDir, target).replaceAll('\\', '/'));
    }
    await writeJson(join(evalDir, 'eval_metadata.json'), {
      eval_id: item.id,
      eval_name: item.name,
      prompt: item.prompt,
      assertions: item.expectations,
      input_files: stagedInputs,
      expected_output: item.expected_output,
    });

    for (const configuration of ['with_skill', 'without_skill']) {
      const runDir = join(evalDir, configuration, 'run-1');
      const outputDir = join(runDir, 'outputs');
      await mkdir(outputDir, { recursive: true });
      const pluginSnapshot = configuration === 'with_skill' ? candidateSnapshot : baselineSnapshot;
      await writeJson(join(runDir, 'run-spec.json'), {
        schema_version: 1,
        eval_id: item.id,
        eval_name: item.name,
        configuration,
        plugin_path: pluginSnapshot,
        skill_path: join(pluginSnapshot, 'skills', 'main'),
        task: item.prompt,
        input_files: stagedInputs.map((file) => resolve(evalDir, file)),
        output_dir: outputDir,
        required_visual_outputs: {
          pdf: 'outputs/deck.pdf',
          contact_sheet: 'outputs/contact-sheet.png',
          pages: 'outputs/page-001.png ...',
        },
      });
      await writeJson(join(runDir, 'eval_metadata.json'), {
        eval_id: item.id,
        eval_name: item.name,
        prompt: item.prompt,
        assertions: item.expectations,
      });
      await writeJson(join(runDir, 'formal-results.json'), formalResultsTemplate(item, configuration, policy));
      await writeFile(join(runDir, 'OUTPUTS.md'), [
        '# Run output contract',
        '',
        'Save the rendered PDF as `outputs/deck.pdf`, the contact sheet as `outputs/contact-sheet.png`,',
        'and every 2x page as consecutive `outputs/page-001.png`, `page-002.png`, and so on.',
        'Keep source, manifests, QA, review, and revision history under `outputs/evidence/`.',
        'After independent grading, complete `formal-results.json`, write skill-creator `grading.json`,',
        'and capture executor timing in `timing.json`.',
        '',
      ].join('\n'), 'utf8');
    }
    evalRecords.push({ eval_id: item.id, eval_name: item.name, directory: evalName });
  }

  const manifest = {
    schema_version: 1,
    skill_name: evals.skill_name,
    iteration,
    generated_at: new Date().toISOString(),
    evals_sha256: await sha256File(EVALS_PATH),
    policy_sha256: await sha256File(POLICY_PATH),
    snapshots: {
      without_skill: { path: baselineSnapshot, sha256: baselineFingerprint },
      with_skill: { path: candidateSnapshot, sha256: candidateFingerprint },
    },
    evals: evalRecords,
  };
  await writeJson(join(iterationDir, 'run-manifest.json'), manifest);
  return { workspace, iteration_dir: iterationDir, eval_count: evalRecords.length, snapshots: manifest.snapshots };
}

function parsePng(buffer, label) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HarnessError(`invalid PNG: ${label}`);
  let offset = 8;
  let width = null;
  let height = null;
  let hasIend = false;
  const chunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new HarnessError(`truncated PNG chunk: ${label}`);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const full = buffer.subarray(offset, end);
    if (type === 'IHDR') {
      if (length !== 13) throw new HarnessError(`invalid IHDR: ${label}`);
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    }
    if (!PNG_VOLATILE_CHUNKS.has(type)) chunks.push(full);
    offset = end;
    if (type === 'IEND') {
      hasIend = true;
      break;
    }
  }
  if (!width || !height || !hasIend) throw new HarnessError(`PNG is missing required structure: ${label}`);
  return { width, height, normalized: Buffer.concat([PNG_SIGNATURE, ...chunks]) };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonalDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonalDistance) return left;
  if (upDistance <= diagonalDistance) return up;
  return upperLeft;
}

function blendWhite(channel, alpha) {
  return Math.round((channel * alpha + 255 * (255 - alpha)) / 255);
}

function decodePngRgb(buffer, label) {
  const parsed = parsePng(buffer, label);
  let offset = 8;
  let bitDepth = null;
  let colorType = null;
  let interlace = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new HarnessError(`anonymous PDF supports only non-interlaced 8-bit PNG: ${label}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new HarnessError(`unsupported PNG color type ${colorType}: ${label}`);
  if (colorType === 3 && (!palette || palette.length % 3 !== 0)) throw new HarnessError(`indexed PNG has no valid palette: ${label}`);
  if (!idat.length) throw new HarnessError(`PNG has no IDAT: ${label}`);

  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch (error) {
    throw new HarnessError(`cannot inflate PNG for anonymous PDF (${label}): ${error.message}`);
  }
  const rowBytes = parsed.width * channels;
  const expected = (rowBytes + 1) * parsed.height;
  if (inflated.length !== expected) throw new HarnessError(`unexpected PNG scanline size: ${label}`);
  const rgb = Buffer.allocUnsafe(parsed.width * parsed.height * 3);
  let inputOffset = 0;
  let outputOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  for (let row = 0; row < parsed.height; row += 1) {
    const filter = inflated[inputOffset++];
    if (filter > 4) throw new HarnessError(`unsupported PNG filter ${filter}: ${label}`);
    const current = Buffer.allocUnsafe(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const raw = inflated[inputOffset++];
      const left = index >= channels ? current[index - channels] : 0;
      const up = previous[index];
      const upperLeft = index >= channels ? previous[index - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft);
      current[index] = (raw + predictor) & 0xff;
    }
    for (let pixel = 0; pixel < parsed.width; pixel += 1) {
      const source = pixel * channels;
      if (colorType === 0) {
        rgb[outputOffset++] = current[source];
        rgb[outputOffset++] = current[source];
        rgb[outputOffset++] = current[source];
      } else if (colorType === 2) {
        rgb[outputOffset++] = current[source];
        rgb[outputOffset++] = current[source + 1];
        rgb[outputOffset++] = current[source + 2];
      } else if (colorType === 3) {
        const paletteIndex = current[source];
        const paletteOffset = paletteIndex * 3;
        if (paletteOffset + 2 >= palette.length) throw new HarnessError(`PNG palette index is out of range: ${label}`);
        const alpha = transparency?.[paletteIndex] ?? 255;
        rgb[outputOffset++] = blendWhite(palette[paletteOffset], alpha);
        rgb[outputOffset++] = blendWhite(palette[paletteOffset + 1], alpha);
        rgb[outputOffset++] = blendWhite(palette[paletteOffset + 2], alpha);
      } else if (colorType === 4) {
        const alpha = current[source + 1];
        const gray = blendWhite(current[source], alpha);
        rgb[outputOffset++] = gray;
        rgb[outputOffset++] = gray;
        rgb[outputOffset++] = gray;
      } else {
        const alpha = current[source + 3];
        rgb[outputOffset++] = blendWhite(current[source], alpha);
        rgb[outputOffset++] = blendWhite(current[source + 1], alpha);
        rgb[outputOffset++] = blendWhite(current[source + 2], alpha);
      }
    }
    previous = current;
  }
  return { width: parsed.width, height: parsed.height, rgb };
}

function pdfNumber(value) {
  return Number(value.toFixed(4)).toString();
}

function buildAnonymousPdf(images) {
  const parts = [];
  const offsets = [0];
  let length = 0;
  const append = (value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'ascii');
    parts.push(buffer);
    length += buffer.length;
  };
  const object = (number, ...body) => {
    offsets[number] = length;
    append(`${number} 0 obj\n`);
    for (const value of body) append(value);
    append('\nendobj\n');
  };

  append(Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'));
  const pageObjects = images.map((_, index) => 3 + index * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${images.length} /Kids [${pageObjects.map((number) => `${number} 0 R`).join(' ')}] >>`);
  for (const [index, image] of images.entries()) {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const pageWidth = 960;
    const pageHeight = pageWidth * image.height / image.width;
    object(pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(pageWidth)} ${pdfNumber(pageHeight)}] `
      + `/Resources << /XObject << /Slide ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    const compressed = deflateSync(image.rgb, { level: 9 });
    image.rgb = null;
    object(imageObject,
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
      compressed,
      '\nendstream');
    const drawing = Buffer.from(`q\n${pdfNumber(pageWidth)} 0 0 ${pdfNumber(pageHeight)} 0 0 cm\n/Slide Do\nQ\n`, 'ascii');
    object(contentObject, `<< /Length ${drawing.length} >>\nstream\n`, drawing, 'endstream');
  }
  const xrefOffset = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let number = 1; number < offsets.length; number += 1) {
    append(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  }
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(parts);
}

async function pngRecord(path) {
  const buffer = await readFile(path);
  const parsed = parsePng(buffer, path);
  return {
    width: parsed.width,
    height: parsed.height,
    sha256: sha256Buffer(buffer),
    normalized_png_sha256: sha256Buffer(parsed.normalized),
    normalized: parsed.normalized,
  };
}

async function discoverPages(outputDir) {
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  const pages = entries
    .filter((entry) => entry.isFile() && /^page-(\d+)\.png$/i.test(entry.name))
    .map((entry) => ({
      number: Number(/^page-(\d+)\.png$/i.exec(entry.name)[1]),
      path: join(outputDir, entry.name),
    }))
    .sort((a, b) => a.number - b.number);
  if (!pages.length) throw new HarnessError(`no page PNGs found in ${outputDir}`);
  pages.forEach((page, index) => {
    if (page.number !== index + 1) throw new HarnessError(`page PNGs are not consecutive in ${outputDir}`);
  });
  return pages;
}

async function validateVisualSubmission(runDir) {
  const outputDir = join(runDir, 'outputs');
  const pdf = join(outputDir, 'deck.pdf');
  const contact = join(outputDir, 'contact-sheet.png');
  if (!(await stat(pdf).catch(() => null))?.isFile()) throw new HarnessError(`missing PDF: ${pdf}`);
  if (!(await stat(contact).catch(() => null))?.isFile()) throw new HarnessError(`missing contact sheet: ${contact}`);
  const pdfBytes = await readFile(pdf);
  if (!pdfBytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii')) || !pdfBytes.subarray(-32).toString('latin1').includes('%%EOF')) {
    throw new HarnessError(`invalid PDF envelope: ${pdf}`);
  }
  const pages = await discoverPages(outputDir);
  const contactRecord = await pngRecord(contact);
  let pageDimensions = null;
  for (const page of pages) {
    const record = await pngRecord(page.path);
    if (record.width < 2400 || record.height < 1350) {
      throw new HarnessError(`review PNG is not a 2x Marp page (${record.width}x${record.height}): ${page.path}`);
    }
    const dimensions = `${record.width}x${record.height}`;
    if (pageDimensions && pageDimensions !== dimensions) throw new HarnessError(`page PNG dimensions differ in ${outputDir}`);
    pageDimensions = dimensions;
  }
  return { outputDir, pdf, contact, pages, contactRecord };
}

function balancedCandidateASides(seed, evalIds) {
  const ranked = [...evalIds].sort((left, right) => {
    const leftHash = sha256Buffer(Buffer.from(`${seed}:${left}`));
    const rightHash = sha256Buffer(Buffer.from(`${seed}:${right}`));
    return leftHash.localeCompare(rightHash);
  });
  const extra = createHash('sha256').update(seed).digest()[0] % 2;
  return new Set(ranked.slice(0, Math.floor(evalIds.length / 2) + extra));
}

async function copyAnonymousSubmission(submission, target, leakTokens) {
  await mkdir(join(target, 'pages'), { recursive: true });

  const contact = await pngRecord(submission.contact);
  await writeFile(join(target, 'contact-sheet.png'), contact.normalized);
  const pageRecords = [];
  const pdfImages = [];
  for (const [index, page] of submission.pages.entries()) {
    const source = await readFile(page.path);
    const parsed = parsePng(source, page.path);
    const record = {
      width: parsed.width,
      height: parsed.height,
      normalized_png_sha256: sha256Buffer(parsed.normalized),
      normalized: parsed.normalized,
    };
    const name = `page-${String(index + 1).padStart(3, '0')}.png`;
    await writeFile(join(target, 'pages', name), record.normalized);
    pdfImages.push(decodePngRgb(record.normalized, page.path));
    pageRecords.push({
      page: index + 1,
      file: `pages/${name}`,
      width: record.width,
      height: record.height,
      sha256: record.normalized_png_sha256,
    });
  }
  const pdf = buildAnonymousPdf(pdfImages);
  const pdfText = pdf.toString('latin1').toLowerCase();
  const leak = leakTokens.find((token) => pdfText.includes(token.toLowerCase()));
  if (leak) throw new HarnessError(`anonymous PDF contains a configuration leak token '${leak}'`);
  await writeFile(join(target, 'deck.pdf'), pdf);
  const bundle = {
    schema_version: 1,
    pdf: { file: 'deck.pdf', sha256: sha256Buffer(pdf) },
    contact_sheet: {
      file: 'contact-sheet.png',
      width: contact.width,
      height: contact.height,
      sha256: contact.normalized_png_sha256,
    },
    page_count: pageRecords.length,
    pages: pageRecords,
  };
  await writeJson(join(target, 'bundle-manifest.json'), bundle);
  return bundle;
}

function reviewTemplate(item, policy) {
  const emptyScores = Object.fromEntries(policy.blind_dimensions.map((dimension) => [dimension, null]));
  return {
    schema_version: 1,
    eval_id: item.eval_id,
    eval_name: item.eval_name,
    reviewer_id: '',
    preferred: null,
    scores: { A: { ...emptyScores }, B: { ...emptyScores } },
    reasoning: '',
    page_notes: [],
  };
}

async function createBlindPackage(options) {
  const workspace = resolve(requiredOption(options, 'workspace'));
  const iteration = iterationNumber(options);
  const iterationDir = join(workspace, `iteration-${iteration}`);
  const runManifest = await readJson(join(iterationDir, 'run-manifest.json'));
  const policy = await readJson(POLICY_PATH);
  const evalDefinitions = await loadAndValidateEvals();
  const blindDir = join(iterationDir, 'blind-review');
  if (existsSync(blindDir)) throw new HarnessError(`blind package already exists: ${blindDir}`);
  const seed = typeof options.seed === 'string' ? options.seed : randomBytes(32).toString('hex');
  const leakTokens = [
    'with_skill',
    'without_skill',
    'skill-snapshot',
    'candidate-snapshot',
    ...Object.values(runManifest.snapshots ?? {}).map((snapshot) => basename(snapshot.path ?? '')).filter(Boolean),
  ];
  const assignments = [];
  const index = [];
  const candidateASides = balancedCandidateASides(seed, runManifest.evals.map((item) => item.eval_id));

  for (const item of runManifest.evals) {
    const evalDir = join(iterationDir, item.directory);
    const submissions = {
      with_skill: await validateVisualSubmission(join(evalDir, 'with_skill', 'run-1')),
      without_skill: await validateVisualSubmission(join(evalDir, 'without_skill', 'run-1')),
    };
    const candidateIsA = candidateASides.has(item.eval_id);
    const labels = candidateIsA
      ? { A: 'with_skill', B: 'without_skill' }
      : { A: 'without_skill', B: 'with_skill' };
    const targetEval = join(blindDir, item.directory);
    await mkdir(targetEval, { recursive: true });
    const definition = evalDefinitions.evals.find((entry) => entry.id === item.eval_id);
    if (!definition) throw new HarnessError(`missing eval definition for ${item.eval_id}`);
    await writeJson(join(targetEval, 'task.json'), {
      eval_id: definition.id,
      eval_name: definition.name,
      prompt: definition.prompt,
      expected_output: definition.expected_output,
      visual_review_dimensions: policy.blind_dimensions,
    });
    for (const label of ['A', 'B']) {
      await copyAnonymousSubmission(submissions[labels[label]], join(targetEval, label), leakTokens);
    }
    await writeJson(join(targetEval, 'review.json'), reviewTemplate(item, policy));
    assignments.push({ eval_id: item.eval_id, eval_name: item.eval_name, labels });
    index.push({ eval_id: item.eval_id, eval_name: item.eval_name, directory: item.directory });
  }
  await writeJson(join(blindDir, 'index.json'), {
    schema_version: 1,
    iteration,
    rubric_dimensions: policy.blind_dimensions,
    evals: index,
  });
  const privateDir = join(workspace, '_private');
  await mkdir(privateDir, { recursive: true });
  const mappingPath = join(privateDir, `blind-map.iteration-${iteration}.json`);
  await writeJson(mappingPath, {
    schema_version: 1,
    iteration,
    seed_sha256: sha256Buffer(Buffer.from(seed)),
    assignments,
  });
  return { blind_dir: blindDir, mapping: mappingPath, eval_count: assignments.length };
}

function validateCompletedReview(review, policy, label) {
  const errors = [];
  if (!['A', 'B', 'TIE'].includes(review.preferred)) errors.push(`${label}: preferred must be A, B, or TIE`);
  if (typeof review.reviewer_id !== 'string' || !review.reviewer_id.trim()) errors.push(`${label}: reviewer_id is required`);
  if (typeof review.reasoning !== 'string' || !review.reasoning.trim()) errors.push(`${label}: reasoning is required`);
  for (const side of ['A', 'B']) {
    for (const dimension of policy.blind_dimensions) {
      const score = review.scores?.[side]?.[dimension];
      if (!Number.isInteger(score) || score < 1 || score > 5) errors.push(`${label}: ${side}.${dimension} must be 1..5`);
    }
  }
  return errors;
}

async function readFormalResults(path, evalId, configuration, requiredChecks) {
  const value = await readJson(path);
  const errors = [];
  if (value.schema_version !== 1) errors.push(`${path}: schema_version must be 1`);
  if (value.eval_id !== evalId) errors.push(`${path}: eval_id mismatch`);
  if (value.configuration !== configuration) errors.push(`${path}: configuration mismatch`);
  for (const key of requiredChecks) {
    const check = value.checks?.[key];
    if (typeof check?.passed !== 'boolean') errors.push(`${path}: ${key}.passed must be boolean`);
    if (typeof check?.evidence !== 'string' || !check.evidence.trim()) errors.push(`${path}: ${key}.evidence is required`);
  }
  return { value, errors };
}

async function evaluateAcceptance(options) {
  const workspace = resolve(requiredOption(options, 'workspace'));
  const iteration = iterationNumber(options);
  const iterationDir = join(workspace, `iteration-${iteration}`);
  const policy = await readJson(POLICY_PATH);
  const runManifest = await readJson(join(iterationDir, 'run-manifest.json'));
  const mapping = await readJson(join(workspace, '_private', `blind-map.iteration-${iteration}.json`));
  const issues = [];
  const cases = [];
  let candidatePreferences = 0;

  for (const item of runManifest.evals) {
    const assignment = mapping.assignments.find((entry) => entry.eval_id === item.eval_id);
    if (!assignment) {
      issues.push(`eval ${item.eval_id}: missing blind assignment`);
      continue;
    }
    const reviewPath = join(iterationDir, 'blind-review', item.directory, 'review.json');
    const review = await readJson(reviewPath);
    issues.push(...validateCompletedReview(review, policy, reviewPath));
    const candidateLabel = assignment.labels.A === 'with_skill' ? 'A' : 'B';
    const baselineLabel = candidateLabel === 'A' ? 'B' : 'A';
    const candidatePreferred = review.preferred === candidateLabel;
    if (candidatePreferred) candidatePreferences += 1;

    const required = new Set([
      ...policy.non_regression_checks,
      ...policy.candidate_hard_gates,
      ...(policy.case_hard_gates[String(item.eval_id)] ?? []),
    ]);
    const candidate = await readFormalResults(
      join(iterationDir, item.directory, 'with_skill', 'run-1', 'formal-results.json'),
      item.eval_id,
      'with_skill',
      required,
    );
    const baseline = await readFormalResults(
      join(iterationDir, item.directory, 'without_skill', 'run-1', 'formal-results.json'),
      item.eval_id,
      'without_skill',
      required,
    );
    issues.push(...candidate.errors, ...baseline.errors);
    for (const key of [...policy.candidate_hard_gates, ...(policy.case_hard_gates[String(item.eval_id)] ?? [])]) {
      if (candidate.value.checks?.[key]?.passed !== true) issues.push(`eval ${item.eval_id}: candidate hard gate failed: ${key}`);
    }
    for (const key of policy.non_regression_checks) {
      if (baseline.value.checks?.[key]?.passed === true && candidate.value.checks?.[key]?.passed !== true) {
        issues.push(`eval ${item.eval_id}: regression in ${key}`);
      }
    }
    cases.push({
      eval_id: item.eval_id,
      eval_name: item.eval_name,
      candidate_label: candidateLabel,
      baseline_label: baselineLabel,
      preferred: review.preferred,
      candidate_preferred: candidatePreferred,
      candidate_mean_score: policy.blind_dimensions.reduce((sum, key) => sum + (review.scores?.[candidateLabel]?.[key] ?? 0), 0) / policy.blind_dimensions.length,
      baseline_mean_score: policy.blind_dimensions.reduce((sum, key) => sum + (review.scores?.[baselineLabel]?.[key] ?? 0), 0) / policy.blind_dimensions.length,
      reasoning: review.reasoning,
    });
  }
  if (candidatePreferences < policy.minimum_candidate_preferences) {
    issues.push(`candidate preferred in ${candidatePreferences}/${runManifest.evals.length}; required ${policy.minimum_candidate_preferences}/${runManifest.evals.length}`);
  }
  const report = {
    schema_version: 1,
    iteration,
    generated_at: new Date().toISOString(),
    pass: issues.length === 0,
    candidate_preferences: candidatePreferences,
    required_candidate_preferences: policy.minimum_candidate_preferences,
    cases,
    issues,
  };
  const output = resolve(options.output ?? join(iterationDir, 'acceptance-report.json'));
  await writeJson(output, report, { replace: true });
  if (!report.pass) throw new HarnessError(`acceptance failed; see ${output}`);
  return report;
}

async function inputFingerprint(catalog) {
  const records = [];
  for (const rel of catalog.shared_inputs ?? []) {
    const full = resolve(SKILL_ROOT, rel);
    if (!isWithin(SKILL_ROOT, full)) throw new HarnessError(`gold shared input escapes skill root: ${rel}`);
    const info = await lstat(full).catch(() => null);
    if (!info) throw new HarnessError(`missing gold shared input: ${rel}`);
    records.push({
      deck: '_shared',
      field: 'shared_input',
      path: rel,
      sha256: info.isDirectory() ? await directoryFingerprint(full) : await sha256File(full),
    });
  }
  for (const deck of catalog.decks) {
    for (const field of ['source', 'theme', 'assets']) {
      const full = resolve(SKILL_ROOT, deck[field]);
      if (!isWithin(SKILL_ROOT, full)) throw new HarnessError(`gold input escapes skill root: ${deck[field]}`);
      const info = await lstat(full).catch(() => null);
      if (!info) throw new HarnessError(`missing gold input: ${deck[field]}`);
      records.push({
        deck: deck.id,
        field,
        path: deck[field],
        sha256: info.isDirectory() ? await directoryFingerprint(full) : await sha256File(full),
      });
    }
  }
  return { sha256: sha256Buffer(Buffer.from(stableStringify(records))), files: records };
}

async function firstExisting(paths, type = 'file') {
  for (const path of paths) {
    const info = await stat(path).catch(() => null);
    if (type === 'file' ? info?.isFile() : info?.isDirectory()) return path;
  }
  return null;
}

async function collectGold(renderRoot) {
  const catalog = await readJson(GOLD_CATALOG_PATH);
  if (!Array.isArray(catalog.decks) || catalog.decks.length !== 3) throw new HarnessError('gold catalog must define three decks');
  const inputs = await inputFingerprint(catalog);
  const decks = [];
  for (const deck of catalog.decks) {
    const root = join(renderRoot, deck.id);
    const manifestPath = await firstExisting([
      join(root, 'render-manifest.json'),
      join(root, '.slide-work', 'render-manifest.json'),
    ]);
    if (!manifestPath) throw new HarnessError(`missing render manifest for gold deck ${deck.id}`);
    const renderManifest = await readJson(manifestPath);
    if (!renderManifest.environment || typeof renderManifest.environment !== 'object') {
      throw new HarnessError(`gold render manifest has no environment: ${manifestPath}`);
    }
    for (const field of catalog.environment_fields ?? []) {
      if (!Object.hasOwn(renderManifest.environment, field)) {
        throw new HarnessError(`gold render environment is missing ${field}: ${manifestPath}`);
      }
    }
    if (renderManifest.slide_count !== deck.expected_slide_count) {
      throw new HarnessError(`${deck.id}: render manifest slide_count is ${renderManifest.slide_count}, expected ${deck.expected_slide_count}`);
    }
    const pagesDir = await firstExisting([
      join(root, 'rendered-pages'),
      join(root, 'pages'),
      join(root, '.slide-work', 'rendered-pages'),
    ], 'directory');
    if (!pagesDir) throw new HarnessError(`missing rendered pages for gold deck ${deck.id}`);
    const entries = (await readdir(pagesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^page-(\d+)\.png$/i.test(entry.name))
      .map((entry) => ({ number: Number(/^page-(\d+)\.png$/i.exec(entry.name)[1]), path: join(pagesDir, entry.name) }))
      .sort((a, b) => a.number - b.number);
    if (entries.length !== deck.expected_slide_count) {
      throw new HarnessError(`${deck.id}: expected ${deck.expected_slide_count} pages, found ${entries.length}`);
    }
    entries.forEach((entry, index) => {
      if (entry.number !== index + 1) throw new HarnessError(`${deck.id}: pages are not consecutive`);
    });
    const contactPath = await firstExisting([
      join(root, 'contact-sheet.png'),
      join(root, '.slide-work', 'contact-sheet.png'),
    ]);
    if (!contactPath) throw new HarnessError(`missing contact sheet for gold deck ${deck.id}`);
    const pages = [];
    for (const entry of entries) {
      const record = await pngRecord(entry.path);
      if (record.width < 2400 || record.height < 1350) {
        throw new HarnessError(`${deck.id}: page ${entry.number} is not a 2x Marp image (${record.width}x${record.height})`);
      }
      pages.push({
        page: entry.number,
        width: record.width,
        height: record.height,
        normalized_png_sha256: record.normalized_png_sha256,
      });
    }
    const contact = await pngRecord(contactPath);
    decks.push({
      id: deck.id,
      slide_count: pages.length,
      environment: stableValue(renderManifest.environment),
      pages,
      contact_sheet: {
        width: contact.width,
        height: contact.height,
        normalized_png_sha256: contact.normalized_png_sha256,
      },
    });
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    catalog_sha256: await sha256File(GOLD_CATALOG_PATH),
    input_fingerprint: inputs,
    decks,
  };
}

async function recordGold(options) {
  const renderRoot = resolve(requiredOption(options, 'render-root'));
  const output = resolve(requiredOption(options, 'output'));
  const manifest = await collectGold(renderRoot);
  await writeJson(output, manifest, { replace: options.replace === true });
  return { output, decks: manifest.decks.length, input_fingerprint: manifest.input_fingerprint.sha256 };
}

async function compareGold(options) {
  const baselinePath = resolve(requiredOption(options, 'baseline'));
  const renderRoot = resolve(requiredOption(options, 'render-root'));
  const baseline = await readJson(baselinePath);
  const current = await collectGold(renderRoot);
  const differences = [];
  if (baseline.catalog_sha256 !== current.catalog_sha256) differences.push('gold catalog changed');
  if (baseline.input_fingerprint?.sha256 !== current.input_fingerprint.sha256) differences.push('gold source/theme/assets changed');
  for (const baselineDeck of baseline.decks ?? []) {
    const currentDeck = current.decks.find((deck) => deck.id === baselineDeck.id);
    if (!currentDeck) {
      differences.push(`${baselineDeck.id}: missing deck`);
      continue;
    }
    if (stableStringify(baselineDeck.environment) !== stableStringify(currentDeck.environment)) {
      differences.push(`${baselineDeck.id}: render environment changed`);
    }
    if (baselineDeck.slide_count !== currentDeck.slide_count) differences.push(`${baselineDeck.id}: slide count changed`);
    for (const baselinePage of baselineDeck.pages ?? []) {
      const page = currentDeck.pages.find((entry) => entry.page === baselinePage.page);
      if (!page) differences.push(`${baselineDeck.id}: missing page ${baselinePage.page}`);
      else if (stableStringify(baselinePage) !== stableStringify(page)) differences.push(`${baselineDeck.id}: page ${baselinePage.page} changed`);
    }
    if (stableStringify(baselineDeck.contact_sheet) !== stableStringify(currentDeck.contact_sheet)) {
      differences.push(`${baselineDeck.id}: contact sheet changed`);
    }
  }
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    pass: differences.length === 0,
    baseline: baselinePath,
    render_root: renderRoot,
    differences,
  };
  const reportPath = resolve(options.report ?? join(renderRoot, 'visual-regression-report.json'));
  await writeJson(reportPath, report, { replace: true });
  if (!report.pass) throw new HarnessError(`visual regression failed; see ${reportPath}`);
  return report;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  let result;
  switch (command) {
    case 'validate':
      result = { valid: true, eval_count: (await loadAndValidateEvals()).evals.length };
      break;
    case 'init':
      result = await initWorkspace(options);
      break;
    case 'blind':
      result = await createBlindPackage(options);
      break;
    case 'acceptance':
      result = await evaluateAcceptance(options);
      break;
    case 'gold-record':
      result = await recordGold(options);
      break;
    case 'gold-compare':
      result = await compareGold(options);
      break;
    case undefined:
    case 'help':
      process.stdout.write(`${usage()}\n`);
      return;
    default:
      throw new HarnessError(`unknown command: ${command}\n\n${usage()}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof HarnessError ? 'evaluation error' : 'unexpected error'}: ${error.message}\n`);
  process.exitCode = 1;
});
