import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";

const WORKSPACE = resolve(process.env.WORKSPACE_DIR || "/workspace");

const server = new McpServer({
  name: "marp-mcp-server",
  version: "1.1.0",
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveWorkspacePath(
  input: string,
  fieldName: "source" | "output" | "theme"
): string {
  if (input.trim() === "") {
    throw new Error(`${fieldName} path must not be empty`);
  }

  if (isAbsolute(input)) {
    throw new Error(`${fieldName} path must be relative to the workspace root`);
  }

  const resolvedPath = resolve(WORKSPACE, input);
  const workspaceRelativePath = relative(WORKSPACE, resolvedPath);

  if (
    workspaceRelativePath === "" ||
    workspaceRelativePath.startsWith("..") ||
    isAbsolute(workspaceRelativePath)
  ) {
    throw new Error(`${fieldName} path must stay within the workspace root`);
  }

  return resolvedPath;
}

function hasMarpFrontmatter(content: string): boolean {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return false;
  }

  return /^marp:\s*true\s*$/im.test(match[1]);
}

function prepareOutputPath(outputPath: string, format: "html" | "pdf" | "pptx" | "png") {
  mkdirSync(dirname(outputPath), { recursive: true });

  if (format !== "png") {
    return;
  }

  const extension = extname(outputPath);
  const stem = basename(outputPath, extension);
  const pngSequencePattern = new RegExp(`^${escapeRegex(stem)}[.-]\\d+\\.png$`);

  if (existsSync(outputPath)) {
    rmSync(outputPath, { force: true });
  }

  for (const entry of readdirSync(dirname(outputPath), { withFileTypes: true })) {
    if (entry.isFile() && pngSequencePattern.test(entry.name)) {
      rmSync(resolve(dirname(outputPath), entry.name), { force: true });
    }
  }
}

function collectPngOutputs(outputPath: string): string[] {
  const extension = extname(outputPath);
  const stem = basename(outputPath, extension);
  const pngSequencePattern = new RegExp(`^${escapeRegex(stem)}-\\d+\\.png$`);

  return readdirSync(dirname(outputPath))
    .filter((name) => pngSequencePattern.test(name))
    .sort((a, b) => {
      const aNumber = Number(a.match(/-(\d+)\.png$/)?.[1] ?? 0);
      const bNumber = Number(b.match(/-(\d+)\.png$/)?.[1] ?? 0);
      return aNumber - bNumber || a.localeCompare(b);
    })
    .map((name) => resolve(dirname(outputPath), name));
}

function normalizePngOutputNames(outputPath: string) {
  const extension = extname(outputPath);
  const stem = basename(outputPath, extension);
  const rawSequencePattern = new RegExp(`^${escapeRegex(stem)}\\.(\\d+)\\.png$`);

  for (const entry of readdirSync(dirname(outputPath), { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const match = entry.name.match(rawSequencePattern);
    if (!match) {
      continue;
    }

    const normalizedName = `${stem}-${match[1]}.png`;
    renameSync(
      resolve(dirname(outputPath), entry.name),
      resolve(dirname(outputPath), normalizedName)
    );
  }
}

server.tool(
  "marp_export",
  "Export a Marp markdown file to HTML, PDF, PPTX, or per-slide PNG images. Supports an optional workspace-local custom theme CSS file. The source file must contain 'marp: true' in its YAML frontmatter.",
  {
    source: z
      .string()
      .describe(
        "Path to the Marp markdown file (relative to workspace root)"
      ),
    format: z
      .enum(["html", "pdf", "pptx", "png"])
      .describe("Output format"),
    output: z
      .string()
      .optional()
      .describe(
        "Output file path (relative to workspace root). Defaults to same name with the target extension. For png, the server asks Marp for numbered images and normalizes them to names such as page-001.png."
      ),
    theme: z
      .string()
      .optional()
      .describe(
        "Optional custom theme CSS path (relative to workspace root), passed to Marp with --theme-set"
      ),
  },
  async ({ source, format, output, theme }) => {
    let sourcePath: string;
    let outputPath: string;
    let themePath: string | undefined;

    try {
      sourcePath = resolveWorkspacePath(source, "source");

      if (extname(sourcePath).toLowerCase() !== ".md") {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Source file must be a Markdown file: ${source}`,
            },
          ],
        };
      }

      outputPath = output
        ? resolveWorkspacePath(output, "output")
        : sourcePath.replace(/\.md$/i, `.${format}`);

      if (theme) {
        themePath = resolveWorkspacePath(theme, "theme");
        if (extname(themePath).toLowerCase() !== ".css") {
          throw new Error(`theme path must be a CSS file: ${theme}`);
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Invalid path: ${msg}` }],
      };
    }

    if (!existsSync(sourcePath)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `File not found: ${source}` }],
      };
    }

    if (themePath && !existsSync(themePath)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Theme file not found: ${theme}` }],
      };
    }

    const content = readFileSync(sourcePath, "utf-8");
    if (!hasMarpFrontmatter(content)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `File does not contain 'marp: true' in frontmatter: ${source}`,
          },
        ],
      };
    }

    prepareOutputPath(outputPath, format);

    const marpArgs: string[] = [sourcePath, "--html", "--allow-local-files"];
    if (themePath) {
      marpArgs.push("--theme-set", themePath);
    }
    if (format === "png") {
      marpArgs.push("--images", "png");
    } else if (format !== "html") {
      marpArgs.push(`--${format}`);
    }
    marpArgs.push("-o", outputPath);

    try {
      const result = execFileSync("marp", marpArgs, {
        encoding: "utf-8",
        timeout: 120_000,
        cwd: WORKSPACE,
      });

      const relativeOutput = output || relative(WORKSPACE, outputPath);
      if (format === "png") {
        normalizePngOutputNames(outputPath);
        const outputs = collectPngOutputs(outputPath).map((filePath) =>
          relative(WORKSPACE, filePath)
        );

        if (outputs.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Export failed:\nNo PNG page images were generated for ${relativeOutput}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Export successful: ${relativeOutput}`,
                "Format: png",
                theme ? `Theme: ${theme}` : "Theme: inline/default",
                "Generated files:",
                ...outputs.map((generated) => `- ${generated}`),
                "",
                result,
              ]
                .join("\n")
                .trim(),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Export successful: ${relativeOutput}`,
              `Format: ${format}`,
              theme ? `Theme: ${theme}` : "Theme: inline/default",
              "",
              result,
            ]
              .join("\n")
              .trim(),
          },
        ],
      };
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? (error as { stderr?: string }).stderr || error.message
          : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Export failed:\n${msg}` }],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
