import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUBRIC_VERSION = 3;
export const RENDER_SCHEMA_VERSION = 1;
export const STATE_SCHEMA_VERSION = 1;
export const REQUIRED_MARP_CLI_VERSION = '4.4.0';
export const REQUIRED_MARP_CORE_VERSION = '4.3.0';

export const DEFAULTS = Object.freeze({
  source: 'slides/presentation.md',
  theme: 'slides/theme.css',
  request: '.slide-work/request.yaml',
  assetManifest: '.slide-work/asset-manifest.json',
  renderManifest: '.slide-work/render-manifest.json',
  review: '.slide-work/review.json',
  state: '.slide-work/run-state.json',
  pagesDir: '.slide-work/rendered-pages',
  deckPlan: '.slide-work/deck-plan.json',
  storyboard: '.slide-work/storyboard.md',
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = path.resolve(HERE, '..', '..', 'schemas');

export class LifecycleError extends Error {
  constructor(message, { exitCode = 1, details = [] } = {}) {
    super(message);
    this.name = 'LifecycleError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(file) {
  return sha256Buffer(await readFile(file));
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value === 'object' ? 'object' : typeof value;
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Only local JSON Schema references are supported: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((node, key) => node?.[key], rootSchema);
}

export function validateSchema(value, schema, rootSchema = schema, at = '$') {
  const errors = [];
  const add = (message) => errors.push(`${at}: ${message}`);

  if (schema.$ref) {
    const target = resolveRef(rootSchema, schema.$ref);
    if (!target) return [`${at}: unresolved schema reference ${schema.$ref}`];
    return validateSchema(value, target, rootSchema, at);
  }

  if (schema.allOf) {
    for (const candidate of schema.allOf) errors.push(...validateSchema(value, candidate, rootSchema, at));
  }

  if (schema.if) {
    const branch = validateSchema(value, schema.if, rootSchema, at).length === 0 ? schema.then : schema.else;
    if (branch) errors.push(...validateSchema(value, branch, rootSchema, at));
  }

  if (schema.anyOf) {
    const branches = schema.anyOf.map((candidate) => validateSchema(value, candidate, rootSchema, at));
    if (!branches.some((branch) => branch.length === 0)) {
      add(`does not match any allowed shape (${branches.map((branch) => branch[0]).join('; ')})`);
    }
    return errors;
  }

  if (schema.oneOf) {
    const branches = schema.oneOf.map((candidate) => validateSchema(value, candidate, rootSchema, at));
    if (branches.filter((branch) => branch.length === 0).length !== 1) add('must match exactly one allowed shape');
    return errors;
  }

  if (Object.hasOwn(schema, 'const') && !Object.is(value, schema.const)) {
    add(`must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    add(`must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(', ')}`);
  }

  if (schema.type) {
    const actual = valueType(value);
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = allowed.some((expected) =>
      expected === 'number' ? typeof value === 'number' && Number.isFinite(value) : actual === expected,
    );
    if (!matches) {
      add(`must have type ${allowed.join(' or ')}, got ${actual}`);
      return errors;
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) add(`must contain at least ${schema.minLength} character(s)`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`must contain at most ${schema.maxLength} character(s)`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) add(`must match ${schema.pattern}`);
    if (schema.format === 'date-time') {
      const isoLike = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
      if (!isoLike || Number.isNaN(Date.parse(value))) add('must be an ISO 8601 date-time');
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) add(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) add(`must be <= ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(`must contain at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`must contain at most ${schema.maxItems} item(s)`);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = canonicalJson(item);
        if (seen.has(key)) {
          add('must not contain duplicate items');
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) {
      value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, rootSchema, `${at}[${index}]`)));
    }
    if (schema.contains && !value.some((item, index) => validateSchema(item, schema.contains, rootSchema, `${at}[${index}]`).length === 0)) {
      add('must contain an item matching the required shape');
    }
  }

  if (isPlainObject(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${at}.${key}: unknown property`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) errors.push(...validateSchema(child, properties[key], rootSchema, `${at}.${key}`));
    }
  }

  return errors;
}

const schemaCache = new Map();

export async function loadSchema(name) {
  if (!schemaCache.has(name)) {
    const file = path.join(SCHEMA_DIR, `${name}.schema.json`);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      throw new LifecycleError(`Cannot load schema ${name}: ${error.message}`);
    }
    schemaCache.set(name, parsed);
  }
  return schemaCache.get(name);
}

export async function assertSchema(value, name, label = name) {
  const schema = await loadSchema(name);
  const errors = validateSchema(value, schema);
  if (errors.length) throw new LifecycleError(`${label} does not satisfy ${name}.schema.json: ${errors.join('; ')}`, { details: errors });
  return value;
}

function stripYamlComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && line[index - 1] !== '\\') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function splitFlow(value) {
  const parts = [];
  let quote = null;
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

function yamlScalar(raw, lineNumber) {
  const value = raw.trim();
  if (value === '' || value === '~' || /^(?:null|Null|NULL)$/.test(value)) return null;
  if (/^(?:true|True|TRUE)$/.test(value)) return true;
  if (/^(?:false|False|FALSE)$/.test(value)) return false;
  if (/^-?(?:0|[1-9]\d*)$/.test(value)) return Number(value);
  if (/^-?(?:0|[1-9]\d*)\.\d+$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitFlow(value.slice(1, -1)).map((part) => yamlScalar(part, lineNumber));
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const object = {};
    for (const part of splitFlow(value.slice(1, -1))) {
      const match = /^([^:]+):\s*(.*)$/.exec(part);
      if (!match) throw new LifecycleError(`Unsupported YAML flow mapping on line ${lineNumber}`);
      object[match[1].trim().replace(/^['"]|['"]$/g, '')] = yamlScalar(match[2], lineNumber);
    }
    return object;
  }
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new LifecycleError(`Invalid double-quoted YAML scalar on line ${lineNumber}`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new LifecycleError(`Unterminated YAML scalar on line ${lineNumber}`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[!&*]|^(?:---|\.\.\.)$/.test(value)) {
    throw new LifecycleError(`YAML tags, anchors, aliases, and extra documents are not supported (line ${lineNumber})`);
  }
  return value;
}

export function parseSimpleYaml(source, label = 'YAML') {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (normalized.includes('\t')) throw new LifecycleError(`${label} must use spaces, not tabs`);
  const lines = normalized
    .split('\n')
    .map((raw, index) => ({ raw: stripYamlComment(raw), number: index + 1 }))
    .filter(({ raw }) => raw.trim().length > 0)
    .map(({ raw, number }) => ({ indent: raw.length - raw.trimStart().length, text: raw.trimStart(), number }));
  if (lines.length === 0) return {};

  let cursor = 0;
  const parseNode = (indent) => {
    if (cursor >= lines.length) return null;
    if (lines[cursor].indent !== indent) {
      throw new LifecycleError(`${label} has inconsistent indentation on line ${lines[cursor].number}`);
    }
    return lines[cursor].text.startsWith('-') ? parseSequence(indent) : parseMapping(indent);
  };

  const parseMapping = (indent) => {
    const object = {};
    while (cursor < lines.length && lines[cursor].indent === indent && !lines[cursor].text.startsWith('-')) {
      const { text, number } = lines[cursor];
      const match = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(text);
      if (!match) throw new LifecycleError(`${label} has an unsupported mapping entry on line ${number}`);
      const [, key, remainder] = match;
      if (Object.hasOwn(object, key)) throw new LifecycleError(`${label} repeats key '${key}' on line ${number}`);
      cursor += 1;
      if (remainder !== undefined && /^[|>][+-]?$/.test(remainder)) {
        const folded = remainder.startsWith('>');
        const content = [];
        const contentIndent = cursor < lines.length && lines[cursor].indent > indent ? lines[cursor].indent : null;
        while (contentIndent !== null && cursor < lines.length && lines[cursor].indent >= contentIndent) {
          content.push(lines[cursor].text);
          cursor += 1;
        }
        object[key] = content.join(folded ? ' ' : '\n');
      } else if (remainder !== undefined) object[key] = yamlScalar(remainder, number);
      else if (cursor < lines.length && lines[cursor].indent > indent) object[key] = parseNode(lines[cursor].indent);
      else object[key] = null;
    }
    return object;
  };

  const parseSequence = (indent) => {
    const array = [];
    while (cursor < lines.length && lines[cursor].indent === indent && lines[cursor].text.startsWith('-')) {
      const { text, number } = lines[cursor];
      const remainder = text.slice(1).trimStart();
      cursor += 1;
      if (!remainder) {
        array.push(cursor < lines.length && lines[cursor].indent > indent ? parseNode(lines[cursor].indent) : null);
        continue;
      }
      const mapping = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(remainder);
      if (!mapping) {
        array.push(yamlScalar(remainder, number));
        continue;
      }
      const item = {};
      item[mapping[1]] = mapping[2] === undefined ? null : yamlScalar(mapping[2], number);
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const continuationIndent = lines[cursor].indent;
        const continuation = parseMapping(continuationIndent);
        Object.assign(item, continuation);
      }
      array.push(item);
    }
    return array;
  };

  const result = parseNode(lines[0].indent);
  if (cursor !== lines.length) throw new LifecycleError(`${label} contains an unsupported indentation structure on line ${lines[cursor].number}`);
  return result;
}

export async function loadJson(file, label = file) {
  let value;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new LifecycleError(`${label} is not valid JSON: ${error.message}`);
  }
  return value;
}

export async function loadRequest(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new LifecycleError(`Cannot read request: ${error.message}`);
  }
  let value;
  if (file.toLowerCase().endsWith('.json')) {
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new LifecycleError(`request is not valid JSON: ${error.message}`);
    }
  } else {
    value = parseSimpleYaml(text, 'request');
  }
  return assertSchema(value, 'request', 'request');
}

export function toPosixRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function resolveRoot(rootArg = process.cwd()) {
  const absolute = path.resolve(rootArg);
  let resolved;
  try {
    resolved = await realpath(absolute);
  } catch (error) {
    throw new LifecycleError(`Workspace root does not exist: ${absolute} (${error.message})`);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new LifecycleError(`Workspace root is not a directory: ${absolute}`);
  return resolved;
}

export function assertSafeManifestPath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0) throw new LifecycleError(`${label} must be a non-empty relative path`);
  if (value.includes('\\') || /[\u0000-\u001f]/.test(value)) throw new LifecycleError(`${label} must use safe POSIX separators: ${value}`);
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw new LifecycleError(`${label} must be relative: ${value}`);
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized !== value) {
    throw new LifecycleError(`${label} is not a normalized workspace-relative path: ${value}`);
  }
  return value;
}

