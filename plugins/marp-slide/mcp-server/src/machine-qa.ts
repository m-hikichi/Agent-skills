import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { sha256Buffer, sha256File, toWorkspaceRelative } from "./paths.js";
import {
  findMissingInformativeImageAlt,
  type MissingImageAlt,
} from "./security.js";
import type { RenderManifest } from "./rendering.js";

type CheckStatus = "pass" | "fail" | "not_run";
const MINIMUM_TEXT_SIZE_PX = 12;

export interface GeometryViolation {
  slide: number;
  selector: string;
  kind: "overflow" | "clipping";
  detail: string;
}

export interface TextSizeViolation {
  slide: number;
  selector: string;
  font_size_px: number;
  text: string;
}

export interface ContrastViolation {
  slide: number;
  selector: string;
  ratio: number;
  required: number;
  text: string;
}

interface DomMeasurements {
  slide_count: number;
  geometry: GeometryViolation[];
  text_sizes: TextSizeViolation[];
  contrast: ContrastViolation[];
  minimum_text_size_px: number | null;
}

export interface MachineQaReport {
  schema_version: 1;
  generated_at: string;
  source: { path: string; sha256: string };
  artifact_fingerprint: string;
  status: "pass" | "fail";
  checks: {
    page_count: {
      status: CheckStatus;
      expected: number;
      rendered_png: number;
      rendered_dom: number | null;
    };
    missing_assets: { status: CheckStatus; missing: string[] };
    overflow_and_clipping: {
      status: CheckStatus;
      violations: GeometryViolation[];
      error?: string;
    };
    minimum_text_size: {
      status: CheckStatus;
      threshold_px: number;
      minimum_px: number | null;
      violations: TextSizeViolation[];
      error?: string;
    };
    contrast: {
      status: CheckStatus;
      algorithm: "WCAG-2-relative-luminance";
      violations: ContrastViolation[];
      error?: string;
    };
    informative_image_alt: {
      status: CheckStatus;
      missing: MissingImageAlt[];
    };
    manifest_integrity: { status: CheckStatus; errors: string[] };
  };
}

export function classifyGeometryMeasurements(
  slideCount: number,
  measurements: Array<{
    slide: number;
    selector: string;
    clientWidth: number;
    scrollWidth: number;
    clientHeight: number;
    scrollHeight: number;
    outsideBy: number;
    overflowHidden: boolean;
  }>
): GeometryViolation[] {
  return measurements.flatMap((item) => {
    if (item.slide < 1 || item.slide > slideCount) return [];
    const violations: GeometryViolation[] = [];
    if (item.outsideBy > 1) {
      violations.push({
        slide: item.slide,
        selector: item.selector,
        kind: "overflow",
        detail: `element extends ${item.outsideBy.toFixed(1)}px outside the slide`,
      });
    }
    if (
      item.overflowHidden &&
      (item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1)
    ) {
      violations.push({
        slide: item.slide,
        selector: item.selector,
        kind: "clipping",
        detail: `scroll ${item.scrollWidth}x${item.scrollHeight} exceeds client ${item.clientWidth}x${item.clientHeight}`,
      });
    }
    return violations;
  });
}

function decorativeTargets(
  workspace: string,
  sourcePath: string,
  assetManifestPath: string
): Set<string> {
  const targets = new Set<string>();
  const sourceDirectory = posix.dirname(toWorkspaceRelative(workspace, sourcePath));
  try {
    const manifest = JSON.parse(readFileSync(assetManifestPath, "utf8")) as {
      assets?: Array<{ path?: unknown; decorative?: unknown }>;
    };
    for (const asset of manifest.assets ?? []) {
      if (asset.decorative === true && typeof asset.path === "string") {
        targets.add(asset.path);
        const fromSource = posix.relative(sourceDirectory, asset.path);
        targets.add(fromSource);
        targets.add(`./${fromSource}`);
      }
    }
  } catch {
    // Asset-manifest validity is checked before rendering. Keep this function
    // side-effect free if called independently in tests.
  }
  return targets;
}

