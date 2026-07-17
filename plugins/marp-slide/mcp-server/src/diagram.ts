import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertDistinctPaths,
  resolveWorkspacePath,
  sha256Buffer,
  sha256File,
  toWorkspaceRelative,
} from "./paths.js";
import { assertSafeMermaidSource, assertSafeStaticSvg } from "./security.js";

export type MermaidTheme = "default" | "neutral" | "dark" | "forest";

export interface RenderDiagramInput {
  source: string;
  output?: string;
  theme?: MermaidTheme;
  background?: string;
}

export interface RenderDiagramResult {
  source: string;
  output: string;
  sha256: string;
  theme: MermaidTheme;
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: { cwd: string; timeout: number }
  ): string;
}

export const synchronousCommandRunner: CommandRunner = {
  run(command, args, options) {
    return execFileSync(command, [...args], {
      cwd: options.cwd,
      timeout: options.timeout,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  },
};

function defaultDiagramOutput(sourcePath: string): string {
  return resolve(
    dirname(sourcePath),
    basename(sourcePath, extname(sourcePath)) + ".svg"
  );
}

export function buildMermaidArgs(
  sourcePath: string,
  outputPath: string,
  configPath: string,
  puppeteerConfigPath: string,
  theme: MermaidTheme,
  background: string
): string[] {
  return [
    "--input",
    sourcePath,
    "--output",
    outputPath,
    "--outputFormat",
    "svg",
    "--theme",
    theme,
    "--backgroundColor",
    background,
    "--configFile",
    configPath,
    "--puppeteerConfigFile",
    puppeteerConfigPath,
    "--quiet",
  ];
}

export function validateCssColor(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed === "transparent" ||
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ||
    /^(?:rgb|hsl)a?\([0-9.,%\s/-]+\)$/i.test(trimmed)
  ) {
    return trimmed;
  }
  throw new Error("background must be transparent, a hex color, rgb(a), or hsl(a)");
}

export async function renderDiagram(
  workspace: string,
  input: RenderDiagramInput,
  runner: CommandRunner = synchronousCommandRunner
): Promise<RenderDiagramResult> {
  const sourcePath = resolveWorkspacePath(workspace, input.source, "source", {
    kind: "input",
    extensions: [".mmd", ".mermaid"],
  });
  const rawOutputPath = input.output
    ? resolveWorkspacePath(workspace, input.output, "output", {
        kind: "output",
        extensions: [".svg"],
        mustExist: false,
      })
    : defaultDiagramOutput(sourcePath);
  const outputPath = input.output
    ? rawOutputPath
    : resolveWorkspacePath(
        workspace,
        toWorkspaceRelative(workspace, rawOutputPath),
        "output",
        { kind: "output", extensions: [".svg"], mustExist: false }
      );
  assertDistinctPaths(outputPath, [sourcePath]);

  const source = readFileSync(sourcePath, "utf8");
  assertSafeMermaidSource(source);
  const theme = input.theme ?? "neutral";
  if (!["default", "neutral", "dark", "forest"].includes(theme)) {
    throw new Error("theme must be default, neutral, dark, or forest");
  }
  const background = validateCssColor(input.background ?? "transparent");
  const deterministicSeed = sha256Buffer(source).slice(0, 24);

  mkdirSync(dirname(outputPath), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "marp-mermaid-"));
  const configPath = join(work, "mermaid-config.json");
  const puppeteerConfigPath = join(work, "puppeteer-config.json");
  const temporaryOutput = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${randomUUID()}.tmp.svg`
  );
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        securityLevel: "strict",
        htmlLabels: false,
        deterministicIds: true,
        deterministicIDSeed: deterministicSeed,
        flowchart: { htmlLabels: false },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  writeFileSync(
    puppeteerConfigPath,
    JSON.stringify(
      {
        executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
        args: [
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-setuid-sandbox",
          "--no-sandbox",
          "--no-zygote",
        ],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  try {
    runner.run(
      process.env.MMDC_BIN || "mmdc",
      buildMermaidArgs(
        sourcePath,
        temporaryOutput,
        configPath,
        puppeteerConfigPath,
        theme,
        background
      ),
      { cwd: workspace, timeout: 120_000 }
    );
    const svg = readFileSync(temporaryOutput, "utf8");
    assertSafeStaticSvg(svg, "rendered Mermaid SVG");
    rmSync(outputPath, { force: true });
    renameSync(temporaryOutput, outputPath);
  } finally {
    rmSync(temporaryOutput, { force: true });
    rmSync(work, { recursive: true, force: true });
  }

  return {
    source: toWorkspaceRelative(workspace, sourcePath),
    output: toWorkspaceRelative(workspace, outputPath),
    sha256: sha256File(outputPath),
    theme,
  };
}
