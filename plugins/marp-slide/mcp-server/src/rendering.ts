import { Marp } from "@marp-team/marp-core";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { platform } from "node:os";
import sharp from "sharp";
import type { CommandRunner } from "./diagram.js";
import { synchronousCommandRunner } from "./diagram.js";
import {
  assertDistinctPaths,
  isPathInside,
  resolveWorkspacePath,
  sha256Buffer,
  sha256File,
  toWorkspaceRelative,
} from "./paths.js";
import {
  discoverDeckAssets,
  discoverLocalDependencies,
  hasEnabledHtmlFrontmatter,
  hasHeadingDividerFrontmatter,
  hasMarpFrontmatter,
} from "./security.js";
import {
  machineQaSummaryPath,
  writeMachineQa,
  type MachineQaReport,
} from "./machine-qa.js";

export const MARP_FORMATS = ["html", "pdf", "pptx", "png"] as const;
export type MarpFormat = (typeof MARP_FORMATS)[number];
export type ActualFormat = MarpFormat | "notes";

export interface RenderDeckInput {
  source: string;
  theme?: string;
  formats?: MarpFormat[];
  output_dir?: string;
  image_scale?: number;
}

export interface LegacyExportInput {
  source: string;
  format: MarpFormat;
  output?: string;
  theme?: string;
}

interface Snapshot {
  path: string;
  sha256: string;
}

export interface PageImage extends Snapshot {
  slide: number;
  width: number;
  height: number;
}

interface OutputSnapshot extends Snapshot {
  format: "html" | "pdf" | "pptx" | "notes";
}

interface Improvement {
  iteration: number;
  description: string;
  slides: number[];
}

interface FontSnapshot {
  name: string;
  url: string;
  sha256: string;
}

export interface RenderManifest {
  schema_version: 1;
  generated_at: string;
  artifact_fingerprint: string;
  render_iteration: number;
  improvements: Improvement[];
  slide_count: number;
  source: Snapshot;
  request: Snapshot;
  theme: Snapshot | null;
  assets: Snapshot[];
  formats: ActualFormat[];
  outputs: OutputSnapshot[];
  page_images: PageImage[];
  contact_sheet: (Snapshot & { width: number; height: number }) | null;
  environment: {
    marp_cli: string;
    marp_core: string;
    chromium: string;
    node: string;
    platform: string;
    fonts: FontSnapshot[];
  };
}

export interface LegacyExportResult {
  format: MarpFormat;
  outputs: string[];
  theme: string | null;
}

export interface RenderDeckResult {
  manifest_path: string;
  machine_qa_path: string;
  manifest: RenderManifest;
  machine_qa: MachineQaReport;
}

const FORMAT_ORDER: ActualFormat[] = ["html", "pdf", "pptx", "png", "notes"];
const PINNED_MARP_CLI_VERSION = "4.4.0";
const PINNED_MARP_CORE_VERSION = "4.3.0";
const PINNED_CHROMIUM_VERSION = "150.0.7871.100";
const GOOGLE_FONTS_COMMIT = "ec0464b978de222073645d6d3366f3fdf03376d8";
export const PINNED_FONTS: FontSnapshot[] = [
  {
    name: "BIZ UDPGothic Regular",
    url: `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/bizudpgothic/BIZUDPGothic-Regular.ttf`,
    sha256: "258d7156c165f2ff774b6efee637c22c3b950de0d8a10e501137061bc8085d01",
  },
  {
    name: "BIZ UDPGothic Bold",
    url: `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/bizudpgothic/BIZUDPGothic-Bold.ttf`,
    sha256: "30eba52fc837e8b62c97d4b82e6706583149fb7294e3712dd71a655eaea80a90",
  },
  {
    name: "Source Code Pro Variable",
    url: `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/sourcecodepro/SourceCodePro%5Bwght%5D.ttf`,
    sha256: "b400fc584e10aff25d0e775ce181b4fc1c5ea1b5dc37b81aeb2084375b945790",
  },
  {
    name: "Source Code Pro Italic Variable",
    url: `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/sourcecodepro/SourceCodePro-Italic%5Bwght%5D.ttf`,
    sha256: "6db77d25aa7b30eff449305b5c998e475694c74d398421127ea5a60f536413cd",
  },
];