function validateManifest(
  workspace: string,
  assetManifestPath: string,
  manifest: RenderManifest
): string[] {
  const errors: string[] = [];
  const pngDimensions = (path: string): { width: number; height: number } | null => {
    const buffer = readFileSync(path);
    if (
      buffer.length < 24 ||
      buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    ) {
      return null;
    }
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  };
  const verify = (
    entry: { path: string; sha256: string },
    label: string,
    allowEmpty = false
  ) => {
    const filePath = resolve(workspace, entry.path);
    if (!existsSync(filePath)) {
      errors.push(`${label} missing: ${entry.path}`);
    } else if (sha256File(filePath) !== entry.sha256) {
      errors.push(`${label} hash mismatch: ${entry.path}`);
    } else if (!allowEmpty && statSync(filePath).size === 0) {
      errors.push(`${label} is empty: ${entry.path}`);
    }
  };
  verify(manifest.source, "source");
  verify(manifest.request, "request");
  if (manifest.theme) verify(manifest.theme, "theme");
  manifest.assets.forEach((asset) => verify(asset, "asset"));
  manifest.outputs.forEach((output) =>
    verify(output, output.format, output.format === "notes")
  );
  manifest.page_images.forEach((page, index) => {
    if (page.slide !== index + 1) errors.push(`page sequence mismatch at ${index + 1}`);
    verify(page, `page ${page.slide}`);
    const dimensions = existsSync(resolve(workspace, page.path))
      ? pngDimensions(resolve(workspace, page.path))
      : null;
    if (!dimensions || dimensions.width !== page.width || dimensions.height !== page.height) {
      errors.push(`page ${page.slide} dimension mismatch: ${page.path}`);
    }
  });
  if (manifest.page_images.length !== manifest.slide_count) {
    errors.push("page_images count does not match slide_count");
  }
  if (manifest.page_images.length) {
    const pageDirectory = dirname(resolve(workspace, manifest.page_images[0].path));
    const actual = readdirSync(pageDirectory).sort();
    const expected = manifest.page_images.map((page) => basename(page.path)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push("rendered-pages directory contains missing or extra files");
    }
  }
  if (manifest.contact_sheet) {
    verify(manifest.contact_sheet, "contact_sheet");
    const contactPath = resolve(workspace, manifest.contact_sheet.path);
    const dimensions = existsSync(contactPath) ? pngDimensions(contactPath) : null;
    if (
      !dimensions ||
      dimensions.width !== manifest.contact_sheet.width ||
      dimensions.height !== manifest.contact_sheet.height
    ) {
      errors.push("contact_sheet dimension mismatch");
    }
  }
  const files = [
    { kind: "request", ...manifest.request },
    { kind: "source", ...manifest.source },
    ...(manifest.theme ? [{ kind: "theme", ...manifest.theme }] : []),
    {
      kind: "asset_manifest",
      path: toWorkspaceRelative(workspace, assetManifestPath),
      sha256: sha256File(assetManifestPath),
    },
    ...manifest.assets.map((asset) => ({ kind: "asset", ...asset })),
  ].sort((a, b) =>
    a.kind < b.kind
      ? -1
      : a.kind > b.kind
        ? 1
        : a.path < b.path
          ? -1
          : a.path > b.path
            ? 1
            : 0
  );
  const fingerprint = sha256Buffer(JSON.stringify({ version: 1, files }));
  if (fingerprint !== manifest.artifact_fingerprint) {
    errors.push("artifact_fingerprint does not match current input snapshots");
  }
  const expectedOutputFormats = manifest.formats.filter(
    (format): format is "html" | "pdf" | "pptx" | "notes" => format !== "png"
  );
  if (
    JSON.stringify(manifest.outputs.map((output) => output.format).sort()) !==
    JSON.stringify([...expectedOutputFormats].sort())
  ) {
    errors.push("outputs do not exactly match non-PNG formats");
  }
  if (!manifest.formats.includes("png")) errors.push("PNG review format is required");
  if (!manifest.contact_sheet) errors.push("contact_sheet is required");
  return errors;
}

