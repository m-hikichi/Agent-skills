import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, resolve } from "node:path";
import {
  assertDistinctPaths,
  resolveAssetReference,
  resolveWorkspacePath,
  sha256File,
  toWorkspaceRelative,
} from "./paths.js";
import { assertSafeStaticSvg, assertSafeVegaLiteSpec } from "./security.js";

export interface RenderChartInput {
  spec: string;
  data?: string;
  output?: string;
}

export interface RenderChartResult {
  output: string;
  sha256: string;
  spec: string;
  data: string | null;
  warnings: string[];
}

interface VegaLogger {
  level(level?: number): VegaLogger;
  error(...messages: unknown[]): VegaLogger;
  warn(...messages: unknown[]): VegaLogger;
  info(...messages: unknown[]): VegaLogger;
  debug(...messages: unknown[]): VegaLogger;
}

interface VegaView {
  runAsync(): Promise<unknown>;
  toSVG(): Promise<string>;
  finalize(): void;
}

interface VegaRuntime {
  compile(spec: unknown, options: { logger: VegaLogger }): { spec: unknown };
  parse(spec: unknown): unknown;
  read(
    content: string,
    options: { type: string; parse: string }
  ): unknown[];
  View: new (
    runtime: unknown,
    options: { renderer: string; logLevel: number }
  ) => VegaView;
  Warn: number;
}

let runtimePromise: Promise<VegaRuntime> | null = null;

/**
 * Keep Vega-Lite's very large public type unions outside the TypeScript
 * program. Runtime imports remain package-lock pinned and the narrow boundary
 * below is exercised by the real SVG test in the Docker build.
 */
async function loadVegaRuntime(): Promise<VegaRuntime> {
  if (!runtimePromise) {
    const vegaLiteSpecifier = ["vega", "lite"].join("-");
    const vegaSpecifier = ["ve", "ga"].join("");
    runtimePromise = Promise.all([
      import(vegaLiteSpecifier),
      import(vegaSpecifier),
    ]).then(([vegaLite, vega]) => ({
      compile: vegaLite.compile as VegaRuntime["compile"],
      parse: vega.parse as VegaRuntime["parse"],
      read: vega.read as VegaRuntime["read"],
      View: vega.View as VegaRuntime["View"],
      Warn: vega.Warn as number,
    }));
  }
  return runtimePromise;
}