const PINNED_GOOGLE_FONT_PATHS = [
  "/usr/share/fonts/google/BIZUDPGothic-Regular.ttf",
  "/usr/share/fonts/google/BIZUDPGothic-Bold.ttf",
  "/usr/share/fonts/google/SourceCodePro.ttf",
  "/usr/share/fonts/google/SourceCodePro-Italic.ttf",
] as const;

const NOTO_CJK_VERSION = "1:20220127+repack1-1";
const PINNED_SYSTEM_FONT_FILES = [
  {
    name: "Noto Sans CJK Regular TTC",
    path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  },
  {
    name: "Noto Sans CJK Bold TTC",
    path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  },
  {
    name: "Noto Serif CJK Regular TTC",
    path: "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  },
  {
    name: "Noto Serif CJK Bold TTC",
    path: "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
  },
] as const;

let cachedFontSnapshot: FontSnapshot[] | null = null;

function fontSnapshot(): FontSnapshot[] {
  if (cachedFontSnapshot) return cachedFontSnapshot;
  const googleFonts = PINNED_FONTS.map((font, index) => {
    const filePath = PINNED_GOOGLE_FONT_PATHS[index];
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new Error(`required pinned font is missing: ${filePath ?? font.name}`);
    }
    const actual = sha256File(filePath);
    if (actual !== font.sha256) {
      throw new Error(`pinned font hash mismatch: ${filePath}`);
    }
    return font;
  });
  const systemFonts = PINNED_SYSTEM_FONT_FILES.map((font) => {
    if (!existsSync(font.path) || !statSync(font.path).isFile()) {
      throw new Error(`required pinned font is missing: ${font.path}`);
    }
    return {
      name: font.name,
      url: `https://packages.debian.org/bookworm/fonts-noto-cjk#${encodeURIComponent(NOTO_CJK_VERSION)}`,
      sha256: sha256File(font.path),
    };
  });
  cachedFontSnapshot = [...googleFonts, ...systemFonts];
  return cachedFontSnapshot;
}

function formatExtension(format: ActualFormat): string {
  return format === "notes" ? ".txt" : `.${format}`;
}

export function buildMarpArgs(
  sourcePath: string,
  outputPath: string,
  format: ActualFormat,
  options: { themePath?: string; imageScale: number; browserPath?: string }
): string[] {
  const args = [sourcePath, "--no-config-file", "--allow-local-files"];
  if (options.themePath) {
    args.push("--theme-set", options.themePath);
  }
  if (options.browserPath) {
    args.push("--browser-path", options.browserPath);
  }
  if (format === "png") {
    args.push("--images", "png", "--image-scale", String(options.imageScale));
  } else if (format === "pdf") {
    args.push("--pdf", "--pdf-outlines");
  } else if (format === "pptx") {
    args.push("--pptx", "--image-scale", String(options.imageScale));
  } else if (format === "notes") {
    args.push("--notes");
  }
  args.push("--output", outputPath);
  return args;
}

function runMarp(
  workspace: string,
  sourcePath: string,
  outputPath: string,
  format: ActualFormat,
  themePath: string | undefined,
  imageScale: number,
  runner: CommandRunner
): void {
  runner.run(
    process.env.MARP_BIN || "marp",
    buildMarpArgs(sourcePath, outputPath, format, {
      themePath,
      imageScale,
      browserPath: process.env.CHROME_PATH,
    }),
    { cwd: workspace, timeout: 180_000 }
  );
}

function normalizePngOutputNames(pageDirectory: string): void {
  const rawPattern = /^page\.(\d+)\.png$/i;
  const alreadyNormalized = /^page-(\d+)\.png$/i;
  for (const entry of readdirSync(pageDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      throw new Error(`unexpected non-file in rendered-pages: ${entry.name}`);
    }
    const raw = entry.name.match(rawPattern);
    const normalized = entry.name.match(alreadyNormalized);
    if (!raw && !normalized) {
      throw new Error(`unexpected file in rendered-pages: ${entry.name}`);
    }
    const slide = Number((raw || normalized)![1]);
    const normalizedName = `page-${String(slide).padStart(3, "0")}.png`;
    if (entry.name !== normalizedName) {
      const target = resolve(pageDirectory, normalizedName);
      if (existsSync(target)) {
        throw new Error(`duplicate rendered page number: ${slide}`);
      }
      renameSync(resolve(pageDirectory, entry.name), target);
    }
  }
}

