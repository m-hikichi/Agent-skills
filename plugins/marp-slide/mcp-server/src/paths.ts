import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export type PathKind = "input" | "output" | "directory";

export interface ResolvePathOptions {
  kind: PathKind;
  extensions?: readonly string[];
  mustExist?: boolean;
  allowWorkspaceRoot?: boolean;
}

function normalizeUserPath(input: string): string {
  if (input.includes("\0")) {
    throw new Error("path must not contain a NUL byte");
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("path must not be empty");
  }
  if (/^(?:[A-Za-z]:|[\\/]{2})/.test(trimmed) || isAbsolute(trimmed)) {
    throw new Error("path must be relative to the workspace root");
  }

  return trimmed.replace(/[\\/]+/g, sep);
}

export function isPathInside(
  workspace: string,
  candidate: string,
  allowWorkspaceRoot = false
): boolean {
  const rel = relative(workspace, candidate);
  if (rel === "") {
    return allowWorkspaceRoot;
  }
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function nearestExistingAncestor(candidate: string): string {
  let current = candidate;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`cannot resolve an existing ancestor for ${candidate}`);
    }
    current = parent;
  }
  return current;
}

/**
 * Resolve a user-provided workspace-relative path and reject both lexical and
 * symlink-based workspace escapes. Output paths are checked through their
 * nearest existing ancestor so a symlinked output directory cannot redirect a
 * write outside the workspace.
 */
export function resolveWorkspacePath(
  workspace: string,
  input: string,
  fieldName: string,
  options: ResolvePathOptions
): string {
  const workspacePath = realpathSync(resolve(workspace));
  const normalized = normalizeUserPath(input);
  const candidate = resolve(workspacePath, normalized);

  if (!isPathInside(workspacePath, candidate, options.allowWorkspaceRoot)) {
    throw new Error(`${fieldName} must stay within the workspace root`);
  }

  const mustExist = options.mustExist ?? options.kind === "input";
  if (mustExist && !existsSync(candidate)) {
    throw new Error(`${fieldName} does not exist: ${input}`);
  }

  const ancestor = nearestExistingAncestor(candidate);
  const realAncestor = realpathSync(ancestor);
  if (!isPathInside(workspacePath, realAncestor, options.allowWorkspaceRoot)) {
    throw new Error(`${fieldName} resolves outside the workspace root`);
  }
  const canonicalCandidate = resolve(realAncestor, relative(ancestor, candidate));
  if (!isPathInside(workspacePath, canonicalCandidate, options.allowWorkspaceRoot)) {
    throw new Error(`${fieldName} resolves outside the workspace root`);
  }

  let resolvedExisting: string | null = null;
  if (existsSync(candidate)) {
    const realCandidate = realpathSync(candidate);
    if (!isPathInside(workspacePath, realCandidate, options.allowWorkspaceRoot)) {
      throw new Error(`${fieldName} resolves outside the workspace root`);
    }
    if (options.kind === "input" && !statSync(realCandidate).isFile()) {
      throw new Error(`${fieldName} must be a file: ${input}`);
    }
    if (options.kind === "directory" && !statSync(realCandidate).isDirectory()) {
      throw new Error(`${fieldName} must be a directory: ${input}`);
    }
    resolvedExisting = realCandidate;
    if (options.kind === "output" && lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`${fieldName} must not be a symbolic link`);
    }
  }

  if (options.extensions?.length) {
    const actual = extname(candidate).toLowerCase();
    const expected = options.extensions.map((extension) => extension.toLowerCase());
    if (!expected.includes(actual)) {
      throw new Error(
        `${fieldName} must use ${expected.join(" or ")} extension: ${input}`
      );
    }
  }

  // Canonical paths keep renderer/lifecycle fingerprints identical and prevent
  // a symlink alias from bypassing collision checks before cleanup.
  return resolvedExisting ??
    (options.kind === "output" || options.kind === "directory"
      ? canonicalCandidate
      : candidate);
}

export function assertDistinctPaths(
  outputPath: string,
  inputs: readonly (string | undefined)[]
): void {
  const canonical = (path: string) => {
    const normalized = existsSync(path) ? realpathSync(path) : resolve(path);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const normalizedOutput = canonical(outputPath);
  for (const input of inputs) {
    if (input && canonical(input) === normalizedOutput) {
      throw new Error("output path must not overwrite an input file");
    }
  }
}

export function toWorkspaceRelative(workspace: string, filePath: string): string {
  const rel = relative(realpathSync(resolve(workspace)), resolve(filePath));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path is not a workspace file: ${filePath}`);
  }
  return rel.split(sep).join("/");
}

export function sha256Buffer(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(filePath: string): string {
  return sha256Buffer(readFileSync(filePath));
}

export function decodeLocalReference(reference: string): string | null {
  const trimmed = reference.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  if (/^data:/i.test(trimmed)) {
    throw new Error("data URLs are not allowed; store the asset in the workspace");
  }
  if (trimmed.includes("\\")) {
    throw new Error(`resource paths must use POSIX separators: ${trimmed}`);
  }
  if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(trimmed)) {
    throw new Error(`external resource is not allowed: ${trimmed}`);
  }

  const withoutFragment = trimmed.split("#", 1)[0].split("?", 1)[0];
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    throw new Error(`resource path is not valid URI encoding: ${trimmed}`);
  }
}

export function resolveAssetReference(
  workspace: string,
  ownerPath: string,
  reference: string,
  fieldName = "asset"
): string | null {
  const decoded = decodeLocalReference(reference);
  if (decoded === null) {
    return null;
  }
  const workspacePath = realpathSync(resolve(workspace));
  const absolute = resolve(dirname(ownerPath), decoded.replace(/[\\/]+/g, sep));
  if (!isPathInside(workspacePath, absolute)) {
    throw new Error(`${fieldName} escapes the workspace: ${reference}`);
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`${fieldName} does not exist: ${reference}`);
  }
  const real = realpathSync(absolute);
  if (!isPathInside(workspacePath, real)) {
    throw new Error(`${fieldName} resolves outside the workspace: ${reference}`);
  }
  return real;
}
