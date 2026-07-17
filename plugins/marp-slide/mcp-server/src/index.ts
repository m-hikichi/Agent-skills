import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { renderChart } from "./chart.js";
import { renderDiagram } from "./diagram.js";
import { renderDeck, renderLegacyExport } from "./rendering.js";

const DEFAULT_WORKSPACE = resolve(process.env.WORKSPACE_DIR || "/workspace");

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const withStderr = error as Error & { stderr?: string | Buffer };
    const stderr = withStderr.stderr?.toString().trim();
    return stderr || error.message;
  }
  return String(error);
}

function successResult(label: string, result: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${label}\n${JSON.stringify(result, null, 2)}`,
      },
    ],
  };
}

function failureResult(label: string, error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `${label}: ${errorText(error)}`,
      },
    ],
  };
}

export function createServer(workspace = DEFAULT_WORKSPACE): McpServer {
  const server = new McpServer({
    name: "marp-mcp-server",
    version: "2.0.0",
  });

  server.tool(
    "marp_render_deck",
    "Render a workspace-local Marp deck deterministically to one or more deliverable formats. Always exports presenter notes plus review PNG pages and a contact sheet, writes render-manifest.json and machine-qa.json, uses PDF outlines without PDF note annotations, and never generates editable PPTX.",
    {
      source: z
        .string()
        .describe("Workspace-relative Marp Markdown path; must use .md"),
      theme: z
        .string()
        .optional()
        .describe("Optional workspace-relative custom theme CSS path"),
      formats: z
        .array(z.enum(["html", "pdf", "pptx", "png"]))
        .min(1)
        .default(["pdf", "png"])
        .describe(
          "Unique requested deliverable formats; defaults to PDF and PNG. PNG review pages are generated even when omitted."
        ),
      output_dir: z
        .string()
        .default(".slide-work")
        .describe(
          "Workspace-relative artifact directory. Defaults to .slide-work; PNG pages go to rendered-pages/"
        ),
      image_scale: z
        .number()
        .min(1)
        .max(4)
        .default(2)
        .describe("PNG/PPTX render scale; defaults to 2"),
    },
    async (input) => {
      try {
        const result = await renderDeck(workspace, input);
        return successResult(
          result.machine_qa.status === "pass"
            ? "Marp deck render and machine QA passed"
            : "Marp deck render completed with machine QA failures",
          result
        );
      } catch (error) {
        return failureResult("Marp deck render failed", error);
      }
    }
  );

  server.tool(
    "marp_render_chart",
    "Compile a workspace-local Vega-Lite JSON specification and optional CSV/TSV/JSON data to a static SVG. Data URLs are hydrated from local files; network resources, links, and image marks are rejected.",
    {
      spec: z
        .string()
        .describe("Workspace-relative Vega-Lite JSON specification path"),
      data: z
        .string()
        .optional()
        .describe(
          "Optional workspace-relative CSV, TSV, or JSON data path. Overrides top-level spec.data."
        ),
      output: z
        .string()
        .optional()
        .describe("Optional workspace-relative .svg output path"),
    },
    async (input) => {
      try {
        return successResult(
          "Vega-Lite chart render successful",
          await renderChart(workspace, input)
        );
      } catch (error) {
        return failureResult("Vega-Lite chart render failed", error);
      }
    }
  );

  server.tool(
    "marp_render_diagram",
    "Render a workspace-local Mermaid source file to a static, sanitized SVG. Runtime JavaScript, remote resources, click callbacks, foreignObject, and source-level init overrides are rejected.",
    {
      source: z
        .string()
        .describe("Workspace-relative .mmd or .mermaid source path"),
      output: z
        .string()
        .optional()
        .describe("Optional workspace-relative .svg output path"),
      theme: z
        .enum(["default", "neutral", "dark", "forest"])
        .default("neutral")
        .describe("Mermaid theme; defaults to neutral"),
      background: z
        .string()
        .default("transparent")
        .describe("Transparent, hex, rgb(a), or hsl(a) background"),
    },
    async (input) => {
      try {
        return successResult(
          "Mermaid diagram render successful",
          await renderDiagram(workspace, input)
        );
      } catch (error) {
        return failureResult("Mermaid diagram render failed", error);
      }
    }
  );

  server.tool(
    "marp_export",
    "Compatibility wrapper for the v0.x single-format Marp export interface. New workflows should use marp_render_deck. Output extension must match format; PNG pages use a deterministic 3-digit suffix.",
    {
      source: z.string().describe("Workspace-relative Marp Markdown path"),
      format: z.enum(["html", "pdf", "pptx", "png"]),
      output: z
        .string()
        .optional()
        .describe("Optional workspace-relative output path with matching extension"),
      theme: z
        .string()
        .optional()
        .describe("Optional workspace-relative custom theme CSS path"),
    },
    async (input) => {
      try {
        return successResult(
          "Marp compatibility export successful",
          renderLegacyExport(workspace, input)
        );
      } catch (error) {
        return failureResult("Marp compatibility export failed", error);
      }
    }
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