export function readPngDimensions(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath);
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error(`not a valid PNG file: ${filePath}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new Error(`PNG has invalid dimensions: ${filePath}`);
  }
  return { width, height };
}

function collectPageImages(workspace: string, pageDirectory: string): PageImage[] {
  const files = readdirSync(pageDirectory)
    .map((name) => ({ name, match: name.match(/^page-(\d{3,})\.png$/) }))
    .filter((entry): entry is { name: string; match: RegExpMatchArray } => Boolean(entry.match))
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
  if (files.length === 0) {
    throw new Error("Marp did not generate any PNG page images");
  }
  return files.map((entry, index) => {
    const slide = Number(entry.match[1]);
    if (slide !== index + 1) {
      throw new Error(`rendered page sequence is not consecutive at slide ${index + 1}`);
    }
    const filePath = resolve(pageDirectory, entry.name);
    return {
      slide,
      path: toWorkspaceRelative(workspace, filePath),
      sha256: sha256File(filePath),
      ...readPngDimensions(filePath),
    };
  });
}

export interface ContactSheetPlan {
  width: number;
  height: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  columns: number;
  rows: number;
  placements: Array<{ slide: number; left: number; top: number; labelTop: number }>;
}

export function planContactSheet(pageImages: PageImage[]): ContactSheetPlan {
  if (pageImages.length === 0) {
    throw new Error("contact sheet requires at least one page");
  }
  const thumbnailWidth = 320;
  const thumbnailHeight = Math.max(
    1,
    Math.round((thumbnailWidth * pageImages[0].height) / pageImages[0].width)
  );
  const columns = Math.min(4, Math.ceil(Math.sqrt(pageImages.length)));
  const rows = Math.ceil(pageImages.length / columns);
  const margin = 24;
  const gap = 20;
  const labelHeight = 28;
  const cellHeight = thumbnailHeight + labelHeight;
  const width = margin * 2 + columns * thumbnailWidth + (columns - 1) * gap;
  const height = margin * 2 + rows * cellHeight + (rows - 1) * gap;
  return {
    width,
    height,
    thumbnailWidth,
    thumbnailHeight,
    columns,
    rows,
    placements: pageImages.map((page, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const left = margin + column * (thumbnailWidth + gap);
      const top = margin + row * (cellHeight + gap);
      return { slide: page.slide, left, top, labelTop: top + thumbnailHeight };
    }),
  };
}

async function renderContactSheet(
  workspace: string,
  outputPath: string,
  pageImages: PageImage[]
): Promise<Snapshot & { width: number; height: number }> {
  const plan = planContactSheet(pageImages);
  const composites: sharp.OverlayOptions[] = [];
  for (const placement of plan.placements) {
    const page = pageImages.find((candidate) => candidate.slide === placement.slide)!;
    const pagePath = resolve(workspace, page.path);
    const thumbnail = await sharp(pagePath)
      .resize({
        width: plan.thumbnailWidth,
        height: plan.thumbnailHeight,
        fit: "contain",
        background: "#ffffff",
      })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer();
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.thumbnailWidth}" height="28"><rect width="100%" height="100%" fill="#ffffff"/><text x="8" y="20" font-family="sans-serif" font-size="16" fill="#273142">${placement.slide}</text></svg>`
    );
    composites.push({ input: thumbnail, left: placement.left, top: placement.top });
    composites.push({ input: label, left: placement.left, top: placement.labelTop });
  }
  await sharp({
    create: {
      width: plan.width,
      height: plan.height,
      channels: 4,
      background: "#e9edf2",
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(outputPath);
  return {
    path: toWorkspaceRelative(workspace, outputPath),
    sha256: sha256File(outputPath),
    width: plan.width,
    height: plan.height,
  };
}

function countSlides(source: string, theme?: string): number {
  const marp = new Marp({ html: false });
  if (theme) {
    marp.themeSet.add(theme);
  }
  const rendered = marp.render(source);
  const count = rendered.html.match(/<section\b/g)?.length ?? 0;
  if (count < 1) {
    throw new Error("Marp Core did not find any slides");
  }
  return count;
}

function snapshot(workspace: string, filePath: string): Snapshot {
  return {
    path: toWorkspaceRelative(workspace, filePath),
    sha256: sha256File(filePath),
  };
}

function findRequiredControlFile(
  workspace: string,
  outputDirectory: string,
  name: string
): string {
  const candidates = [resolve(outputDirectory, name), resolve(workspace, ".slide-work", name)];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return resolveWorkspacePath(workspace, toWorkspaceRelative(workspace, candidate), name, {
        kind: "input",
      });
    }
  }
  throw new Error(`${name} is required (expected in output_dir or .slide-work)`);
}