export async function resolveWorkspacePath(root, value, { label = 'path', mustExist = false, kind = null } = {}) {
  if (typeof value !== 'string' || value.length === 0) throw new LifecycleError(`${label} must be a non-empty path`);
  if (value.includes('\0')) throw new LifecycleError(`${label} contains a NUL byte`);
  const absolute = path.resolve(root, value);
  if (!isInside(root, absolute)) throw new LifecycleError(`${label} escapes the workspace root: ${value}`);
  if (!mustExist) {
    let ancestor = absolute;
    while (!existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    try {
      const resolvedAncestor = await realpath(ancestor);
      if (!isInside(root, resolvedAncestor)) throw new LifecycleError(`${label} has a parent that resolves outside the workspace root: ${value}`);
      if (existsSync(absolute)) {
        const resolved = await realpath(absolute);
        if (!isInside(root, resolved)) throw new LifecycleError(`${label} resolves outside the workspace root: ${value}`);
      }
    } catch (error) {
      if (error instanceof LifecycleError) throw error;
      throw new LifecycleError(`Cannot validate ${label}: ${value} (${error.code ?? error.message})`);
    }
    return absolute;
  }
  let resolved;
  try {
    resolved = await realpath(absolute);
  } catch (error) {
    throw new LifecycleError(`${label} does not exist: ${value} (${error.code ?? error.message})`);
  }
  if (!isInside(root, resolved)) throw new LifecycleError(`${label} resolves outside the workspace root: ${value}`);
  const info = await stat(resolved);
  if (kind === 'file' && !info.isFile()) throw new LifecycleError(`${label} is not a file: ${value}`);
  if (kind === 'directory' && !info.isDirectory()) throw new LifecycleError(`${label} is not a directory: ${value}`);
  return resolved;
}

export async function resolveManifestPath(root, value, options = {}) {
  assertSafeManifestPath(value, options.label);
  return resolveWorkspacePath(root, value, options);
}

export function extractFrontmatter(markdown) {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') throw new LifecycleError('Marp YAML frontmatter must start on line 1');
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      end = index;
      break;
    }
  }
  if (end < 0) throw new LifecycleError('Marp YAML frontmatter is not closed');
  return {
    data: parseSimpleYaml(lines.slice(1, end).join('\n'), 'frontmatter'),
    bodyLines: lines.slice(end + 1),
    endLine: end + 1,
  };
}

export function countSlides(markdown) {
  const { bodyLines } = extractFrontmatter(markdown);
  let separators = 0;
  let fence = null;
  for (const line of bodyLines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === marker) fence = null;
      else if (fence === null) fence = marker;
      continue;
    }
    if (fence === null && line === '---') separators += 1;
  }
  return separators + 1;
}