function parseJsonFile(filePath: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} must contain valid JSON: ${error instanceof Error ? error.message : error}`
    );
  }
}

function loadDataFile(
  filePath: string,
  readData: VegaRuntime["read"],
  formatHint?: string
): unknown[] {
  const extension = extname(filePath).toLowerCase();
  const format = formatHint?.toLowerCase() || (extension === ".csv" ? "csv" : "json");
  const content = readFileSync(filePath, "utf8");
  if (format === "csv" || format === "tsv") {
    return readData(content, { type: format, parse: "auto" });
  }
  if (format !== "json") {
    throw new Error(`unsupported Vega-Lite data format: ${format}`);
  }
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`JSON chart data must be an array: ${filePath}`);
  }
  return parsed;
}

function hydrateDataUrls(
  workspace: string,
  specPath: string,
  value: unknown,
  discoveredData: Set<string>,
  readData: VegaRuntime["read"]
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      hydrateDataUrls(workspace, specPath, entry, discoveredData, readData)
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const hydrated: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "data" && child && typeof child === "object" && !Array.isArray(child)) {
      const data = child as Record<string, unknown>;
      if (typeof data.url === "string") {
        const dataPath = resolveAssetReference(
          workspace,
          specPath,
          data.url,
          "Vega-Lite data"
        );
        if (!dataPath) {
          throw new Error("Vega-Lite data.url must point to a workspace-local file");
        }
        if (![".csv", ".tsv", ".json"].includes(extname(dataPath).toLowerCase())) {
          throw new Error("Vega-Lite data.url must use .csv, .tsv, or .json");
        }
        const format =
          data.format && typeof data.format === "object"
            ? (data.format as Record<string, unknown>).type
            : undefined;
        discoveredData.add(dataPath);
        hydrated[key] = {
          ...data,
          url: undefined,
          values: loadDataFile(
            dataPath,
            readData,
            typeof format === "string" ? format : undefined
          ),
        };
        delete (hydrated[key] as Record<string, unknown>).url;
        continue;
      }
    }
    // Inline data values are inert records. Do not interpret columns named
    // `url` or `href` as configuration.
    if (key === "values") {
      hydrated[key] = child;
    } else {
      hydrated[key] = hydrateDataUrls(
        workspace,
        specPath,
        child,
        discoveredData,
        readData
      );
    }
  }
  return hydrated;
}

function defaultChartOutput(specPath: string): string {
  const fileName = basename(specPath).replace(/(?:\.vl)?\.json$/i, ".svg");
  return resolve(dirname(specPath), fileName);
}

function writeSvg(outputPath: string, svg: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${randomUUID()}.tmp`
  );
  try {
    writeFileSync(temporary, svg, { encoding: "utf8", flag: "wx" });
    rmSync(outputPath, { force: true });
    renameSync(temporary, outputPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function renderChart(
  workspace: string,
  input: RenderChartInput
): Promise<RenderChartResult> {
  const { compile, parse, read, View, Warn } = await loadVegaRuntime();
  const specPath = resolveWorkspacePath(workspace, input.spec, "spec", {
    kind: "input",
    extensions: [".json"],
  });
  const explicitDataPath = input.data
    ? resolveWorkspacePath(workspace, input.data, "data", {
        kind: "input",
        extensions: [".csv", ".tsv", ".json"],
      })
    : undefined;
  const rawOutputPath = input.output
    ? resolveWorkspacePath(workspace, input.output, "output", {
        kind: "output",
        extensions: [".svg"],
        mustExist: false,
      })
    : defaultChartOutput(specPath);
  const outputPath = input.output
    ? rawOutputPath
    : resolveWorkspacePath(
        workspace,
        toWorkspaceRelative(workspace, rawOutputPath),
        "output",
        { kind: "output", extensions: [".svg"], mustExist: false }
      );
  assertDistinctPaths(outputPath, [specPath, explicitDataPath]);

  const parsed = parseJsonFile(specPath, "spec");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Vega-Lite spec must be a JSON object");
  }
  const discoveredData = new Set<string>();
  const hydrated = hydrateDataUrls(
    workspace,
    specPath,
    parsed,
    discoveredData,
    read
  ) as Record<string, unknown>;
  if (explicitDataPath) {
    hydrated.data = { values: loadDataFile(explicitDataPath, read) };
    discoveredData.add(explicitDataPath);
  }
  assertSafeVegaLiteSpec(hydrated);

  const warnings: string[] = [];
  const compileErrors: string[] = [];
  const logger: VegaLogger = {
    level: () => logger,
    error: (...messages: unknown[]) => {
      compileErrors.push(messages.map(String).join(" "));
      return logger;
    },
    warn: (...messages: unknown[]) => {
      warnings.push(messages.map(String).join(" "));
      return logger;
    },
    info: () => logger,
    debug: () => logger,
  };
  const compiled = compile(hydrated, { logger }).spec;
  if (compileErrors.length) {
    throw new Error(`Vega-Lite compilation failed: ${compileErrors.join(" | ")}`);
  }
  const view = new View(parse(compiled), {
    renderer: "none",
    logLevel: Warn,
  });
  let svg: string;
  try {
    await view.runAsync();
    svg = await view.toSVG();
  } finally {
    view.finalize();
  }
  assertSafeStaticSvg(svg, "rendered Vega-Lite SVG");
  writeSvg(outputPath, svg);

  return {
    output: toWorkspaceRelative(workspace, outputPath),
    sha256: sha256File(outputPath),
    spec: toWorkspaceRelative(workspace, specPath),
    data: explicitDataPath
      ? toWorkspaceRelative(workspace, explicitDataPath)
      : discoveredData.size === 1
        ? toWorkspaceRelative(workspace, [...discoveredData][0])
        : null,
    warnings,
  };
}