function collectListedAssetPaths(
  workspace: string,
  assetManifestPath: string
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(assetManifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `asset-manifest.json must be valid JSON: ${error instanceof Error ? error.message : error}`
    );
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { assets?: unknown }).assets)) {
    throw new Error("asset-manifest.json must contain an assets array");
  }
  const paths = new Set<string>();
  for (const [index, asset] of (parsed as { assets: unknown[] }).assets.entries()) {
    if (!asset || typeof asset !== "object" || typeof (asset as { path?: unknown }).path !== "string") {
      throw new Error(`asset-manifest.json assets[${index}].path must be a string`);
    }
    const assetPath = resolveWorkspacePath(
      workspace,
      (asset as { path: string }).path,
      `asset-manifest assets[${index}].path`,
      { kind: "input" }
    );
    paths.add(assetPath);
    const source = (asset as { source?: unknown }).source;
    if (
      source &&
      typeof source === "object" &&
      typeof (source as { path?: unknown }).path === "string" &&
      (source as { path: string }).path.trim()
    ) {
      const sourcePath = resolveWorkspacePath(
        workspace,
        (source as { path: string }).path,
        `asset-manifest assets[${index}].source.path`,
        { kind: "input" }
      );
      paths.add(sourcePath);
    }
    const generator = (asset as { generator?: unknown }).generator;
    if (
      generator &&
      typeof generator === "object" &&
      typeof (generator as { spec_path?: unknown }).spec_path === "string" &&
      (generator as { spec_path: string }).spec_path.trim()
    ) {
      const specPath = resolveWorkspacePath(
        workspace,
        (generator as { spec_path: string }).spec_path,
        `asset-manifest assets[${index}].generator.spec_path`,
        { kind: "input" }
      );
      paths.add(specPath);
    }
  }
  return [...paths];
}

export interface FingerprintFile extends Snapshot {
  kind: "request" | "source" | "theme" | "asset_manifest" | "asset";
}

export function computeArtifactFingerprint(files: FingerprintFile[]): string {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const deduplicated = new Map<string, FingerprintFile>();
  for (const file of files) {
    deduplicated.set(`${file.kind}\0${file.path}`, file);
  }
  const canonical = [...deduplicated.values()]
    .sort((a, b) => compare(a.kind, b.kind) || compare(a.path, b.path))
    .map(({ kind, path, sha256 }) => ({ kind, path, sha256 }));
  return sha256Buffer(JSON.stringify({ version: 1, files: canonical }));
}

function parseVersion(output: string, packageName: string): string {
  const match = output.match(new RegExp(`${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+v?(\\d+\\.\\d+\\.\\d+)`, "i"));
  return match?.[1] ?? output.trim().replace(/\s+/g, " ").slice(0, 160);
}

function environmentSnapshot(workspace: string, runner: CommandRunner): RenderManifest["environment"] {
  let marpVersion = PINNED_MARP_CLI_VERSION;
  let coreVersion = PINNED_MARP_CORE_VERSION;
  let chromium = "unavailable";
  const allowProbeFallback = runner !== synchronousCommandRunner;
  try {
    const output = runner.run(process.env.MARP_BIN || "marp", ["--version"], {
      cwd: workspace,
      timeout: 10_000,
    });
    marpVersion = parseVersion(output, "@marp-team/marp-cli");
    coreVersion = parseVersion(output, "@marp-team/marp-core");
    if (
      marpVersion !== PINNED_MARP_CLI_VERSION ||
      coreVersion !== PINNED_MARP_CORE_VERSION
    ) {
      throw new Error(
        `renderer version mismatch: Marp CLI ${marpVersion}, Marp Core ${coreVersion}`
      );
    }
  } catch (error) {
    if (!allowProbeFallback) throw error;
    marpVersion = PINNED_MARP_CLI_VERSION;
    coreVersion = PINNED_MARP_CORE_VERSION;
    // Package pins remain authoritative when a custom test runner does not
    // implement version probing.
  }
  try {
    chromium = runner
      .run(process.env.CHROME_PATH || "chromium", ["--version"], {
        cwd: workspace,
        timeout: 10_000,
      })
      .trim()
      .replace(/\s+/g, " ");
    if (!new RegExp(`\\b${PINNED_CHROMIUM_VERSION.replaceAll(".", "\\.")}\\b`).test(chromium)) {
      throw new Error(`Chromium version mismatch: ${chromium}`);
    }
  } catch (error) {
    if (!allowProbeFallback) throw error;
    chromium = "unavailable";
    // Rendering itself will fail if Chromium is actually required and absent.
  }
  return {
    marp_cli: marpVersion,
    marp_core: coreVersion,
    chromium,
    node: process.version,
    platform: `${platform()}-${process.arch}`,
    fonts: fontSnapshot(),
  };
}