function normalizeAssetTarget(raw) {
  let target = raw.trim();
  if (target.startsWith('<')) {
    const end = target.indexOf('>');
    if (end >= 0) target = target.slice(1, end);
  } else {
    const quoted = /^(?:"([^"]+)"|'([^']+)')/.exec(target);
    if (quoted) target = quoted[1] ?? quoted[2];
    else target = target.split(/\s+/)[0];
  }
  try {
    target = decodeURIComponent(target);
  } catch {
    throw new LifecycleError(`Asset reference contains invalid percent encoding: ${raw}`);
  }
  return target.split(/[?#]/, 1)[0];
}

function classifyReference(raw, label) {
  const target = normalizeAssetTarget(raw);
  if (!target || target.startsWith('#')) return null;
  if (target.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) {
    throw new LifecycleError(`${label} uses a remote, data, or file URL; copy the asset into the workspace: ${raw}`);
  }
  if (target.includes('\\') || path.posix.isAbsolute(target) || /^[A-Za-z]:/.test(target)) {
    throw new LifecycleError(`${label} must be a relative POSIX path: ${raw}`);
  }
  const normalized = path.posix.normalize(target);
  if (normalized === '..' || normalized.startsWith('../')) throw new LifecycleError(`${label} traverses outside its directory: ${raw}`);
  return normalized;
}

function withoutFencedCode(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let fence = null;
  return lines
    .map((line) => {
      const match = /^[\t ]{0,3}(`{3,}|~{3,})/.exec(line);
      if (match) {
        const marker = match[1][0];
        if (!fence) fence = { marker, length: match[1].length };
        else if (marker === fence.marker && match[1].length >= fence.length) fence = null;
        return '';
      }
      return fence ? '' : line.replace(/(`+)(.*?)\1/g, (code) => ' '.repeat(code.length));
    })
    .join('\n');
}

export function extractPresenterNotes(markdown) {
  const directiveKeys = new Set([
    'backgroundcolor',
    'backgroundimage',
    'class',
    'color',
    'footer',
    'header',
    'paginate',
    'size',
    'style',
    'theme',
  ]);
  const notes = [];
  const active = withoutFencedCode(markdown);
  for (const match of active.matchAll(/<!--([\s\S]*?)-->/g)) {
    const body = match[1].trim();
    if (!body) continue;
    const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const directivesOnly = lines.every((line) => {
      const directive = /^_?([A-Za-z][A-Za-z0-9-]*)\s*:/.exec(line);
      return directive && directiveKeys.has(directive[1].toLowerCase());
    });
    if (!directivesOnly) notes.push(body);
  }
  return notes;
}

export function extractMarkdownAssetReferences(markdown) {
  markdown = withoutFencedCode(markdown);
  const references = [];
  const definitions = new Map();
  const normalizeLabel = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();

  for (const match of markdown.matchAll(/^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|(\S+))/gm)) {
    definitions.set(normalizeLabel(match[1]), match[2] ?? match[3]);
  }
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\n]+)\)/g)) references.push(match[1]);
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\[([^\]]*)\]/g)) {
    const label = normalizeLabel(match[2] || match[1]);
    if (definitions.has(label)) references.push(definitions.get(label));
  }
  for (const match of markdown.matchAll(/!\[([^\]\n]+)\](?![([])/g)) {
    const label = normalizeLabel(match[1]);
    if (definitions.has(label)) references.push(definitions.get(label));
  }
  for (const match of markdown.matchAll(/\b(?:src|poster)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) references.push(match[1] ?? match[2]);
  for (const match of markdown.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const { imports, urls } = cssReferences(match[1]);
    if (imports.length > 0) throw new LifecycleError('Markdown style blocks may not contain @import');
    references.push(...urls);
  }
  for (const match of markdown.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const { imports, urls } = cssReferences(match[1] ?? match[2]);
    if (imports.length > 0) throw new LifecycleError('Inline HTML styles may not contain @import');
    references.push(...urls);
  }
  for (const match of markdown.matchAll(/<!--\s*_?backgroundImage\s*:\s*([\s\S]*?)-->/gi)) {
    const { imports, urls } = cssReferences(match[1].trim());
    if (imports.length > 0) throw new LifecycleError('Marpit backgroundImage directives may not contain @import');
    references.push(...urls);
  }
  return [...new Set(references)];
}

function cssReferences(css) {
  const imports = [];
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s;)]+))\s*\)?\s*;/gi)) {
    imports.push(match[1] ?? match[2] ?? match[3]);
  }
  const urls = [];
  for (const match of css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/gi)) {
    urls.push(match[1] ?? match[2] ?? match[3]);
  }
  return { imports, urls };
}

function svgReferences(svg) {
  if (/<script\b/i.test(svg) || /<foreignObject\b/i.test(svg) || /<!DOCTYPE\b/i.test(svg) || /<\?xml-stylesheet\b/i.test(svg) || /@import\b/i.test(svg)) {
    throw new LifecycleError('SVG assets may not contain script, foreignObject, doctype, stylesheet processing instructions, or CSS imports');
  }
  const references = [];
  for (const match of svg.matchAll(/\b(?:href|xlink:href)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) references.push(match[1] ?? match[2]);
  for (const match of svg.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/gi)) references.push(match[1] ?? match[2] ?? match[3]);
  return references;
}

async function discoverFromFile(root, referringFile, rawReferences, collected, pending) {
  for (const raw of rawReferences) {
    const target = classifyReference(raw, `Asset reference in ${toPosixRelative(root, referringFile)}`);
    if (!target) continue;
    const absolute = await resolveWorkspacePath(root, path.resolve(path.dirname(referringFile), target), {
      label: `referenced asset ${target}`,
      mustExist: true,
      kind: 'file',
    });
    const relative = toPosixRelative(root, absolute);
    if (!collected.has(relative)) {
      collected.set(relative, absolute);
      pending.push(absolute);
    }
  }
}

