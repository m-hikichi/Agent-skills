import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "./index.js";
import { renderChart } from "./chart.js";
import { buildMermaidArgs, renderDiagram, validateCssColor } from "./diagram.js";
import { classifyGeometryMeasurements } from "./machine-qa.js";
import { assertDistinctPaths, resolveWorkspacePath } from "./paths.js";
import {
  buildMarpArgs,
  computeArtifactFingerprint,
  planContactSheet,
  readPngDimensions,
  type PageImage,
} from "./rendering.js";
import {
  assertSafeMermaidSource,
  assertSafeStaticSvg,
  assertSafeVegaLiteSpec,
  discoverDeckAssets,
  findMissingInformativeImageAlt,
  hasEnabledHtmlFrontmatter,
  hasHeadingDividerFrontmatter,
  hasMarpFrontmatter,
} from "./security.js";

test("MCP server registers all renderer tools without side effects", () => {
  const workspace = mkdtempSync(join(tmpdir(), "marp-server-test-"));
  try {
    assert(createServer(workspace));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Marp frontmatter accepts LF and CRLF", () => {
  assert.equal(hasMarpFrontmatter("---\nmarp: true\n---\n# A\n"), true);
  assert.equal(hasMarpFrontmatter("---\r\nmarp: true\r\n---\r\n# A\r\n"), true);
  assert.equal(hasMarpFrontmatter("---\nmarp: false\n---\n# A\n"), false);
  assert.equal(hasMarpFrontmatter("---\nMARP: true\n---\n# A\n"), false);
  assert.equal(hasEnabledHtmlFrontmatter("---\nmarp: true\nhtml: true\n---\n"), true);
  assert.equal(hasEnabledHtmlFrontmatter("---\nmarp: true\nhtml: false\n---\n"), false);
  assert.equal(
    hasHeadingDividerFrontmatter("---\r\nmarp: true\r\nheadingDivider: 2\r\n---\r\n"),
    true
  );
  assert.equal(hasHeadingDividerFrontmatter("---\nmarp: true\n---\n"), false);
});

test("workspace path validation rejects traversal and extension mismatch", () => {
  const workspace = mkdtempSync(join(tmpdir(), "marp-path-test-"));
  try {
    mkdirSync(join(workspace, "slides"));
    writeFileSync(join(workspace, "slides", "deck.md"), "# deck");
    assert.throws(
      () =>
        resolveWorkspacePath(workspace, "../outside.md", "source", {
          kind: "input",
          extensions: [".md"],
        }),
      /workspace root/
    );
    assert.throws(
      () =>
        resolveWorkspacePath(workspace, "slides/deck.md", "theme", {
          kind: "input",
          extensions: [".css"],
        }),
      /\.css/
    );
    assert.throws(
      () =>
        assertDistinctPaths(join(workspace, "slides", "deck.md"), [
          join(workspace, "slides", "deck.md"),
        ]),
      /overwrite an input/
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Marp arguments disable config lookup and omit unsafe/global HTML flags", () => {
  const pdf = buildMarpArgs("deck.md", "deck.pdf", "pdf", {
    imageScale: 2,
    themePath: "theme.css",
  });
  assert(pdf.includes("--no-config-file"));
  assert(pdf.includes("--pdf-outlines"));
  assert(!pdf.includes("--html"));
  assert(!pdf.includes("--pdf-notes"));

  const pptx = buildMarpArgs("deck.md", "deck.pptx", "pptx", {
    imageScale: 2,
  });
  assert(!pptx.includes("--pptx-editable"));
  assert.deepEqual(pptx.slice(pptx.indexOf("--image-scale"), pptx.indexOf("--image-scale") + 2), [
    "--image-scale",
    "2",
  ]);
});

test("theme security allows only built-in Marp imports", () => {
  const workspace = mkdtempSync(join(tmpdir(), "marp-theme-test-"));
  try {
    mkdirSync(join(workspace, "slides"));
    writeFileSync(join(workspace, "slides", "deck.md"), "---\nmarp: true\n---\n# Deck\n");
    writeFileSync(
      join(workspace, "slides", "theme.css"),
      "/* @theme safe */\n@import 'default';\nsection { color: #111; }\n"
    );
    assert.deepEqual(
      discoverDeckAssets(
        workspace,
        join(workspace, "slides", "deck.md"),
        join(workspace, "slides", "theme.css")
      ),
      []
    );

    writeFileSync(
      join(workspace, "slides", "theme.css"),
      "/* @theme unsafe */\n@import './other.css';\n"
    );
    assert.throws(
      () =>
        discoverDeckAssets(
          workspace,
          join(workspace, "slides", "deck.md"),
          join(workspace, "slides", "theme.css")
        ),
      /CSS @import is not allowed/
    );

    writeFileSync(
      join(workspace, "slides", "theme.css"),
      "/* @theme unsafe */\n@import url('https://example.com/theme.css');\n"
    );
    assert.throws(
      () =>
        discoverDeckAssets(
          workspace,
          join(workspace, "slides", "deck.md"),
          join(workspace, "slides", "theme.css")
        ),
      /CSS @import is not allowed/
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("deck asset discovery follows image references and ignores fenced examples", () => {
  const workspace = mkdtempSync(join(tmpdir(), "marp-assets-test-"));
  try {
    mkdirSync(join(workspace, "slides", "assets"), { recursive: true });
    writeFileSync(
      join(workspace, "slides", "assets", "visual.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
    );
    const deckPath = join(workspace, "slides", "deck.md");
    writeFileSync(
      deckPath,
      [
        "---",
        "marp: true",
        "style: |",
        "  section { --local-asset: url(assets/visual.svg); }",
        "backgroundImage: url(assets/visual.svg)",
        "---",
        "![Visual][asset]",
        "[asset]: assets/visual.svg",
        '<div style="background-image: url(assets/visual.svg)"></div>',
        "<!-- _backgroundImage: url(assets/visual.svg) -->",
        "```css",
        ".example { background: url(https://example.invalid/not-loaded.png); }",
        "```",
        "`<!-- backgroundImage: url(https://example.invalid/not-loaded.png) -->`",
      ].join("\n")
    );
    assert.deepEqual(discoverDeckAssets(workspace, deckPath), [
      join(workspace, "slides", "assets", "visual.svg"),
    ]);

    writeFileSync(
      deckPath,
      "---\nmarp: true\n---\n![Remote][asset]\n[asset]: https://example.invalid/a.png\n"
    );
    assert.throws(() => discoverDeckAssets(workspace, deckPath), /external resource/);

    writeFileSync(
      deckPath,
      "---\nmarp: true\n---\n<!-- _backgroundImage: url(https://example.invalid/a.png) -->\n"
    );
    assert.throws(() => discoverDeckAssets(workspace, deckPath), /external resource/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("artifact fingerprint uses the locked kind/path code-unit ordering", () => {
  const files = [
    { kind: "theme" as const, path: "slides/theme.css", sha256: "c".repeat(64) },
    { kind: "asset" as const, path: "slides/assets/z.svg", sha256: "d".repeat(64) },
    { kind: "request" as const, path: ".slide-work/request.yaml", sha256: "a".repeat(64) },
    { kind: "source" as const, path: "slides/presentation.md", sha256: "b".repeat(64) },
  ];
  const sorted = [...files].sort((a, b) =>
    a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
  const expected = createHash("sha256")
    .update(JSON.stringify({ version: 1, files: sorted }))
    .digest("hex");
  assert.equal(computeArtifactFingerprint(files), expected);
  assert.notEqual(
    computeArtifactFingerprint(files),
    computeArtifactFingerprint([
      ...files.slice(0, -1),
      { ...files.at(-1)!, sha256: "e".repeat(64) },
    ])
  );
});

test("contact sheet plan preserves page order and deterministic dimensions", () => {
  const pages: PageImage[] = Array.from({ length: 5 }, (_, index) => ({
    slide: index + 1,
    path: `pages/page-${String(index + 1).padStart(3, "0")}.png`,
    sha256: String(index).padStart(64, "0"),
    width: 2560,
    height: 1440,
  }));
  const plan = planContactSheet(pages);
  assert.equal(plan.columns, 3);
  assert.equal(plan.rows, 2);
  assert.equal(plan.thumbnailHeight, 180);
  assert.equal(plan.width, 1048);
  assert.equal(plan.height, 484);
  assert.deepEqual(
    plan.placements.map(({ slide }) => slide),
    [1, 2, 3, 4, 5]
  );
  assert.deepEqual(plan.placements[3], { slide: 4, left: 24, top: 252, labelTop: 432 });
});

test("PNG dimension reader rejects invalid data and reads IHDR dimensions", () => {
  const directory = mkdtempSync(join(tmpdir(), "marp-png-test-"));
  const png = join(directory, "image.png");
  try {
    const header = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(1280, 16);
    header.writeUInt32BE(720, 20);
    writeFileSync(png, header);
    assert.deepEqual(readPngDimensions(png), { width: 1280, height: 720 });
    writeFileSync(png, "not png");
    assert.throws(() => readPngDimensions(png), /valid PNG/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("machine QA geometry classifier detects overflow and clipping", () => {
  const violations = classifyGeometryMeasurements(1, [
    {
      slide: 1,
      selector: ".wide",
      clientWidth: 100,
      scrollWidth: 180,
      clientHeight: 50,
      scrollHeight: 80,
      outsideBy: 24,
      overflowHidden: true,
    },
  ]);
  assert.deepEqual(
    violations.map(({ kind }) => kind),
    ["overflow", "clipping"]
  );
});

test("machine QA detects missing/generic alt while honoring decorative assets", () => {
  const markdown = [
    "![](assets/missing.png)",
    "![image](assets/generic.png)",
    "![decorative flourish](assets/decorative.png)",
    '<img src="assets/html.png">',
    "![][reference]",
    "[reference]: assets/reference.png",
    "```markdown",
    "![](assets/code-example.png)",
    "```",
    "`![](assets/inline-code-example.png)`",
    "![bg left:40% cover](assets/background.png)",
    "![",
    "](assets/multiline.png)",
  ].join("\n");
  const missing = findMissingInformativeImageAlt(
    markdown,
    new Set(["assets/decorative.png"])
  );
  assert.deepEqual(
    missing.map(({ line, reason }) => [line, reason]),
    [
      [1, "missing"],
      [2, "generic"],
      [4, "missing"],
      [5, "missing"],
      [11, "generic"],
      [12, "missing"],
    ]
  );
  assert.equal(missing[3].target, "assets/reference.png");
});

test("static SVG and Mermaid security reject active or remote content", () => {
  assert.doesNotThrow(() =>
    assertSafeStaticSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="#shape"/></svg>')
  );
  assert.throws(
    () => assertSafeStaticSvg('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    /active SVG/
  );
  assert.throws(() =>
    assertSafeStaticSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "theme.css";</style></svg>'
    )
  );
  assert.throws(() => assertSafeMermaidSource("graph TD\nclick A href https://example.com"));
  assert.throws(() =>
    assertSafeMermaidSource("---\nconfig:\n  securityLevel: loose\n---\ngraph TD\nA-->B")
  );
  assert.equal(validateCssColor("#123abc"), "#123abc");
  assert.throws(() => validateCssColor("#12345"));
  assert.throws(() => validateCssColor("url(https://example.com)"));
  assert.throws(
    () => assertSafeVegaLiteSpec({ transform: [{ calculate: "random()", as: "x" }] }),
    /random/
  );
  assert.throws(
    () => assertSafeVegaLiteSpec({ transform: [{ sample: 10 }] }),
    /deterministic/
  );
});

test("Mermaid command is fixed to SVG and explicit configuration", () => {
  const args = buildMermaidArgs(
    "diagram.mmd",
    "diagram.svg",
    "config.json",
    "puppeteer.json",
    "neutral",
    "transparent"
  );
  assert.deepEqual(args.slice(args.indexOf("--outputFormat"), args.indexOf("--outputFormat") + 2), [
    "--outputFormat",
    "svg",
  ]);
  assert(args.includes("--puppeteerConfigFile"));
});

test("Vega-Lite chart renderer hydrates explicit local data and emits static SVG", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "marp-chart-test-"));
  try {
    mkdirSync(join(workspace, "assets"));
    writeFileSync(
      join(workspace, "assets", "chart.json"),
      JSON.stringify({
        mark: "bar",
        encoding: {
          x: { field: "label", type: "nominal" },
          y: { field: "value", type: "quantitative" },
        },
      })
    );
    writeFileSync(join(workspace, "assets", "chart.csv"), "label,value\nA,2\nB,3\n");
    const result = await renderChart(workspace, {
      spec: "assets/chart.json",
      data: "assets/chart.csv",
      output: "assets/chart.svg",
    });
    const svg = readFileSync(join(workspace, result.output), "utf8");
    assert.match(svg, /^<svg\b/);
    assert.equal(result.data, "assets/chart.csv");
    assert.equal(result.sha256.length, 64);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Mermaid renderer confines paths and sanitizes the generated SVG", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "marp-diagram-test-"));
  try {
    mkdirSync(join(workspace, "assets"));
    writeFileSync(join(workspace, "assets", "flow.mmd"), "flowchart LR\nA-->B\n");
    const result = await renderDiagram(
      workspace,
      { source: "assets/flow.mmd", output: "assets/flow.svg" },
      {
        run(_command, args) {
          const outputPath = args[args.indexOf("--output") + 1];
          writeFileSync(
            outputPath,
            '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'
          );
          return "";
        },
      }
    );
    assert.equal(result.output, "assets/flow.svg");
    assert.match(readFileSync(join(workspace, result.output), "utf8"), /^<svg\b/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