function readPriorReviewState(manifestPath: string, sourcePath: string): {
  renderIteration: number;
  improvements: Improvement[];
} {
  if (!existsSync(manifestPath)) {
    return { renderIteration: 1, improvements: [] };
  }
  try {
    const prior = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    if (
      !prior.source ||
      typeof prior.source !== "object" ||
      (prior.source as Record<string, unknown>).path !== sourcePath
    ) {
      return { renderIteration: 1, improvements: [] };
    }
    const iteration = Number(prior.render_iteration);
    const improvements = Array.isArray(prior.improvements)
      ? prior.improvements.filter((value): value is Improvement => {
          if (!value || typeof value !== "object") return false;
          const item = value as Record<string, unknown>;
          return (
            Number.isInteger(item.iteration) &&
            Number(item.iteration) >= 2 &&
            typeof item.description === "string" &&
            item.description.trim().length > 0 &&
            Array.isArray(item.slides) &&
            item.slides.every((slide) => Number.isInteger(slide) && Number(slide) >= 1) &&
            new Set(item.slides).size === item.slides.length
          );
        })
      : [];
    return {
      renderIteration: Number.isInteger(iteration) && iteration >= 1 ? iteration + 1 : 1,
      improvements,
    };
  } catch {
    return { renderIteration: 1, improvements: [] };
  }
}