export async function discoverLocalAssets(root, sourceFile, themeFile = null, listedFiles = []) {
  const collected = new Map();
  const pending = [];
  const markdown = await readFile(sourceFile, 'utf8');
  await discoverFromFile(root, sourceFile, extractMarkdownAssetReferences(markdown), collected, pending);
  const frontmatter = extractFrontmatter(markdown).data;
  for (const [label, cssValue] of [['style', frontmatter.style], ['backgroundImage', frontmatter.backgroundImage]]) {
    if (typeof cssValue === 'string' && cssValue.trim()) {
      const { imports, urls } = cssReferences(cssValue);
      if (imports.length > 0) throw new LifecycleError(`Frontmatter ${label} may not contain @import`);
      await discoverFromFile(root, sourceFile, urls, collected, pending);
    }
  }

  if (themeFile) {
    const css = await readFile(themeFile, 'utf8');
    const { imports, urls } = cssReferences(css);
    for (const imported of imports) {
      if (!['default', 'gaia', 'uncover'].includes(imported)) {
        throw new LifecycleError(`Theme CSS may only import a built-in Marp theme; compile local CSS imports first: ${imported}`);
      }
    }
    await discoverFromFile(root, themeFile, urls, collected, pending);
  }

  for (const listed of listedFiles) {
    const absolute = await resolveManifestPath(root, listed, { label: 'asset manifest path', mustExist: true, kind: 'file' });
    const relative = toPosixRelative(root, absolute);
    if (!collected.has(relative)) {
      collected.set(relative, absolute);
      pending.push(absolute);
    }
  }

  while (pending.length > 0) {
    const current = pending.shift();
    const extension = path.extname(current).toLowerCase();
    if (extension !== '.css' && extension !== '.svg') continue;
    const text = await readFile(current, 'utf8');
    if (extension === '.css') {
      const { imports, urls } = cssReferences(text);
      if (imports.length > 0) throw new LifecycleError(`Asset CSS must be compiled and may not contain @import: ${toPosixRelative(root, current)}`);
      await discoverFromFile(root, current, urls, collected, pending);
    } else {
      await discoverFromFile(root, current, svgReferences(text), collected, pending);
    }
  }

  return [...collected.entries()]
    .map(([relative, absolute]) => ({ path: relative, absolute }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function themeDeclaration(css) {
  return /^\/\*\s*@theme\s+([^\s*]+).*?\*\//m.exec(css)?.[1] ?? null;
}

export async function loadAssetManifest(root, file) {
  const value = await loadJson(file, 'asset manifest');
  await assertSchema(value, 'asset-manifest', 'asset manifest');
  const errors = [];
  const ids = new Set();
  const paths = new Set();
  for (const asset of value.assets) {
    if (ids.has(asset.id)) errors.push(`duplicate asset id: ${asset.id}`);
    ids.add(asset.id);
    if (paths.has(asset.path)) errors.push(`duplicate asset path: ${asset.path}`);
    paths.add(asset.path);
    let absolute;
    try {
      absolute = await resolveManifestPath(root, asset.path, { label: `asset ${asset.id}`, mustExist: true, kind: 'file' });
      const actual = await sha256File(absolute);
      if (actual !== asset.sha256) errors.push(`asset ${asset.id} hash mismatch: ${asset.path}`);
    } catch (error) {
      errors.push(error.message);
    }
    if (!asset.decorative && asset.alt.trim().length === 0) errors.push(`informative asset ${asset.id} must have non-empty alt text`);
    if (asset.decorative && asset.alt.length !== 0) errors.push(`decorative asset ${asset.id} must use empty alt text`);
  }
  if (errors.length) throw new LifecycleError('asset manifest semantic validation failed', { details: errors });
  return value;
}

function commandPaths(options) {
  return {
    source: options.source ?? DEFAULTS.source,
    theme: options.theme ?? DEFAULTS.theme,
    request: options.request ?? DEFAULTS.request,
    assetManifest: options.assetManifest ?? DEFAULTS.assetManifest,
    renderManifest: options.renderManifest ?? DEFAULTS.renderManifest,
    review: options.review ?? DEFAULTS.review,
    state: options.state ?? DEFAULTS.state,
    pagesDir: options.pagesDir ?? DEFAULTS.pagesDir,
    deckPlan: options.deckPlan ?? DEFAULTS.deckPlan,
    storyboard: options.storyboard ?? DEFAULTS.storyboard,
  };
}

export async function buildFingerprint(options = {}) {
  const root = await resolveRoot(options.root);
  const paths = commandPaths(options);
  const source = await resolveWorkspacePath(root, paths.source, { label: 'source', mustExist: true, kind: 'file' });
  const request = await resolveWorkspacePath(root, paths.request, { label: 'request', mustExist: true, kind: 'file' });
  const assetManifestFile = await resolveWorkspacePath(root, paths.assetManifest, { label: 'asset manifest', mustExist: true, kind: 'file' });
  const explicitTheme = Object.hasOwn(options, 'theme');
  let theme = null;
  const themeCandidate = await resolveWorkspacePath(root, paths.theme, { label: 'theme' });
  if (existsSync(themeCandidate)) theme = await resolveWorkspacePath(root, paths.theme, { label: 'theme', mustExist: true, kind: 'file' });
  else if (explicitTheme) throw new LifecycleError(`theme does not exist: ${paths.theme}`);

  await loadRequest(request);
  const assetManifest = await loadAssetManifest(root, assetManifestFile);
  const listed = [];
  for (const asset of assetManifest.assets) {
    listed.push(asset.path);
    if (asset.source.path) listed.push(asset.source.path);
    if (asset.generator?.spec_path) listed.push(asset.generator.spec_path);
  }
  const assets = await discoverLocalAssets(root, source, theme, [...new Set(listed)]);

  const entries = [
    { kind: 'request', path: toPosixRelative(root, request), absolute: request },
    { kind: 'source', path: toPosixRelative(root, source), absolute: source },
    { kind: 'asset_manifest', path: toPosixRelative(root, assetManifestFile), absolute: assetManifestFile },
  ];
  if (theme) entries.push({ kind: 'theme', path: toPosixRelative(root, theme), absolute: theme });
  for (const asset of assets) entries.push({ kind: 'asset', path: asset.path, absolute: asset.absolute });

  const files = [];
  for (const entry of entries) files.push({ kind: entry.kind, path: entry.path, sha256: await sha256File(entry.absolute) });
  files.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  const fingerprint = sha256Buffer(Buffer.from(JSON.stringify({ version: 1, files }), 'utf8'));
  return { root, paths, fingerprint, files, source, request, theme, assetManifestFile, assetManifest, assets };
}

export async function lintDeck(options = {}) {
  const root = await resolveRoot(options.root);
  const paths = commandPaths(options);
  const failures = [];
  const warnings = [];
  let source;
  let markdown;
  let slideCount = 0;
  let frontmatter = null;
  let theme = null;
  let assetPaths = [];
  try {
    source = await resolveWorkspacePath(root, paths.source, { label: 'source', mustExist: true, kind: 'file' });
    markdown = await readFile(source, 'utf8');
    const extracted = extractFrontmatter(markdown);
    frontmatter = extracted.data;
    slideCount = countSlides(markdown);
    if (frontmatter.marp !== true) failures.push('frontmatter must contain marp: true');
    if (frontmatter.html === true) failures.push('frontmatter html: true is disabled; use static SVG/HTML-free slide content');
    if (frontmatter.headingDivider !== undefined) failures.push('frontmatter headingDivider is disabled; use explicit --- slide boundaries');
    if (slideCount < 1) failures.push('could not determine slide count');
  } catch (error) {
    failures.push(error.message);
  }

  const target = options.target === undefined ? null : Number(options.target);
  const mode = options.slideCountMode ?? 'target';
  if (!['exact', 'target', 'flexible'].includes(mode)) failures.push('slide-count-mode must be exact, target, or flexible');
  if (target !== null && (!Number.isInteger(target) || target < 1)) failures.push(`target slide count must be a positive integer: ${options.target}`);
  else if (target !== null && mode === 'exact' && slideCount !== target) failures.push(`exact slide count required: actual=${slideCount} target=${target}`);
  else if (target !== null && mode === 'target' && slideCount !== target) warnings.push(`slide count differs from target: actual=${slideCount} target=${target}`);

  try {
    const explicitTheme = Object.hasOwn(options, 'theme');
    const candidate = await resolveWorkspacePath(root, paths.theme, { label: 'theme' });
    if (existsSync(candidate)) theme = await resolveWorkspacePath(root, paths.theme, { label: 'theme', mustExist: true, kind: 'file' });
    else if (explicitTheme) failures.push(`theme file not found: ${paths.theme}`);
    if (theme) {
      if (path.extname(theme).toLowerCase() !== '.css') failures.push(`theme file must have .css extension: ${paths.theme}`);
      const css = await readFile(theme, 'utf8');
      const declared = themeDeclaration(css);
      if (!declared) failures.push(`theme file has no /* @theme name */ declaration: ${paths.theme}`);
      if (frontmatter?.theme && declared && frontmatter.theme !== declared) {
        failures.push(`frontmatter theme '${frontmatter.theme}' does not match CSS theme '${declared}'`);
      }
    } else if (!frontmatter?.theme && !frontmatter?.style) warnings.push('no external theme name or inline style is declared');
  } catch (error) {
    failures.push(error.message);
  }

  if (source && markdown) {
    try {
      const assets = await discoverLocalAssets(root, source, theme, []);
      assetPaths = assets.map((asset) => asset.path);
    } catch (error) {
      failures.push(error.message);
    }
  }

  const requestCandidate = await resolveWorkspacePath(root, paths.request, { label: 'request' });
  if (existsSync(requestCandidate)) {
    try {
      const request = await loadRequest(await resolveWorkspacePath(root, paths.request, { label: 'request', mustExist: true, kind: 'file' }));
      if (['live', 'hybrid'].includes(request.delivery_mode)) {
        for (const key of ['lang', 'title', 'description', 'author']) {
          if (typeof frontmatter?.[key] !== 'string' || frontmatter[key].trim() === '') failures.push(`frontmatter ${key} is required for ${request.delivery_mode} delivery`);
        }
        if (!markdown || extractPresenterNotes(markdown).length === 0) {
          failures.push(`presenter notes are required for ${request.delivery_mode} delivery`);
        }
      }
    } catch (error) {
      failures.push(error.message);
      if (error.details) failures.push(...error.details);
    }
  }

  const deckPlanCandidate = await resolveWorkspacePath(root, paths.deckPlan, { label: 'deck plan' });
  const stateCandidate = await resolveWorkspacePath(root, paths.state, { label: 'run state' });
  const planningRequired = existsSync(stateCandidate);
  if (existsSync(deckPlanCandidate)) {
    try {
      const deckPlanFile = await resolveWorkspacePath(root, paths.deckPlan, { label: 'deck plan', mustExist: true, kind: 'file' });
      const deckPlan = await loadJson(deckPlanFile, 'deck plan');
      await assertSchema(deckPlan, 'deck-plan', 'deck plan');
      if (deckPlan.ghost_deck_status !== 'pass') failures.push('deck plan ghost_deck_status must be pass before rendering');
      const approval = deckPlan.integrated_approval;
      if (approval.options.length !== 3) failures.push('integrated approval must preserve exactly three rendered design options');
      if (!approval.options.includes(approval.recommended)) failures.push('integrated approval recommended option must exist in options');
      if (!approval.options.includes(approval.selected)) failures.push('integrated approval selected option must exist in options');
      if (typeof approval.approved_at !== 'string') failures.push('integrated approval must record approved_at before rendering');
      if (deckPlan.slides.length !== slideCount) failures.push(`deck plan has ${deckPlan.slides.length} slides but Markdown has ${slideCount}`);
      for (let index = 0; index < deckPlan.slides.length; index += 1) {
        const slide = deckPlan.slides[index];
        if (slide.number !== index + 1) failures.push(`deck plan slide at index ${index} must have number ${index + 1}`);
        if (!['none', 'hero-typography', 'section-divider', 'closing'].includes(slide.visual_kind) && slide.alt.trim() === '') {
          failures.push(`deck plan slide ${slide.number} visual_kind ${slide.visual_kind} requires alt text`);
        }
      }
    } catch (error) {
      failures.push(error.message);
      if (error.details) failures.push(...error.details);
    }
  } else if (planningRequired) {
    failures.push(`deck plan is required for an active marp-slide run: ${paths.deckPlan}`);
  }

  const storyboardCandidate = await resolveWorkspacePath(root, paths.storyboard, { label: 'storyboard' });
  if (existsSync(storyboardCandidate)) {
    try {
      const storyboardFile = await resolveWorkspacePath(root, paths.storyboard, { label: 'storyboard', mustExist: true, kind: 'file' });
      if ((await stat(storyboardFile)).size === 0) failures.push('storyboard must not be empty');
    } catch (error) {
      failures.push(error.message);
    }
  } else if (planningRequired) {
    failures.push(`storyboard is required for an active marp-slide run: ${paths.storyboard}`);
  }

  return { ok: failures.length === 0, slide_count: slideCount, failures: [...new Set(failures)], warnings: [...new Set(warnings)], assets: assetPaths };
}

function snapshotFor(files, kind) {
  return files.filter((file) => file.kind === kind).map(({ path: filePath, sha256 }) => ({ path: filePath, sha256 }));
}

function snapshotsEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) throw new LifecycleError('file does not have a valid PNG signature');
  let offset = 8;
  let dimensions = null;
  let sawData = false;
  let sawEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new LifecycleError('PNG chunk extends past end of file');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const payloadEnd = offset + 8 + length;
    const expectedCrc = buffer.readUInt32BE(payloadEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, payloadEnd));
    if (expectedCrc !== actualCrc) throw new LifecycleError(`PNG ${type} chunk has an invalid CRC`);
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) throw new LifecycleError('PNG must begin with a 13-byte IHDR chunk');
      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      if (width === 0 || height === 0) throw new LifecycleError('PNG dimensions must be positive');
      dimensions = { width, height };
    }
    if (type === 'IDAT') sawData = true;
    if (type === 'IEND') {
      if (length !== 0) throw new LifecycleError('PNG IEND chunk must be empty');
      sawEnd = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!dimensions || !sawData || !sawEnd || offset !== buffer.length) throw new LifecycleError('PNG is incomplete or has trailing bytes');
  return dimensions;
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function validateSnapshotFile(root, snapshot, label, errors, forbidden = new Set(), { allowEmpty = false } = {}) {
  try {
    const absolute = await resolveManifestPath(root, snapshot.path, { label, mustExist: true, kind: 'file' });
    const normalized = toPosixRelative(root, absolute);
    if (forbidden.has(normalized)) errors.push(`${label} overwrites an input file: ${snapshot.path}`);
    const actual = await sha256File(absolute);
    if (actual !== snapshot.sha256) errors.push(`${label} hash mismatch: ${snapshot.path}`);
    if (!allowEmpty && (await stat(absolute)).size === 0) errors.push(`${label} is empty: ${snapshot.path}`);
    return absolute;
  } catch (error) {
    errors.push(error.message);
    return null;
  }
}

