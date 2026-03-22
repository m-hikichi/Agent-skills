import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WORKSPACE = process.env.WORKSPACE_DIR || "/workspace";

const server = new McpServer({
  name: "marp-mcp-server",
  version: "1.0.0",
});

server.tool(
  "marp_export",
  "Export a Marp markdown file to HTML, PDF, or PPTX. The source file must contain 'marp: true' in its YAML frontmatter.",
  {
    source: z
      .string()
      .describe(
        "Path to the Marp markdown file (relative to workspace root)"
      ),
    format: z
      .enum(["html", "pdf", "pptx"])
      .describe("Output format"),
    output: z
      .string()
      .optional()
      .describe(
        "Output file path (relative to workspace root). Defaults to same name with the target extension."
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

    const formatFlag = format === "html" ? "" : `--${format}`;
    const cmd = `marp "${sourcePath}" --html ${formatFlag} -o "${outputPath}"`;

    try {
      const result = execSync(cmd, {
        encoding: "utf-8",
        timeout: 120_000,
        cwd: WORKSPACE,
      });

      const relativeOutput = output || outputPath.replace(`${WORKSPACE}/`, "");
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
  "marp_check",
  "Validate a Marp markdown file. Checks frontmatter, HTML tag usage, slide structure, and attempts a test HTML export.",
  {
    source: z
      .string()
      .describe(
        "Path to the Marp markdown file to validate (relative to workspace root)"
      ),
  },
  async ({ source }) => {
    const sourcePath = resolve(WORKSPACE, source);
    const issues: string[] = [];

    if (!existsSync(sourcePath)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `File not found: ${source}` }],
      };
    }

    const content = readFileSync(sourcePath, "utf-8");

    // Check marp: true in frontmatter
    if (!content.includes("marp: true")) {
      issues.push("Missing 'marp: true' in frontmatter");
    }

    // Check html: true when HTML tags are used in body
    const body = content.replace(/^---[\s\S]*?---/, "");
    const hasHtmlTags = /<[a-z][\s\S]*?>/i.test(body);
    if (hasHtmlTags && !content.includes("html: true")) {
      issues.push(
        "HTML tags found in slides but 'html: true' is not set in frontmatter"
      );
    }

    // Count slides
    const slideSeparators = (content.match(/^---$/gm) || []).length;
    // Subtract 2 for frontmatter delimiters if present
    const hasFrontmatter = content.startsWith("---");
    const slideCount = hasFrontmatter
      ? Math.max(slideSeparators - 2, 0) + 1
      : slideSeparators + 1;

    if (slideCount <= 1 && slideSeparators === 0) {
      issues.push("No slide separators (---) found");
    }

    // Attempt test HTML export
    try {
      execSync(`marp "${sourcePath}" --html -o /tmp/marp-check-output.html`, {
        encoding: "utf-8",
        timeout: 60_000,
        cwd: WORKSPACE,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? (error as { stderr?: string }).stderr || error.message
          : String(error);
      issues.push(`Test export failed: ${msg}`);
    }

    if (issues.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Validation passed.",
              `- Slides: ${slideCount}`,
              `- HTML tags: ${hasHtmlTags ? "yes (html: true is set)" : "none"}`,
            ].join("\n"),
          },
        ],
      };
    }

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Validation failed (${issues.length} issue(s)):\n${issues.map((issue, i) => `${i + 1}. ${issue}`).join("\n")}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