function writeManifest(manifestPath: string, manifest: RenderManifest): void {
  const temporary = resolve(
    dirname(manifestPath),
    `.render-manifest.${randomUUID()}.tmp`
  );
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    rmSync(manifestPath, { force: true });
    renameSync(temporary, manifestPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const activeDeckOutputDirectories = new Set<string>();

export async function renderDeck(
  workspace: string,
  input: RenderDeckInput,
  runner: CommandRunner = synchronousCommandRunner
): Promise<RenderDeckResult> {
  const outputDirectory = resolveWorkspacePath(
    workspace,
    input.output_dir ?? ".slide-work",
    "output_dir",
    { kind: "directory", mustExist: false }
  );
  const lockKey = process.platform === "win32"
    ? outputDirectory.toLowerCase()
    : outputDirectory;
  if (activeDeckOutputDirectories.has(lockKey)) {
    throw new Error(
      `another deck render is already using output_dir: ${input.output_dir ?? ".slide-work"}`
    );
  }
  activeDeckOutputDirectories.add(lockKey);
  try {
    return await renderDeckUnlocked(workspace, input, runner);
  } finally {
    activeDeckOutputDirectories.delete(lockKey);
  }
}

async function renderDeckUnlocked(
  workspace: string,
  input: RenderDeckInput,
  runner: CommandRunner = synchronousCommandRunner
): Promise<RenderDeckResult> {
  const sourcePath = resolveWorkspacePath(workspace, input.source, "source", {
    kind: "input",
    extensions: [".md"],
  });
  const themePath = input.theme
    ? resolveWorkspacePath(workspace, input.theme, "theme", {
        kind: "input",
        extensions: [".css"],
      })
    : undefined;
  const outputDirectory = resolveWorkspacePath(
    workspace,
    input.output_dir ?? ".slide-work",
    "output_dir",
    { kind: "directory", mustExist: false }
  );
  assertDistinctPaths(outputDirectory, [sourcePath, themePath]);

  const requestedFormats: MarpFormat[] = input.formats ?? ["pdf", "png"];
  if (requestedFormats.length === 0) {
    throw new Error("formats must contain at least one format");
  }
  if (
    requestedFormats.some(
      (format) => !MARP_FORMATS.includes(format as MarpFormat)
    )
  ) {
    throw new Error(`formats must use only: ${MARP_FORMATS.join(", ")}`);
  }
  if (new Set(requestedFormats).size !== requestedFormats.length) {
    throw new Error("formats must not contain duplicates");
  }
  // Review artifacts are part of every deterministic render, not an optional
  // export format. This keeps machine QA and lifecycle finalization valid even
  // when the caller only asks for PDF, HTML, or PPTX deliverables.
  const formats = [...new Set<MarpFormat>([...requestedFormats, "png"])].sort(
    (a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b)
  );
  const imageScale = input.image_scale ?? 2;
  if (!Number.isFinite(imageScale) || imageScale < 1 || imageScale > 4) {
    throw new Error("image_scale must be between 1 and 4");
  }

  const source = readFileSync(sourcePath, "utf8");
  if (!hasMarpFrontmatter(source)) {
    throw new Error(`source does not contain 'marp: true' in YAML frontmatter: ${input.source}`);
  }
  if (hasEnabledHtmlFrontmatter(source)) {
    throw new Error("frontmatter html: true is disabled; use static SVG and HTML-free slide content");
  }
  if (hasHeadingDividerFrontmatter(source)) {
    throw new Error("frontmatter headingDivider is not supported; use literal '---' slide boundaries");
  }
  const theme = themePath ? readFileSync(themePath, "utf8") : undefined;
  const slideCount = countSlides(source, theme);
  mkdirSync(outputDirectory, { recursive: true });
  const requestPath = findRequiredControlFile(workspace, outputDirectory, "request.yaml");
  const assetManifestPath = findRequiredControlFile(
    workspace,
    outputDirectory,
    "asset-manifest.json"
  );
  const listedAssetPaths = collectListedAssetPaths(workspace, assetManifestPath);
  const assetPaths = new Set<string>([
    ...discoverDeckAssets(workspace, sourcePath, themePath),
    ...discoverLocalDependencies(workspace, listedAssetPaths),
  ]);
  const assetSnapshots = [...assetPaths]
    .map((assetPath) => snapshot(workspace, assetPath))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sourceSnapshot = snapshot(workspace, sourcePath);
  const requestSnapshot = snapshot(workspace, requestPath);
  const themeSnapshot = themePath ? snapshot(workspace, themePath) : null;
  const fingerprintFiles: FingerprintFile[] = [
    { kind: "request", ...requestSnapshot },
    { kind: "source", ...sourceSnapshot },
    ...(themeSnapshot ? [{ kind: "theme" as const, ...themeSnapshot }] : []),
    { kind: "asset_manifest", ...snapshot(workspace, assetManifestPath) },
    ...assetSnapshots.map((asset) => ({
      kind: "asset" as const,
      ...asset,
    })),
  ];

  const manifestPath = resolve(outputDirectory, "render-manifest.json");
  const deckStem = basename(sourcePath, extname(sourcePath));
  const pageDirectory = resolve(outputDirectory, "rendered-pages");
  const protectedInputs = [
    sourcePath,
    themePath,
    requestPath,
    assetManifestPath,
    ...assetPaths,
  ].filter((path): path is string => Boolean(path));
  for (const inputPath of protectedInputs) {
    if (isPathInside(pageDirectory, inputPath, true)) {
      throw new Error(
        `rendered-pages would overwrite an input file: ${toWorkspaceRelative(workspace, inputPath)}`
      );
    }
  }
  const plannedFiles = [
    ...formats
      .filter((format) => format !== "png")
      .map((format) => resolve(outputDirectory, `${deckStem}${formatExtension(format)}`)),
    resolve(outputDirectory, `${deckStem}-notes.txt`),
    resolve(outputDirectory, "contact-sheet.png"),
    manifestPath,
    resolve(outputDirectory, "machine-qa.json"),
    resolve(outputDirectory, ".machine-qa-render.html"),
  ];
  plannedFiles.forEach((filePath) => assertDistinctPaths(filePath, protectedInputs));

  const prior = readPriorReviewState(manifestPath, sourceSnapshot.path);
  const outputs: OutputSnapshot[] = [];
  let pageImages: PageImage[] = [];
  let contactSheet: RenderManifest["contact_sheet"] = null;

  for (const format of formats) {
    if (format === "png") {
      rmSync(pageDirectory, { recursive: true, force: true });
      mkdirSync(pageDirectory, { recursive: true });
      const rawOutput = resolve(pageDirectory, "page.png");
      runMarp(
        workspace,
        sourcePath,
        rawOutput,
        "png",
        themePath,
        imageScale,
        runner
      );
      normalizePngOutputNames(pageDirectory);
      pageImages = collectPageImages(workspace, pageDirectory);
      if (pageImages.length !== slideCount) {
        throw new Error(
          `PNG page count ${pageImages.length} does not match Marp slide count ${slideCount}`
        );
      }
      const contactSheetPath = resolve(outputDirectory, "contact-sheet.png");
      rmSync(contactSheetPath, { force: true });
      contactSheet = await renderContactSheet(
        workspace,
        contactSheetPath,
        pageImages
      );
      continue;
    }
    const outputPath = resolve(outputDirectory, `${deckStem}${formatExtension(format)}`);
    assertDistinctPaths(outputPath, [sourcePath, themePath, requestPath, assetManifestPath]);
    rmSync(outputPath, { force: true });
    runMarp(
      workspace,
      sourcePath,
      outputPath,
      format,
      themePath,
      imageScale,
      runner
    );
    if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
      throw new Error(`Marp did not create ${format} output`);
    }
    outputs.push({ format, ...snapshot(workspace, outputPath) });
  }

  const notesPath = resolve(outputDirectory, `${deckStem}-notes.txt`);
  rmSync(notesPath, { force: true });
  runMarp(
    workspace,
    sourcePath,
    notesPath,
    "notes",
    themePath,
    imageScale,
    runner
  );
  if (!existsSync(notesPath) || !statSync(notesPath).isFile()) {
    throw new Error("Marp did not create a presenter notes output");
  }
  outputs.push({ format: "notes", ...snapshot(workspace, notesPath) });

  const actualFormats = [...formats, "notes" as const].sort(
    (a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b)
  );
  const improvements = prior.improvements.filter((item) =>
    item.slides.every((slide) => slide <= slideCount)
  );
  const manifest: RenderManifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    artifact_fingerprint: computeArtifactFingerprint(fingerprintFiles),
    render_iteration: prior.renderIteration,
    improvements,
    slide_count: slideCount,
    source: sourceSnapshot,
    request: requestSnapshot,
    theme: themeSnapshot,
    assets: assetSnapshots,
    formats: actualFormats,
    outputs,
    page_images: pageImages,
    contact_sheet: contactSheet,
    environment: environmentSnapshot(workspace, runner),
  };
  writeManifest(manifestPath, manifest);

  const requestedHtml = outputs.find((output) => output.format === "html");
  const temporaryQaHtml = requestedHtml
    ? null
    : resolve(outputDirectory, ".machine-qa-render.html");
  const qaHtmlPath = requestedHtml
    ? resolve(workspace, requestedHtml.path)
    : temporaryQaHtml!;
  if (temporaryQaHtml) {
    rmSync(temporaryQaHtml, { force: true });
    runMarp(
      workspace,
      sourcePath,
      temporaryQaHtml,
      "html",
      themePath,
      imageScale,
      runner
    );
  }
  const machineQaPath = resolve(outputDirectory, "machine-qa.json");
  let machineQa: MachineQaReport;
  try {
    machineQa = await writeMachineQa({
      workspace,
      outputPath: machineQaPath,
      sourcePath,
      assetManifestPath,
      htmlPath: qaHtmlPath,
      manifest,
    });
  } finally {
    if (temporaryQaHtml) rmSync(temporaryQaHtml, { force: true });
  }
  return {
    manifest_path: toWorkspaceRelative(workspace, manifestPath),
    machine_qa_path: machineQaSummaryPath(workspace, machineQaPath),
    manifest,
    machine_qa: machineQa,
  };
}