export async function validateRenderManifest(context, { requireFinal = false } = {}) {
  const { root, paths, files, fingerprint } = context;
  const manifestFile = await resolveWorkspacePath(root, paths.renderManifest, { label: 'render manifest', mustExist: true, kind: 'file' });
  const manifest = await loadJson(manifestFile, 'render manifest');
  await assertSchema(manifest, 'render-manifest', 'render manifest');
  const errors = [];

  if (manifest.artifact_fingerprint !== fingerprint) errors.push('render manifest artifact_fingerprint is stale');
  const source = snapshotFor(files, 'source')[0];
  const request = snapshotFor(files, 'request')[0];
  const theme = snapshotFor(files, 'theme')[0] ?? null;
  const assets = snapshotFor(files, 'asset');
  if (!snapshotsEqual(manifest.source, source)) errors.push('render manifest source snapshot is stale');
  if (!snapshotsEqual(manifest.request, request)) errors.push('render manifest request snapshot is stale');
  if (!snapshotsEqual(manifest.theme, theme)) errors.push('render manifest theme snapshot is stale');
  if (!snapshotsEqual(manifest.assets, assets)) errors.push('render manifest asset snapshots are stale or incomplete');

  const markdown = await readFile(context.source, 'utf8');
  const actualSlideCount = countSlides(markdown);
  if (manifest.slide_count !== actualSlideCount) errors.push(`render manifest slide_count=${manifest.slide_count}, source has ${actualSlideCount}`);
  const declaredAssetPaths = new Set(context.assetManifest.assets.map((asset) => asset.path));
  try {
    const sourceAssets = await discoverLocalAssets(root, context.source, context.theme, []);
    for (const asset of sourceAssets) {
      if (!declaredAssetPaths.has(asset.path)) errors.push(`deck-referenced asset is missing from asset manifest: ${asset.path}`);
    }
  } catch (error) {
    errors.push(error.message);
  }
  for (const asset of context.assetManifest.assets) {
    for (const slide of asset.pages) if (slide > manifest.slide_count) errors.push(`asset ${asset.id} references missing slide ${slide}`);
  }
  if (!manifest.formats.includes('png')) errors.push('render manifest formats must include png for visual review');
  if (!manifest.formats.includes('notes')) errors.push('render manifest formats must include notes');

  const expectedOutputFormats = manifest.formats.filter((format) => format !== 'png').sort();
  const actualOutputFormats = manifest.outputs.map((output) => output.format).sort();
  if (!snapshotsEqual(expectedOutputFormats, actualOutputFormats)) errors.push('render outputs must contain exactly one artifact for every non-PNG format');
  const forbiddenInputs = new Set(files.map((file) => file.path));
  const outputPaths = new Set();
  for (const output of manifest.outputs) {
    const expectedExtension = { pdf: '.pdf', html: '.html', pptx: '.pptx', notes: '.txt' }[output.format];
    if (path.posix.extname(output.path).toLowerCase() !== expectedExtension) {
      errors.push(`output format ${output.format} must use ${expectedExtension}: ${output.path}`);
    }
    if (outputPaths.has(output.path)) errors.push(`duplicate render output path: ${output.path}`);
    outputPaths.add(output.path);
    await validateSnapshotFile(
      root,
      output,
      `render output ${output.format}`,
      errors,
      forbiddenInputs,
      { allowEmpty: output.format === 'notes' },
    );
  }

  if (manifest.page_images.length !== manifest.slide_count) {
    errors.push(`page_images count ${manifest.page_images.length} does not equal slide_count ${manifest.slide_count}`);
  }
  const pagePaths = new Set();
  const manifestPageRelatives = [];
  for (let index = 0; index < manifest.page_images.length; index += 1) {
    const page = manifest.page_images[index];
    const expectedSlide = index + 1;
    if (page.slide !== expectedSlide) errors.push(`page_images[${index}].slide must be ${expectedSlide}`);
    const expectedName = `page-${String(page.slide).padStart(3, '0')}.png`;
    if (path.posix.basename(page.path) !== expectedName) errors.push(`page ${page.slide} must be named ${expectedName}`);
    if (pagePaths.has(page.path)) errors.push(`duplicate page image path: ${page.path}`);
    pagePaths.add(page.path);
    manifestPageRelatives.push(page.path);
    try {
      const absolute = await resolveManifestPath(root, page.path, { label: `page image ${page.slide}`, mustExist: true, kind: 'file' });
      const bytes = await readFile(absolute);
      const actualHash = sha256Buffer(bytes);
      if (actualHash !== page.sha256) errors.push(`page image ${page.slide} hash mismatch`);
      const dimensions = pngDimensions(bytes);
      if (dimensions.width !== page.width || dimensions.height !== page.height) {
        errors.push(`page image ${page.slide} dimensions mismatch: manifest=${page.width}x${page.height}, actual=${dimensions.width}x${dimensions.height}`);
      }
      if (forbiddenInputs.has(toPosixRelative(root, absolute))) errors.push(`page image ${page.slide} overwrites an input file`);
    } catch (error) {
      errors.push(`page image ${page.slide}: ${error.message}`);
    }
  }

  try {
    const pagesDir = await resolveWorkspacePath(root, paths.pagesDir, { label: 'rendered pages directory', mustExist: true, kind: 'directory' });
    const entries = await readdir(pagesDir, { withFileTypes: true });
    const actualPages = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
      .map((entry) => toPosixRelative(root, path.join(pagesDir, entry.name)))
      .sort();
    const expectedPages = [...manifestPageRelatives].sort();
    if (!snapshotsEqual(actualPages, expectedPages)) {
      errors.push(`rendered pages directory does not exactly match manifest: actual=${actualPages.join(',')} expected=${expectedPages.join(',')}`);
    }
  } catch (error) {
    errors.push(error.message);
  }

  if (manifest.contact_sheet) {
    try {
      const absolute = await resolveManifestPath(root, manifest.contact_sheet.path, { label: 'contact sheet', mustExist: true, kind: 'file' });
      if (forbiddenInputs.has(toPosixRelative(root, absolute))) errors.push('contact sheet overwrites an input file');
      if (outputPaths.has(manifest.contact_sheet.path) || pagePaths.has(manifest.contact_sheet.path)) errors.push('contact sheet must be distinct from rendered outputs and page images');
      const bytes = await readFile(absolute);
      if (sha256Buffer(bytes) !== manifest.contact_sheet.sha256) errors.push('contact sheet hash mismatch');
      const dimensions = pngDimensions(bytes);
      if (dimensions.width !== manifest.contact_sheet.width || dimensions.height !== manifest.contact_sheet.height) errors.push('contact sheet dimensions mismatch');
    } catch (error) {
      errors.push(`contact sheet: ${error.message}`);
    }
  } else if (requireFinal) {
    errors.push('contact_sheet is required before finalization');
  }

  if (!new RegExp(`(?:^|[^0-9])${REQUIRED_MARP_CLI_VERSION.replaceAll('.', '\\.').replaceAll('-', '\\-')}(?:$|[^0-9])`).test(manifest.environment.marp_cli)) {
    errors.push(`Marp CLI must be pinned to ${REQUIRED_MARP_CLI_VERSION}; got ${manifest.environment.marp_cli}`);
  }
  if (!new RegExp(`(?:^|[^0-9])${REQUIRED_MARP_CORE_VERSION.replaceAll('.', '\\.').replaceAll('-', '\\-')}(?:$|[^0-9])`).test(manifest.environment.marp_core)) {
    errors.push(`Marp Core must be pinned to ${REQUIRED_MARP_CORE_VERSION}; got ${manifest.environment.marp_core}`);
  }
  if (requireFinal) {
    if (manifest.render_iteration < 2) errors.push('the first render cannot be finalized; render_iteration must be at least 2');
    if (manifest.improvements.length === 0) errors.push('at least one post-render improvement must be recorded');
    for (const improvement of manifest.improvements) {
      if (improvement.iteration > manifest.render_iteration) errors.push(`improvement iteration ${improvement.iteration} exceeds render_iteration`);
      for (const slide of improvement.slides) if (slide > manifest.slide_count) errors.push(`improvement references missing slide ${slide}`);
    }
  }

  const fontNames = new Set();
  for (const font of manifest.environment.fonts) {
    if (fontNames.has(font.name)) errors.push(`duplicate environment font entry: ${font.name}`);
    fontNames.add(font.name);
  }

  if (errors.length) {
    throw new LifecycleError(`render manifest validation failed: ${errors.join('; ')}`, { details: errors });
  }
  return { manifest, manifestFile };
}