async function inspectRenderedHtml(htmlPath: string): Promise<DomMeasurements> {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--no-zygote",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    return await page.evaluate((minimumTextSizePx) => {
      const sections = Array.from(document.querySelectorAll<HTMLElement>("section"));
      const measurements: Array<{
        slide: number;
        selector: string;
        clientWidth: number;
        scrollWidth: number;
        clientHeight: number;
        scrollHeight: number;
        outsideBy: number;
        overflowHidden: boolean;
      }> = [];
      const textSizes: TextSizeViolation[] = [];
      const contrastViolations: ContrastViolation[] = [];
      let minimumTextSize: number | null = null;

      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const classes = Array.from(element.classList).slice(0, 2);
        return element.tagName.toLowerCase() + classes.map((name) => `.${CSS.escape(name)}`).join("");
      };
      const rgb = (value: string): [number, number, number] | null => {
        const match = value.match(/rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/i);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
      };
      const luminance = ([r, g, b]: [number, number, number]) => {
        const linear = [r, g, b].map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const backgroundFor = (
        element: Element,
        section: Element
      ): [number, number, number] | null => {
        let current: Element | null = element;
        while (current) {
          const style = getComputedStyle(current);
          if (style.backgroundImage && style.backgroundImage !== "none") return null;
          const color = rgb(style.backgroundColor);
          const alpha = Number(style.backgroundColor.match(/rgba\([^)]*,\s*([\d.]+)\s*\)$/)?.[1] ?? 1);
          if (color && alpha > 0.01) return color;
          if (current === section) break;
          current = current.parentElement;
        }
        return [255, 255, 255];
      };

      sections.forEach((section, slideIndex) => {
        const slide = slideIndex + 1;
        const sectionRect = section.getBoundingClientRect();
        const candidates = [
          section,
          ...Array.from(
            section.querySelectorAll<HTMLElement>(
              "h1,h2,h3,p,ul,ol,table,pre,blockquote,figure,img,svg,.columns,.grid,.card"
            )
          ),
        ];
        for (const element of candidates) {
          const rect = element.getBoundingClientRect();
          const outsideBy = Math.max(
            0,
            sectionRect.left - rect.left,
            rect.right - sectionRect.right,
            sectionRect.top - rect.top,
            rect.bottom - sectionRect.bottom
          );
          const style = getComputedStyle(element);
          measurements.push({
            slide,
            selector: selectorFor(element),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            outsideBy,
            overflowHidden: ["hidden", "clip"].includes(style.overflow) ||
              ["hidden", "clip"].includes(style.overflowX) ||
              ["hidden", "clip"].includes(style.overflowY),
          });
        }

        const textElements = Array.from(section.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,td,th,pre,code,blockquote,figcaption,footer"));
        for (const element of textElements) {
          const text = (element.innerText || "").trim().replace(/\s+/g, " ");
          const style = getComputedStyle(element);
          if (!text || style.display === "none" || style.visibility === "hidden") continue;
          const size = Number.parseFloat(style.fontSize);
          minimumTextSize = minimumTextSize === null ? size : Math.min(minimumTextSize, size);
          if (size < minimumTextSizePx) {
            textSizes.push({
              slide,
              selector: selectorFor(element),
              font_size_px: Number(size.toFixed(2)),
              text: text.slice(0, 100),
            });
          }
          const foreground = rgb(style.color);
          if (!foreground) continue;
          const background = backgroundFor(element, section);
          if (!background) continue;
          const lightA = luminance(foreground);
          const lightB = luminance(background);
          const ratio = (Math.max(lightA, lightB) + 0.05) / (Math.min(lightA, lightB) + 0.05);
          const required = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
          if (ratio + 0.05 < required) {
            contrastViolations.push({
              slide,
              selector: selectorFor(element),
              ratio: Number(ratio.toFixed(2)),
              required,
              text: text.slice(0, 100),
            });
          }
        }
      });

      const geometry = measurements.flatMap((item) => {
        const result: GeometryViolation[] = [];
        if (item.outsideBy > 1) {
          result.push({
            slide: item.slide,
            selector: item.selector,
            kind: "overflow",
            detail: `element extends ${item.outsideBy.toFixed(1)}px outside the slide`,
          });
        }
        if (
          item.overflowHidden &&
          (item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1)
        ) {
          result.push({
            slide: item.slide,
            selector: item.selector,
            kind: "clipping",
            detail: `scroll ${item.scrollWidth}x${item.scrollHeight} exceeds client ${item.clientWidth}x${item.clientHeight}`,
          });
        }
        return result;
      });
      return {
        slide_count: sections.length,
        geometry,
        text_sizes: textSizes,
        contrast: contrastViolations,
        minimum_text_size_px:
          minimumTextSize === null ? null : Number(minimumTextSize.toFixed(2)),
      };
    }, MINIMUM_TEXT_SIZE_PX);
  } finally {
    await browser.close();
  }
}

