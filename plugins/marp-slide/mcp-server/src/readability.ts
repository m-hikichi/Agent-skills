export type TextRole = "heading" | "body" | "label" | "note";
export interface ReadabilityPolicy {
  delivery_mode: "live" | "hybrid" | "read-ahead";
  accessibility_target: "standard" | "enhanced";
  thresholds: Record<TextRole, number>;
}

// Defaults are editorial starting points at logical slide scale, not universal
// scientific thresholds or PNG pixel sizes. Do not silently infer a weaker mode.
export function readabilityPolicy(source: string): ReadabilityPolicy {
  let values: Record<string, unknown>;
  if (source.trimStart().startsWith("{")) values = JSON.parse(source);
  else {
    values = {};
    for (const key of ["delivery_mode", "accessibility_target"]) {
      const match = source.match(new RegExp(`^${key}:\\s*([^\\r\\n]+)`, "m"));
      values[key] = match?.[1].replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  const mode = values.delivery_mode;
  const target = values.accessibility_target;
  if (!["live", "hybrid", "read-ahead"].includes(String(mode)) ||
      !["standard", "enhanced"].includes(String(target))) {
    throw new Error("request must specify valid delivery_mode and accessibility_target for readability QA");
  }
  const extra = target === "enhanced" ? 2 : 0;
  const base = mode === "read-ahead"
    ? { heading: 28, body: 20, label: 16, note: 14 }
    : { heading: 32, body: 24, label: 20, note: 16 };
  return {
    delivery_mode: mode as ReadabilityPolicy["delivery_mode"],
    accessibility_target: target as ReadabilityPolicy["accessibility_target"],
    thresholds: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + extra])) as Record<TextRole, number>,
  };
}

export interface ManualCheck {
  id: string;
  slide: number;
  selector: string;
  kind: "contrast" | "image_text" | "geometry";
  reason: string;
}