function allChecks(review) {
  return [
    ...Object.values(review.machine_qa.checks),
    ...Object.values(review.content_review.hard_gates),
    ...Object.values(review.visual_review.hard_gates),
  ];
}

function allScores(review) {
  return [...Object.values(review.content_review.scores), ...Object.values(review.visual_review.scores)];
}

export async function validateReview(context, render, { requirePass = false } = {}) {
  const { root, paths, fingerprint } = context;
  const reviewFile = await resolveWorkspacePath(root, paths.review, { label: 'review', mustExist: true, kind: 'file' });
  const review = await loadJson(reviewFile, 'review');
  await assertSchema(review, 'review', 'review');
  const errors = [];
  if (review.artifact_fingerprint !== fingerprint) errors.push('review artifact_fingerprint is stale');
  if (review.render_iteration !== render.manifest.render_iteration) errors.push('review render_iteration does not match render manifest');

  const expectedPages = render.manifest.page_images.map((page) => page.path);
  if (review.visual_review.checked_page_count !== render.manifest.slide_count) errors.push('visual review checked_page_count must equal slide_count');
  if (!snapshotsEqual(review.visual_review.page_images, expectedPages)) errors.push('visual review page_images must exactly match render manifest order and paths');
  const expectedContact = render.manifest.contact_sheet?.path ?? null;
  if (review.visual_review.contact_sheet !== expectedContact) errors.push('visual review contact_sheet must match render manifest');

  if (review.status === 'pass') {
    if (review.render_iteration < 2) errors.push('a pass review requires render_iteration >= 2');
    if (!render.manifest.contact_sheet) errors.push('a pass review requires a rendered contact sheet');
    for (const [name, component] of Object.entries({ machine_qa: review.machine_qa, content_review: review.content_review, visual_review: review.visual_review })) {
      if (component.status !== 'pass') errors.push(`${name}.status must be pass`);
    }
    if (allChecks(review).some((check) => check.status !== 'pass')) errors.push('every rubric v3 check and hard gate must pass');
    if (allScores(review).some((score) => score.score < 4)) errors.push('all four rubric v3 scores must be at least 4');
    if (review.issues.some((issue) => ['critical', 'major'].includes(issue.severity))) errors.push('pass review contains a critical or major issue');
    if (review.visual_review.page_findings.some((finding) => ['critical', 'major'].includes(finding.severity))) errors.push('pass review contains a critical or major visual finding');
    if (review.missing_required.length || review.questions_for_user.length) errors.push('pass review cannot contain missing requirements or user questions');
  } else if (review.status === 'needs_user') {
    if (review.missing_required.length === 0 && review.questions_for_user.length === 0) errors.push('needs_user review must identify missing information or a user question');
  } else if (review.status === 'blocked') {
    const componentBlocked = [review.machine_qa, review.content_review, review.visual_review].some((component) => component.status === 'blocked');
    if (!componentBlocked) errors.push('blocked review must mark at least one component blocked');
    if (review.issues.length === 0 && review.questions_for_user.length === 0) errors.push('blocked review must explain the blocking condition');
  } else if (review.status === 'fail') {
    const hasFailedComponent = [review.machine_qa, review.content_review, review.visual_review].some((component) => component.status === 'fail');
    const hasFailedCheck = allChecks(review).some((check) => check.status === 'fail');
    const hasLowScore = allScores(review).some((score) => score.score > 0 && score.score < 4);
    const hasMaterialIssue = review.issues.some((issue) => ['critical', 'major'].includes(issue.severity));
    const hasMaterialFinding = review.visual_review.page_findings.some((finding) => ['critical', 'major'].includes(finding.severity));
    if (!hasFailedComponent && !hasFailedCheck && !hasLowScore && !hasMaterialIssue && !hasMaterialFinding) {
      errors.push('fail review must identify a failed component/check, low score, or critical/major finding');
    }
  }
  if (requirePass && review.status !== 'pass') errors.push(`review status must be pass, got ${review.status}`);
  if (errors.length) {
    throw new LifecycleError(`review validation failed: ${errors.join('; ')}`, { details: errors });
  }
  return { review, reviewFile };
}

