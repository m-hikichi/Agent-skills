import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {
  access,
  mkdir,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {AppError} from './errors.js';

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function digestJson(value: unknown): string {
  return sha256(canonicalize(value));
}

export async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => { hash.update(chunk); });
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return hash.digest('hex');
}

export async function readJson<T>(path: string): Promise<T> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    throw new AppError('FILE_READ_FAILED', `Unable to read ${path}.`, {
      category: 'schema',
      hint: 'Check that the file exists and is readable.',
      cause: error,
    });
  }
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new AppError('INVALID_JSON', `Invalid JSON in ${path}.`, {
      category: 'schema',
      hint: error instanceof Error ? error.message : undefined,
      cause: error,
    });
  }
}

export async function atomicWrite(
  path: string,
  data: string | Uint8Array,
  options: {overwrite?: boolean; mode?: number} = {},
): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', options.mode ?? 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (!options.overwrite) {
      try {
        await access(path);
        throw new AppError('OUTPUT_EXISTS', `Refusing to overwrite ${path}.`, {
          category: 'policy',
          hint: 'Choose a new path or explicitly allow overwrite.',
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
    }
    try {
      await rename(temporary, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!options.overwrite || !['EEXIST', 'EPERM'].includes(code ?? '')) throw error;
      // Windows cannot atomically replace an existing file. The durable temp is
      // only moved after the old internal state file has been removed.
      await rm(path, {force: true});
      await rename(temporary, path);
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, {force: true}).catch(() => undefined);
  }
}

export async function atomicWriteJson(
  path: string,
  value: unknown,
  options: {overwrite?: boolean} = {},
): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, options);
}

function ensureRelativeInput(input: string): void {
  if (
    input.length === 0 ||
    input.includes('\0') ||
    isAbsolute(input) ||
    /^[a-zA-Z]:[\\/]/u.test(input) ||
    /^\\\\/u.test(input) ||
    /^file:/iu.test(input)
  ) {
    throw new AppError('UNSAFE_PATH', `Path must be relative to the workspace: ${input}`, {
      category: 'policy',
    });
  }
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
}

async function nearestExisting(path: string): Promise<string> {
  let candidate = path;
  for (;;) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return candidate;
      candidate = parent;
    }
  }
}

export async function resolveInside(
  workspaceRoot: string,
  input: string,
  options: {mustExist?: boolean} = {},
): Promise<string> {
  ensureRelativeInput(input);
  const root = await realpath(resolve(workspaceRoot));
  const candidate = resolve(root, input);
  if (!isWithin(root, candidate)) {
    throw new AppError('PATH_ESCAPE', `Path escapes the workspace: ${input}`, {category: 'policy'});
  }

  if (options.mustExist) {
    let resolvedCandidate: string;
    try {
      resolvedCandidate = await realpath(candidate);
    } catch (error) {
      throw new AppError('FILE_NOT_FOUND', `File does not exist: ${input}`, {
        category: 'schema',
        cause: error,
      });
    }
    if (!isWithin(root, resolvedCandidate)) {
      throw new AppError('SYMLINK_ESCAPE', `Symlink escapes the workspace: ${input}`, {category: 'policy'});
    }
    return resolvedCandidate;
  }

  const existingParent = await realpath(await nearestExisting(candidate));
  if (!isWithin(root, existingParent)) {
    throw new AppError('SYMLINK_ESCAPE', `Parent symlink escapes the workspace: ${input}`, {category: 'policy'});
  }
  return candidate;
}

export function relativePortable(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

export async function ensureSafeDirectory(workspaceRoot: string, input: string): Promise<string> {
  const candidate = await resolveInside(workspaceRoot, input);
  await mkdir(candidate, {recursive: true});
  const verified = await resolveInside(workspaceRoot, input, {mustExist: true});
  const root = await realpath(resolve(workspaceRoot));
  const segments = relative(root, candidate).split(sep).filter(Boolean);
  let cursor = root;
  for (const segment of segments) {
    cursor = resolve(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) {
      throw new AppError('SYMLINK_DIRECTORY_REJECTED', `Internal write directory cannot be a symlink: ${input}`, {
        category: 'policy',
      });
    }
  }
  return verified;
}