export async function writeMachineQa(options: {
  workspace: string;
  outputPath: string;
  sourcePath: string;
  assetManifestPath: string;
  htmlPath: string;
  manifest: RenderManifest;
}): Promise<MachineQaReport> {
  const markdown = readFileSync(options.sourcePath, "utf8");
  const missingAlt = findMissingInformativeImageAlt(
    markdown,
    decorativeTargets(
      options.workspace,
      options.sourcePath,
      options.assetManifestPath
    )
  );
  const integrityErrors = validateManifest(
    options.workspace,
    options.assetManifestPath,
    options.manifest
  );
  const missingAssets = options.manifest.assets
    .filter((asset) => !existsSync(resolve(options.workspace, asset.path)))
    .map((asset) => asset.path);
  let dom: DomMeasurements | null = null;
  let domError: string | undefined;
  try {
    dom = await inspectRenderedHtml(options.htmlPath);
  } catch (error) {
    domError = error instanceof Error ? error.message : String(error);
  }

  const pngCount = options.manifest.page_images.length;
  const expected = options.manifest.slide_count;
  const pageCountPass =
    pngCount === expected && (!dom || dom.slide_count === expected);
  const geometryStatus: CheckStatus = dom
    ? dom.geometry.length
      ? "fail"
      : "pass"
    : "not_run";
  const textStatus: CheckStatus = dom
    ? dom.text_sizes.length
      ? "fail"
      : "pass"
    : "not_run";
  const contrastStatus: CheckStatus = dom
    ? dom.contrast.length
      ? "fail"
      : "pass"
    : "not_run";
  const report: MachineQaReport = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: options.manifest.source,
    artifact_fingerprint: options.manifest.artifact_fingerprint,
    status: "pass",
    checks: {
      page_count: {
        status: pageCountPass ? "pass" : "fail",
        expected,
        rendered_png: pngCount,
        rendered_dom: dom?.slide_count ?? null,
      },
      missing_assets: {
        status: missingAssets.length ? "fail" : "pass",
        missing: missingAssets,
      },
      overflow_and_clipping: {
        status: geometryStatus,
        violations: dom?.geometry ?? [],
        ...(domError ? { error: domError } : {}),
      },
      minimum_text_size: {
        status: textStatus,
        threshold_px: MINIMUM_TEXT_SIZE_PX,
        minimum_px: dom?.minimum_text_size_px ?? null,
        violations: dom?.text_sizes ?? [],
        ...(domError ? { error: domError } : {}),
      },
      contrast: {
        status: contrastStatus,
        algorithm: "WCAG-2-relative-luminance",
        violations: dom?.contrast ?? [],
        ...(domError ? { error: domError } : {}),
      },
      informative_image_alt: {
        status: missingAlt.length ? "fail" : "pass",
        missing: missingAlt,
      },
      manifest_integrity: {
        status: integrityErrors.length ? "fail" : "pass",
        errors: integrityErrors,
      },
    },
  };
  const hardStatuses = [
    report.checks.page_count.status,
    report.checks.missing_assets.status,
    report.checks.overflow_and_clipping.status,
    report.checks.minimum_text_size.status,
    report.checks.contrast.status,
    report.checks.informative_image_alt.status,
    report.checks.manifest_integrity.status,
  ];
  report.status = hardStatuses.every((status) => status === "pass") ? "pass" : "fail";

  const temporary = resolve(
    dirname(options.outputPath),
    `.machine-qa.${randomUUID()}.tmp`
  );
  try {
    writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    rmSync(options.outputPath, { force: true });
    renameSync(temporary, options.outputPath);
  } finally {
    rmSync(temporary, { force: true });
  }
  return report;
}

export function machineQaSummaryPath(workspace: string, outputPath: string): string {
  return toWorkspaceRelative(workspace, outputPath);
}