export async function readState(root, statePath, { optional = false } = {}) {
  const candidate = await resolveWorkspacePath(root, statePath, { label: 'run state' });
  if (!existsSync(candidate)) {
    if (optional) return null;
    throw new LifecycleError(`run state does not exist: ${statePath}`);
  }
  const file = await resolveWorkspacePath(root, statePath, { label: 'run state', mustExist: true, kind: 'file' });
  const state = await loadJson(file, 'run state');
  await assertSchema(state, 'run-state', 'run state');
  const errors = [];
  if (state.status === 'complete' && !state.completed) errors.push('complete state must have completed=true');
  if (state.status !== 'complete' && state.completed) errors.push(`${state.status} state must have completed=false`);
  if (state.status === 'complete' && !state.artifact_fingerprint) errors.push('complete state must record artifact_fingerprint');
  if (errors.length) throw new LifecycleError('run state semantic validation failed', { details: errors });
  return { state, file };
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, file);
}

export async function initializeRun(options = {}) {
  const root = await resolveRoot(options.root);
  const paths = commandPaths(options);
  const status = options.status ?? 'active';
  if (!['active', 'needs_user', 'blocked'].includes(status)) throw new LifecycleError('init status must be active, needs_user, or blocked; complete is finalize-only');
  if (status !== 'active' && (!options.message || options.message.trim() === '')) throw new LifecycleError(`init --status ${status} requires --message`);
  const stateFile = await resolveWorkspacePath(root, paths.state, { label: 'run state' });
  if (existsSync(stateFile) && !options.force) throw new LifecycleError(`run state already exists: ${paths.state}; pass --force to begin a new run`);
  const now = new Date().toISOString();
  const state = {
    schema_version: STATE_SCHEMA_VERSION,
    run_id: randomUUID(),
    status,
    completed: false,
    started_at: now,
    updated_at: now,
    artifact_fingerprint: null,
    review_attempt: 0,
    render_iteration: 0,
    message: options.message ?? null,
  };
  await assertSchema(state, 'run-state', 'run state');
  await writeJsonAtomic(stateFile, state);

  const assetManifestFile = await resolveWorkspacePath(root, paths.assetManifest, { label: 'asset manifest' });
  if (!existsSync(assetManifestFile)) {
    await writeJsonAtomic(assetManifestFile, { schema_version: 1, generated_at: now, assets: [] });
  }
  return { state, state_path: toPosixRelative(root, stateFile), asset_manifest_path: toPosixRelative(root, assetManifestFile) };
}

