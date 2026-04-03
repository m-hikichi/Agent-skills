import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

const WORKSPACE = process.env.WORKSPACE_DIR || "/workspace";

const server = new McpServer({
  name: "marp-mcp-server",
  version: "1.0.0",
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    .sort()
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
    const sourcePath = resolve(WORKSPACE, source);

    if (!existsSync(sourcePath)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `File not found: ${source}` }],
      };
    }

    const content = readFileSync(sourcePath, "utf-8");
    if (!content.includes("marp: true")) {
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

    const outputPath = output
      ? resolve(WORKSPACE, output)
      : sourcePath.replace(/\.md$/, `.${format}`);

    prepareOutputPath(outputPath, format);

    const formatFlag =
      format === "html" ? "" : format === "png" ? "--images png" : `--${format}`;
    const cmd = `marp "${sourcePath}" --html ${formatFlag} -o "${outputPath}"`;

    try {
      const result = execSync(cmd, {
        encoding: "utf-8",
        timeout: 120_000,
        cwd: WORKSPACE,
      });

      const relativeOutput = output || outputPath.replace(`${WORKSPACE}/`, "");
      if (format === "png") {
        normalizePngOutputNames(outputPath);
        const outputs = collectPngOutputs(outputPath).map((filePath) =>
          filePath.replace(`${WORKSPACE}/`, "")
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