function legacyOutputPath(
  workspace: string,
  sourcePath: string,
  format: MarpFormat,
  output?: string
): string {
  if (output) {
    return resolveWorkspacePath(workspace, output, "output", {
      kind: "output",
      extensions: [formatExtension(format)],
      mustExist: false,
    });
  }
  const defaultPath = sourcePath.replace(/\.md$/i, formatExtension(format));
  return resolveWorkspacePath(
    workspace,
    toWorkspaceRelative(workspace, defaultPath),
    "output",
    {
      kind: "output",
      extensions: [formatExtension(format)],
      mustExist: false,
    }
  );
}

function collectLegacyPngs(workspace: string, outputPath: string): string[] {
  const directory = dirname(outputPath);
  const stem = basename(outputPath, extname(outputPath));
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const entry of readdirSync(directory)) {
    const match = entry.match(new RegExp(`^${escaped}\\.(\\d+)\\.png$`, "i"));
    if (!match) continue;
    const target = `${stem}-${String(Number(match[1])).padStart(3, "0")}.png`;
    renameSync(resolve(directory, entry), resolve(directory, target));
  }
  return readdirSync(directory)
    .map((name) => ({ name, match: name.match(new RegExp(`^${escaped}-(\\d+)\\.png$`, "i")) }))
    .filter((entry): entry is { name: string; match: RegExpMatchArray } => Boolean(entry.match))
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map((entry) => toWorkspaceRelative(workspace, resolve(directory, entry.name)));
}