export async function transitionRun(options = {}) {
  const root = await resolveRoot(options.root);
  const paths = commandPaths(options);
  const status = options.status;
  if (!['active', 'needs_user', 'blocked'].includes(status)) {
    throw new LifecycleError('set-status requires --status active, needs_user, or blocked; complete is finalize-only');
  }
  if (status !== 'active' && (!options.message || options.message.trim() === '')) {
    throw new LifecycleError(`set-status --status ${status} requires --message`);
  }
  const current = await readState(root, paths.state);
  if (current.state.status === 'complete') {
    throw new LifecycleError('a complete run is immutable; use init --force to begin a new run');
  }
  const state = {
    ...current.state,
    status,
    completed: false,
    updated_at: new Date().toISOString(),
    message: options.message?.trim() || null,
  };
  await assertSchema(state, 'run-state', 'run state');
  await writeJsonAtomic(current.file, state);
  return { state, state_path: toPosixRelative(root, current.file) };
}

export async function prepareReview(options = {}) {
  const context = await buildFingerprint(options);
  const render = await validateRenderManifest(context, { requireFinal: false });
  let previousAttempt = 0;
  const reviewCandidate = await resolveWorkspacePath(context.root, context.paths.review, { label: 'review' });
  if (existsSync(reviewCandidate)) {
    try {
      const previous = await loadJson(reviewCandidate, 'review');
      await assertSchema(previous, 'review', 'review');
      previousAttempt = previous.review_attempt;
    } catch {
      previousAttempt = 0;
    }
  }
  return {
    rubric_version: RUBRIC_VERSION,
    artifact_fingerprint: context.fingerprint,
    review_attempt: previousAttempt + 1,
    render_iteration: render.manifest.render_iteration,
    prepared_at: new Date().toISOString(),
  };
}

export async function syncStateFromReview(context, render, review) {
  const current = await readState(context.root, context.paths.state);
  const status = review.review.status === 'needs_user' ? 'needs_user' : review.review.status === 'blocked' ? 'blocked' : 'active';
  const next = {
    ...current.state,
    status,
    completed: false,
    updated_at: new Date().toISOString(),
    artifact_fingerprint: context.fingerprint,
    review_attempt: review.review.review_attempt,
    render_iteration: render.manifest.render_iteration,
    message:
      status === 'needs_user'
        ? 'Review requires user input.'
        : status === 'blocked'
          ? 'Review is blocked by an external or infrastructure condition.'
          : review.review.status === 'fail'
            ? 'Review failed; revise and render again.'
            : 'Review passed; run finalize after validation.',
  };
  await assertSchema(next, 'run-state', 'run state');
  await writeJsonAtomic(current.file, next);
  return next;
}

export async function validateCurrentReview(options = {}, { syncState = true, requirePass = false, requireFinalRender = false } = {}) {
  const context = await buildFingerprint(options);
  const render = await validateRenderManifest(context, { requireFinal: requireFinalRender });
  const review = await validateReview(context, render, { requirePass });
  const state = syncState ? await syncStateFromReview(context, render, review) : null;
  return { context, render, review, state };
}

export async function finalizeRun(options = {}) {
  const lint = await lintDeck(options);
  if (!lint.ok) throw new LifecycleError('deck lint failed before finalization', { details: lint.failures });
  const validated = await validateCurrentReview(options, { syncState: false, requirePass: true, requireFinalRender: true });
  const current = await readState(validated.context.root, validated.context.paths.state);
  const now = new Date().toISOString();
  const state = {
    ...current.state,
    status: 'complete',
    completed: true,
    updated_at: now,
    artifact_fingerprint: validated.context.fingerprint,
    review_attempt: validated.review.review.review_attempt,
    render_iteration: validated.render.manifest.render_iteration,
    message: null,
  };
  await assertSchema(state, 'run-state', 'run state');
  await writeJsonAtomic(current.file, state);
  return { state, fingerprint: validated.context.fingerprint, slide_count: validated.render.manifest.slide_count };
}

export async function gateRun(options = {}) {
  const root = await resolveRoot(options.root);
  const paths = commandPaths(options);
  let current;
  try {
    current = await readState(root, paths.state, { optional: true });
  } catch (error) {
    throw new LifecycleError(`marp-slide run marker is invalid: ${error.message}`, { exitCode: 2, details: error.details ?? [] });
  }
  if (!current) return { blocked: false, scoped: false, reason: 'no active marp-slide run marker' };
  const { state } = current;
  if (state.status === 'needs_user' || state.status === 'blocked') {
    return { blocked: false, scoped: true, completed: false, status: state.status, reason: state.message };
  }
  if (state.status === 'active') {
    throw new LifecycleError('marp-slide run is active and has not been finalized', { exitCode: 2 });
  }
  try {
    const validated = await validateCurrentReview(options, { syncState: false, requirePass: true, requireFinalRender: true });
    if (state.artifact_fingerprint !== validated.context.fingerprint) throw new LifecycleError('completed run fingerprint is stale');
    if (state.review_attempt !== validated.review.review.review_attempt) throw new LifecycleError('completed run review attempt does not match current review');
    if (state.render_iteration !== validated.render.manifest.render_iteration) throw new LifecycleError('completed run render iteration does not match current manifest');
    return { blocked: false, scoped: true, completed: true, status: 'complete', fingerprint: state.artifact_fingerprint };
  } catch (error) {
    throw new LifecycleError(`completed marp-slide run is no longer valid: ${error.message}`, { exitCode: 2, details: error.details ?? [] });
  }
}

export async function fileFingerprint(options = {}) {
  const context = await buildFingerprint(options);
  return { fingerprint: context.fingerprint, files: context.files };
}
