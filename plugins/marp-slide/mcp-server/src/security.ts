import { extname } from "node:path";
import { readFileSync } from "node:fs";
import { resolveAssetReference } from "./paths.js";

const URL_PATTERN = /\burl\(\s*(['"]?)(.*?)\1\s*\)/gim;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/gim;
const HTML_RESOURCE_PATTERN = /(?:^|[\s<])(?:src|poster)\s*=\s*(['"])(.*?)\1/gim;
const HTML_STYLE_PATTERN = /(?:^|[\s<])style\s*=\s*(['"])(.*?)\1/gim;
const SVG_HREF_PATTERN = /(?:^|[\s<])(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/gim;
const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s;)]+))\s*\)?\s*;/gim;
const BUILT_IN_MARP_THEMES = new Set(["default", "gaia", "uncover"]);

export function hasMarpFrontmatter(content: string): boolean {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return Boolean(match && /^marp:\s*(?:true|True|TRUE)\s*$/m.test(match[1]));
}

export function hasEnabledHtmlFrontmatter(content: string): boolean {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return Boolean(
    match && /^html:\s*(?:true|True|TRUE)\s*(?:#.*)?$/m.test(match[1])
  );
}

export function hasHeadingDividerFrontmatter(content: string): boolean {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return Boolean(match && /^headingDivider\s*:/m.test(match[1]));
}

function collectMatches(content: string, pattern: RegExp, group: number): string[] {
  const matches: string[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const value = match[group];
    if (value) {
      matches.push(value);
    }
  }
  return matches;
}

function assertNoActiveSvgContent(svg: string, label: string): void {
  const prohibited = [
    /<\s*script\b/i,
    /<\s*foreignObject\b/i,
    /<\s*(?:animate|animateMotion|animateTransform|set|discard|mpath)\b/i,
    /<\s*(?:iframe|object|embed|audio|video)\b/i,
    /<!DOCTYPE\b/i,
    /<\?xml-stylesheet\b/i,
    /@import\b/i,
    /\son[a-z]+\s*=/i,
    /javascript\s*:/i,
  ];
  if (prohibited.some((pattern) => pattern.test(svg))) {
    throw new Error(`${label} contains prohibited active SVG content`);
  }
}

function normalizeMarkdownReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function collectMarkdownReferenceDefinitions(markdown: string): Map<string, string> {
  const definitions = new Map<string, string>();
  const definitionPattern =
    /^[\t ]{0,3}\[([^\]\r\n]+)\]:[\t ]*(?:<([^>\r\n]+)>|([^\s\r\n]+))/gm;
  let match: RegExpExecArray | null;
  while ((match = definitionPattern.exec(markdown)) !== null) {
    const label = normalizeMarkdownReferenceLabel(match[1]);
    if (!definitions.has(label)) definitions.set(label, match[2] ?? match[3]);
  }
  return definitions;
}

function withoutFencedCode(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let fence: { marker: "`" | "~"; length: number } | null = null;
  return lines
    .map((line) => {
      const match = /^[\t ]{0,3}(`{3,}|~{3,})/.exec(line);
      if (match) {
        const marker = match[1][0] as "`" | "~";
        if (!fence) {
          fence = { marker, length: match[1].length };
          return "";
        }
        if (marker === fence.marker && match[1].length >= fence.length) {
          fence = null;
        }
        return "";
      }
      return fence
        ? ""
        : line.replace(/(`+)(.*?)\1/g, (code) => " ".repeat(code.length));
    })
    .join("\n");
}

function collectFrontmatterValues(markdown: string, key: string): string[] {
  const frontmatter = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontmatter) return [];
  const lines = frontmatter.replace(/\r\n?/g, "\n").split("\n");
  const keyPattern = new RegExp(`^${key}:\\s*(.*)$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = keyPattern.exec(lines[index]);
    if (!match) continue;
    const value = match[1].trim();
    if (!/^[|>][+-]?$/.test(value)) return value ? [value] : [];
    const block: string[] = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() && !/^[ \t]/.test(line)) break;
      block.push(line.replace(/^[ \t]+/, ""));
    }
    return [block.join(value.startsWith(">") ? " " : "\n")];
  }
  return [];
}

/** Resolve only link definitions that are actually consumed by an image.
 * Ordinary reference-style links may point at citations on the web and must
 * not be treated as render-time resources. */
function collectReferenceStyleImageTargets(markdown: string): string[] {
  const definitions = collectMarkdownReferenceDefinitions(markdown);
  let match: RegExpExecArray | null;
  const labels: string[] = [];
  const fullOrCollapsed = /!\[([^\]\r\n]*)\]\[([^\]\r\n]*)\]/g;
  while ((match = fullOrCollapsed.exec(markdown)) !== null) {
    labels.push(match[2] || match[1]);
  }
  const shortcut = /!\[([^\]\r\n]+)\](?!\s*[\[(])/g;
  while ((match = shortcut.exec(markdown)) !== null) labels.push(match[1]);

  const targets = new Set<string>();
  for (const label of labels) {
    const target = definitions.get(normalizeMarkdownReferenceLabel(label));
    if (target) targets.add(target);
  }
  return [...targets];
}

function addResolvedReference(
  workspace: string,
  ownerPath: string,
  reference: string,
  assets: Set<string>,
  pending: string[]
): void {
  const resolved = resolveAssetReference(workspace, ownerPath, reference);
  if (!resolved || assets.has(resolved)) {
    return;
  }
  assets.add(resolved);
  if ([".css", ".svg"].includes(extname(resolved).toLowerCase())) {
    pending.push(resolved);
  }
}

function scanCss(
  workspace: string,
  cssPath: string,
  css: string,
  assets: Set<string>,
  pending: string[],
  allowBuiltInImports = false
): void {
  let cssWithoutImports = css;
  CSS_IMPORT_PATTERN.lastIndex = 0;
  const imports = [...css.matchAll(CSS_IMPORT_PATTERN)];
  if (/@import\b/i.test(css) && imports.length === 0) {
    throw new Error(`CSS contains a malformed or unsupported @import: ${cssPath}`);
  }
  for (const match of imports) {
    const target = (match[1] ?? match[2] ?? match[3]).trim();
    if (!allowBuiltInImports || !BUILT_IN_MARP_THEMES.has(target)) {
      throw new Error(`CSS @import is not allowed: ${target}`);
    }
  }
  cssWithoutImports = css.replace(CSS_IMPORT_PATTERN, "");
  if (/@import\b/i.test(cssWithoutImports)) {
    throw new Error(`CSS contains a malformed or unsupported @import: ${cssPath}`);
  }
  for (const reference of collectMatches(cssWithoutImports, URL_PATTERN, 2)) {
    addResolvedReference(workspace, cssPath, reference, assets, pending);
  }
}

function scanSvg(
  workspace: string,
  svgPath: string,
  svg: string,
  assets: Set<string>,
  pending: string[]
): void {
  assertNoActiveSvgContent(svg, svgPath);
  for (const reference of [
    ...collectMatches(svg, URL_PATTERN, 2),
    ...collectMatches(svg, SVG_HREF_PATTERN, 2),
  ]) {
    addResolvedReference(workspace, svgPath, reference, assets, pending);
  }
}

function scanMarkdown(
  workspace: string,
  markdownPath: string,
  markdown: string,
  assets: Set<string>,
  pending: string[]
): void {
  const activeMarkdown = withoutFencedCode(markdown);
  for (const match of collectMatches(activeMarkdown, MARKDOWN_IMAGE_PATTERN, 1)) {
    addResolvedReference(workspace, markdownPath, match, assets, pending);
  }
  for (const match of collectMatches(activeMarkdown, MARKDOWN_IMAGE_PATTERN, 2)) {
    addResolvedReference(workspace, markdownPath, match, assets, pending);
  }
  for (const match of collectReferenceStyleImageTargets(activeMarkdown)) {
    addResolvedReference(workspace, markdownPath, match, assets, pending);
  }
  for (const match of collectMatches(activeMarkdown, HTML_RESOURCE_PATTERN, 2)) {
    addResolvedReference(workspace, markdownPath, match, assets, pending);
  }
  for (const style of collectFrontmatterValues(markdown, "style")) {
    scanCss(workspace, markdownPath, style, assets, pending, false);
  }
  const backgroundImages = [
    ...collectFrontmatterValues(markdown, "backgroundImage"),
    ...[...activeMarkdown.matchAll(/<!--\s*_?backgroundImage\s*:\s*([\s\S]*?)-->/gim)].map(
      (match) => match[1]
    ),
  ];
  for (const backgroundImage of backgroundImages) {
    scanCss(workspace, markdownPath, backgroundImage, assets, pending, false);
  }
  for (const styleMatch of activeMarkdown.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gim)) {
    scanCss(workspace, markdownPath, styleMatch[1], assets, pending, false);
  }
  for (const style of collectMatches(activeMarkdown, HTML_STYLE_PATTERN, 2)) {
    scanCss(workspace, markdownPath, style, assets, pending, false);
  }
}

/**
 * Discover every local resource referenced by the deck and custom theme.
 * Remote resources, missing files, active SVG, CSS imports, path traversal,
 * and symlink escapes fail before Chromium receives the document.
 */
export function discoverDeckAssets(
  workspace: string,
  sourcePath: string,
  themePath?: string
): string[] {
  const source = readFileSync(sourcePath, "utf8");
  const assets = new Set<string>();
  const pending: string[] = [];

  scanMarkdown(workspace, sourcePath, source, assets, pending);

  if (themePath) {
    scanCss(
      workspace,
      themePath,
      readFileSync(themePath, "utf8"),
      assets,
      pending,
      true
    );
  }

  while (pending.length > 0) {
    const assetPath = pending.pop()!;
    const content = readFileSync(assetPath, "utf8");
    if (extname(assetPath).toLowerCase() === ".css") {
      scanCss(workspace, assetPath, content, assets, pending, false);
    } else {
      scanSvg(workspace, assetPath, content, assets, pending);
    }
  }

  return [...assets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Include seed files and recursively follow local references from Markdown,
 * CSS, and SVG. Used for asset-manifest source/spec files so renderer and
 * lifecycle compute the same input closure. */
export function discoverLocalDependencies(
  workspace: string,
  seedPaths: readonly string[]
): string[] {
  const assets = new Set<string>(seedPaths);
  const pending = seedPaths.filter((path) =>
    [".md", ".css", ".svg"].includes(extname(path).toLowerCase())
  );
  const scanned = new Set<string>();
  while (pending.length > 0) {
    const filePath = pending.pop()!;
    if (scanned.has(filePath)) continue;
    scanned.add(filePath);
    const content = readFileSync(filePath, "utf8");
    const extension = extname(filePath).toLowerCase();
    if (extension === ".md") {
      scanMarkdown(workspace, filePath, content, assets, pending);
    } else if (extension === ".css") {
      scanCss(workspace, filePath, content, assets, pending, false);
    } else {
      scanSvg(workspace, filePath, content, assets, pending);
    }
  }
  return [...assets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function assertSafeStaticSvg(svg: string, label = "SVG"): void {
  assertNoActiveSvgContent(svg, label);
  for (const reference of [
    ...collectMatches(svg, URL_PATTERN, 2),
    ...collectMatches(svg, SVG_HREF_PATTERN, 2),
  ]) {
    const value = reference.trim();
    if (value.startsWith("#")) {
      continue;
    }
    throw new Error(`${label} contains a non-embedded resource: ${value}`);
  }
}

export function assertSafeMermaidSource(source: string): void {
  const prohibited = [
    /^\uFEFF?[\t ]*---[\t ]*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
    /%%\{\s*(?:init|config)\s*:/i,
    /\bclick\s+\S+\s+(?:href|call)\b/i,
    /<\s*(?:script|iframe|foreignObject)\b/i,
    /\bon[a-z]+\s*=/i,
    /(?:javascript|https?|file)\s*:/i,
  ];
  if (prohibited.some((pattern) => pattern.test(source))) {
    throw new Error("Mermaid source contains prohibited configuration or active content");
  }
}

export function assertSafeVegaLiteSpec(spec: unknown): void {
  const visit = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, key));
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.mark === "image" || (record.mark as { type?: string } | undefined)?.type === "image") {
      throw new Error("Vega-Lite image marks are not allowed in offline chart rendering");
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (childKey === "values" || childKey === "datasets") {
        // Inline data rows may legitimately have columns named `url` or
        // `href`; they are inert unless an image/href encoding is present,
        // which is rejected elsewhere in this walk.
        continue;
      }
      if (childKey === "href") {
        throw new Error("Vega-Lite href encodings are not allowed");
      }
      if (childKey === "sample") {
        throw new Error("Vega-Lite sample transforms are not allowed in deterministic rendering");
      }
      if (
        typeof child === "string" &&
        ["calculate", "expr", "filter", "signal", "test"].includes(childKey) &&
        /\b(?:now|random)\s*\(/i.test(child)
      ) {
        throw new Error("Vega-Lite expressions must not use random() or now()");
      }
      if (childKey === "url" && key !== "data") {
        throw new Error("Vega-Lite resource URLs are only allowed for local data files");
      }
      visit(child, childKey);
    }
  };
  visit(spec);
}

export interface MissingImageAlt {
  line: number;
  target: string;
  reason: "missing" | "generic";
}

/** Static accessibility check used by machine QA before generated emoji or
 * Marp chrome can add unrelated <img> elements to the rendered document. */
export function findMissingInformativeImageAlt(
  markdown: string,
  decorativeTargets: ReadonlySet<string> = new Set()
): MissingImageAlt[] {
  const findings: Array<{ index: number; order: number; finding: MissingImageAlt }> = [];
  let findingOrder = 0;
  const generic = /^(?:bg|background|image|img|photo|picture|図|画像)$/i;
  const activeMarkdown = withoutFencedCode(markdown);
  const definitions = collectMarkdownReferenceDefinitions(activeMarkdown);
  const lineFor = (index: number) =>
    activeMarkdown.slice(0, index).split("\n").length;
  const inspectAlt = (index: number, target: string, alt: string): void => {
    const rawTarget = target.split(/[?#]/, 1)[0];
    let normalizedTarget = rawTarget;
    try {
      normalizedTarget = decodeURIComponent(rawTarget);
    } catch {
      // Asset discovery reports invalid percent-encoding before QA. Retain the
      // original token here so the accessibility report stays serializable.
    }
    if (decorativeTargets.has(normalizedTarget)) return;
    const normalizedAlt = alt.trim();
    const semanticAlt = normalizedAlt
      .split(/\s+/)
      .filter(
        (token) =>
          !/^(?:bg|cover|contain|left|right|vertical|horizontal|auto)$/i.test(token) &&
          !/^(?:w|h):\d+(?:\.\d+)?(?:px|%)?$/i.test(token) &&
          !/^(?:left|right):\d+(?:\.\d+)?%$/i.test(token) &&
          !/^(?:blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia):\S+$/i.test(token) &&
          !/^\d+(?:\.\d+)?%$/.test(token)
      )
      .join(" ");
    if (!normalizedAlt) {
      findings.push({
        index,
        order: findingOrder++,
        finding: { line: lineFor(index), target: normalizedTarget, reason: "missing" },
      });
    } else if (!semanticAlt || generic.test(semanticAlt)) {
      findings.push({
        index,
        order: findingOrder++,
        finding: { line: lineFor(index), target: normalizedTarget, reason: "generic" },
      });
    }
  };
  let match: RegExpExecArray | null;
  const imagePattern = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
  while ((match = imagePattern.exec(activeMarkdown)) !== null) {
    inspectAlt(match.index, match[2] || match[3], match[1]);
  }

  const fullOrCollapsed = /!\[([^\]]*)\]\[([^\]]*)\]/g;
  while ((match = fullOrCollapsed.exec(activeMarkdown)) !== null) {
    const label = match[2] || match[1];
    const target = definitions.get(normalizeMarkdownReferenceLabel(label));
    if (target) inspectAlt(match.index, target, match[1]);
  }

  const shortcut = /!\[([^\]]+)\](?!\s*[\[(])/g;
  while ((match = shortcut.exec(activeMarkdown)) !== null) {
    const target = definitions.get(normalizeMarkdownReferenceLabel(match[1]));
    if (target) inspectAlt(match.index, target, match[1]);
  }

  const htmlPattern = /<img\b([^>]*)>/gi;
  while ((match = htmlPattern.exec(activeMarkdown)) !== null) {
    const attributes = match[1];
    const target = attributes.match(/(?:^|\s)src\s*=\s*(['"])(.*?)\1/i)?.[2] ?? "<inline-img>";
    const alt = attributes.match(/(?:^|\s)alt\s*=\s*(['"])(.*?)\1/i)?.[2]?.trim();
    inspectAlt(match.index, target, alt ?? "");
  }
  return findings
    .sort((a, b) => a.index - b.index || a.order - b.order)
    .map(({ finding }) => finding);
}