export function renderLegacyExport(
  workspace: string,
  input: LegacyExportInput,
  runner: CommandRunner = synchronousCommandRunner
): LegacyExportResult {
  const sourcePath = resolveWorkspacePath(workspace, input.source, "source", {
    kind: "input",
    extensions: [".md"],
  });
  const themePath = input.theme
    ? resolveWorkspacePath(workspace, input.theme, "theme", {
        kind: "input",
        extensions: [".css"],
      })
    : undefined;
  const outputPath = legacyOutputPath(
    workspace,
    sourcePath,
    input.format,
    input.output
  );
  assertDistinctPaths(outputPath, [sourcePath, themePath]);
  const source = readFileSync(sourcePath, "utf8");
  if (!hasMarpFrontmatter(source)) {
    throw new Error(`source does not contain 'marp: true' in YAML frontmatter: ${input.source}`);
  }
  if (hasEnabledHtmlFrontmatter(source)) {
    throw new Error("frontmatter html: true is disabled; use static SVG and HTML-free slide content");
  }
  if (hasHeadingDividerFrontmatter(source)) {
    throw new Error("frontmatter headingDivider is not supported; use literal '---' slide boundaries");
  }
  const assetPaths = discoverDeckAssets(workspace, sourcePath, themePath);
  assertDistinctPaths(outputPath, [sourcePath, themePath, ...assetPaths]);
  if (input.format === "png") {
    const outputStem = basename(outputPath, ".png");
    const escapedStem = outputStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pagePattern = new RegExp(`^${escapedStem}(?:\\.|-)\\d+\\.png$`, "i");
    for (const assetPath of assetPaths) {
      if (dirname(assetPath) === dirname(outputPath) && pagePattern.test(basename(assetPath))) {
        throw new Error(
          `PNG export would overwrite an input asset: ${toWorkspaceRelative(workspace, assetPath)}`
        );
      }
    }
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  if (input.format === "png") {
    const stem = basename(outputPath, ".png").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const entry of readdirSync(dirname(outputPath))) {
      if (new RegExp(`^${stem}(?:\\.|-)\\d+\\.png$`, "i").test(entry)) {
        rmSync(resolve(dirname(outputPath), entry), { force: true });
      }
    }
  } else {
    rmSync(outputPath, { force: true });
  }
  runMarp(
    workspace,
    sourcePath,
    outputPath,
    input.format,
    themePath,
    input.format === "png" ? 2 : 1,
    runner
  );
  const outputs =
    input.format === "png"
      ? collectLegacyPngs(workspace, outputPath)
      : [toWorkspaceRelative(workspace, outputPath)];
  if (
    outputs.length === 0 ||
    outputs.some((file) => {
      const absolute = resolve(workspace, file);
      return !existsSync(absolute) || statSync(absolute).size === 0;
    })
  ) {
    throw new Error(`Marp did not create ${input.format} output`);
  }
  return {
    format: input.format,
    outputs,
    theme: themePath ? toWorkspaceRelative(workspace, themePath) : null,
  };
}
