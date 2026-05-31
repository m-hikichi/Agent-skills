import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  version: "1.0.0",
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveWorkspacePath(input: string, fieldName: "source" | "output"): string {
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

function sha256OfFile(filePath: string): string {
  // Hash the raw bytes so the write side (reviewer) and the check side (Stop
  // hook) agree regardless of CRLF/LF, BOM, or trailing newline differences.
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readJsonIfPresent(filePath: string): unknown | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return undefined;
  }
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
  "Export a Marp markdown file to HTML, PDF, PPTX, or per-slide PNG images. The source file must contain 'marp: true' in its YAML frontmatter.",
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
  },
  async ({ source, format, output }) => {
    let sourcePath: string;
    let outputPath: string;

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
            text: `Export successful: ${relativeOutput}\nFormat: ${format}\n\n${result}`.trim(),
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

server.tool(
  "marp_hash",
  "Compute the SHA-256 of a file (relative to workspace root). This is the deterministic value to store as review.json.source_sha256; the review gate compares against the same computation. Use this instead of computing a hash by hand.",
  {
    source: z
      .string()
      .describe("Path to the file to hash (relative to workspace root)"),
  },
  async ({ source }) => {
    let sourcePath: string;
    try {
      sourcePath = resolveWorkspacePath(source, "source");
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

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ source, sha256: sha256OfFile(sourcePath) }),
        },
      ],
    };
  }
);

// Stop-hook completion gate. Returns `{}` to ALLOW stop, or
// `{"decision":"block","reason":...}` to BLOCK it (Claude Code's Stop output
// contract). All checks are deterministic and run in-container, so the result
// does not depend on a model computing a hash.
server.tool(
  "validate_review_gate",
  "Deterministic marp-slide completion gate for use as a Stop hook (type: mcp_tool). Compares the current source SHA-256 against review.json.source_sha256 and decides whether the agent may stop. Returns {} to allow stop, or {\"decision\":\"block\",\"reason\":...} to block.",
  {
    source: z
      .string()
      .optional()
      .describe("Marp source path (relative to workspace). Default: slides/presentation.md"),
    review: z
      .string()
      .optional()
      .describe("Review state path (relative to workspace). Default: .slide-work/review.json"),
    blocked: z
      .string()
      .optional()
      .describe("Blocked marker path (relative to workspace). Default: .slide-work/review-blocked.json"),
  },
  async ({ source, review, blocked }) => {
    const allow = () => ({
      content: [{ type: "text" as const, text: "{}" }],
    });
    const block = (reason: string) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ decision: "block", reason }),
        },
      ],
    });

    let sourcePath: string;
    let reviewPath: string;
    let blockedPath: string;
    try {
      sourcePath = resolveWorkspacePath(source ?? "slides/presentation.md", "source");
      reviewPath = resolveWorkspacePath(review ?? ".slide-work/review.json", "source");
      blockedPath = resolveWorkspacePath(blocked ?? ".slide-work/review-blocked.json", "source");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return block(`gate のパス解決に失敗しました: ${msg}`);
    }

    // 1. No deck yet → legitimate idle state (not drafted). Allow.
    if (!existsSync(sourcePath)) {
      return allow();
    }

    const currentSha = sha256OfFile(sourcePath);

    // 2. Legitimate reviewer-unavailable stop, scoped to the current source.
    const blockedDoc = readJsonIfPresent(blockedPath) as
      | { status?: string; reason?: string; source_sha256?: string }
      | undefined;
    if (
      blockedDoc &&
      blockedDoc.status === "blocked" &&
      blockedDoc.reason === "reviewer_unavailable" &&
      blockedDoc.source_sha256 === currentSha
    ) {
      return allow();
    }

    // 3. Review state must exist and be readable.
    const reviewDoc = readJsonIfPresent(reviewPath) as
      | {
          status?: string;
          source_sha256?: string;
          visual_review?: { checked_page_count?: number };
          artifacts?: { page_images?: unknown[] };
        }
      | undefined;
    if (!reviewDoc) {
      return block(
        "review gate が満たされていません: review.json が無い/壊れています。reviewer サブエージェントを呼び出してください。reviewer 不可なら review-blocked.json を作成してください。"
      );
    }

    const shaMatch = reviewDoc.source_sha256 === currentSha;

    // 4. Infrastructure failure (e.g. Docker/MCP down during export) recorded
    //    for the current source → not a quality fail; allow the stop so the
    //    agent can surface the cause instead of being forced to loop. Only the
    //    documented `infra_blocked` status qualifies; any other value falls
    //    through to the fail-closed block below.
    if (reviewDoc.status === "infra_blocked" && shaMatch) {
      return allow();
    }

    // 5. A genuine pass: status pass, hash matches, and a visual review really ran.
    if (reviewDoc.status === "pass") {
      // Treat malformed/missing fields as "not reviewed" (fail-closed) instead
      // of letting a wrong type slip through the `<= 0` / `.length` checks.
      const checkedRaw = reviewDoc.visual_review?.checked_page_count;
      const checked = typeof checkedRaw === "number" ? checkedRaw : 0;
      const imagesRaw = reviewDoc.artifacts?.page_images;
      const pageImages = Array.isArray(imagesRaw) ? imagesRaw : [];
      if (!shaMatch) {
        return block(
          "review gate が満たされていません: status=pass ですが source_sha256 が現在の source と不一致（stale review）。reviewer を再実行してください。"
        );
      }
      if (checked <= 0 || pageImages.length === 0) {
        return block(
          "review gate が満たされていません: status=pass ですが visual_review が未実施（checked_page_count=0 / page_images が空）。reviewer に PNG 目視をやり直させてください。"
        );
      }
      return allow();
    }

    // 6. Anything else (fail, missing_info, unknown) → block with the status.
    return block(
      `review gate が満たされていません: status=${reviewDoc.status ?? "欠落"}, source_sha256=${
        shaMatch ? "一致" : "不一致/欠落"
      }. review.json.exact_fix_instructions または questions_for_user に従って対応してください。`
    );
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
