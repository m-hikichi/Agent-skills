#!/usr/bin/env python3
"""Validate traceability links between requirements, specs, code, and tests."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

FEATURE_RE = re.compile(r"\b(?:FR|NFR)-\d+\b")
TEST_RE = re.compile(r"\bTC-\d+\b")
SPEC_MAPPING_RE = re.compile(r"(SPEC-[A-Za-z0-9_-]+)\s*/\s*([A-Z0-9,\s-]+)")


@dataclass
class Finding:
    severity: str
    message: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=".", help="Project root directory")
    parser.add_argument("--config", default="spec-config.json", help="Path to spec-config.json")
    parser.add_argument("--orphan-check", action="store_true", default=True, help="Check for implementation files not referenced by any SPEC (default: enabled)")
    parser.add_argument("--no-orphan-check", action="store_false", dest="orphan_check", help="Disable orphan check")
    parser.add_argument("--report", action="store_true", help="Print summary report of all SPECs and their implementation status")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="Output format")
    return parser.parse_args()


def load_config(project_root: Path, config_path: str) -> Dict[str, object]:
    path = (project_root / config_path).resolve()
    if not path.exists():
        return {
            "spec_dir": "docs/specs",
            "traceability_path": "docs/traceability-matrix.md",
            "requirements_path": "docs/requirements.md",
        }
    return json.loads(path.read_text(encoding="utf-8"))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def find_heading_index(lines: List[str], heading: str) -> int | None:
    pattern = re.compile(rf"^#+\s+{re.escape(heading)}\s*$")
    for index, line in enumerate(lines):
        if pattern.match(line.strip()):
            return index
    return None


def extract_table(markdown: str, heading: str) -> List[Dict[str, str]]:
    lines = markdown.splitlines()
    start = find_heading_index(lines, heading)
    if start is None:
        return []
    start += 1

    table_lines: List[str] = []
    for line in lines[start:]:
        stripped = line.strip()
        if not stripped and not table_lines:
            continue
        if stripped.startswith("#") and table_lines:
            break
        if stripped.startswith("|"):
            table_lines.append(stripped)
            continue
        if table_lines:
            break

    if len(table_lines) < 2:
        return []

    headers = [cell.strip() for cell in table_lines[0].strip("|").split("|")]
    rows: List[Dict[str, str]] = []
    for line in table_lines[2:]:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) != len(headers):
            continue
        rows.append(dict(zip(headers, cells)))
    return rows


def extract_section_text(markdown: str, heading: str) -> str:
    lines = markdown.splitlines()
    start = find_heading_index(lines, heading)
    if start is None:
        return ""
    start += 1

    collected: List[str] = []
    for line in lines[start:]:
        stripped = line.strip()
        if stripped.startswith("#"):
            break
        collected.append(line)
    return "\n".join(collected)


def collect_feature_ids(markdown: str) -> List[str]:
    text = "\n".join(
        [
            extract_section_text(markdown, "機能仕様（要件実装一覧）"),
            extract_section_text(markdown, "非機能要件"),
        ]
    )
    return sorted(set(FEATURE_RE.findall(text)))


def collect_test_ids(markdown: str) -> List[str]:
    return sorted(set(TEST_RE.findall(extract_section_text(markdown, "テスト仕様"))))


def extract_frontmatter_spec_id(markdown: str) -> str | None:
    match = re.search(r"^spec_id:\s*(SPEC-[A-Za-z0-9_-]+)\s*$", markdown, re.MULTILINE)
    return match.group(1) if match else None


def split_csv(value: str) -> List[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def row_signature(
    requirement_id: str,
    spec_id: str,
    feature_id: str,
    impl_file: str,
    symbol_kind: str,
    symbol_name: str,
    test_file: str,
    test_ids: Sequence[str],
) -> Tuple[str, str, str, str, str, str, str, Tuple[str, ...]]:
    return (
        requirement_id,
        spec_id,
        feature_id,
        impl_file,
        symbol_kind,
        symbol_name,
        test_file,
        tuple(test_ids),
    )


def parse_spec_mapping_cell(value: str) -> List[Tuple[str, str]]:
    mappings: List[Tuple[str, str]] = []
    for spec_id, feature_blob in SPEC_MAPPING_RE.findall(value):
        for feature_id in split_csv(feature_blob):
            if FEATURE_RE.fullmatch(feature_id):
                mappings.append((spec_id, feature_id))
    return mappings


def parse_requirements_mappings(markdown: str) -> Dict[str, List[Tuple[str, str]]]:
    mappings: Dict[str, List[Tuple[str, str]]] = {}
    for heading, id_column in [
        ("要件と仕様の対応（Traceability）", "要件ID"),
        ("非機能要件と仕様の対応（Traceability）", "非機能要件ID"),
    ]:
        for row in extract_table(markdown, heading):
            requirement_id = row.get(id_column, "")
            if not requirement_id:
                continue
            mappings.setdefault(requirement_id, [])
            mappings[requirement_id].extend(parse_spec_mapping_cell(row.get("対応仕様", "")))
    return mappings


def symbol_exists(symbol_kind: str, symbol_name: str, text: str) -> bool:
    if symbol_name in {"", "-"}:
        return True

    escaped = re.escape(symbol_name)
    patterns = {
        "function": [
            rf"\bfunction\s+{escaped}\b",
            rf"\bconst\s+{escaped}\b",
            rf"\blet\s+{escaped}\b",
            rf"\bvar\s+{escaped}\b",
            rf"\bdef\s+{escaped}\b",
            rf"\bfunc\s+{escaped}\b",
        ],
        "class": [rf"\bclass\s+{escaped}\b"],
        "component": [
            rf"\bfunction\s+{escaped}\b",
            rf"\bconst\s+{escaped}\b",
            rf"\bclass\s+{escaped}\b",
        ],
    }
    for pattern in patterns.get(symbol_kind, []):
        if re.search(pattern, text):
            return True
    return symbol_name in text


def extract_any_top_level_table(markdown: str) -> List[Dict[str, str]]:
    lines = markdown.splitlines()
    for index, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        table_lines: List[str] = []
        for follow in lines[index:]:
            stripped = follow.strip()
            if stripped.startswith("|"):
                table_lines.append(stripped)
                continue
            if table_lines:
                break
        if len(table_lines) < 2:
            continue
        headers = [cell.strip() for cell in table_lines[0].strip("|").split("|")]
        rows: List[Dict[str, str]] = []
        for row_line in table_lines[2:]:
            cells = [cell.strip() for cell in row_line.strip("|").split("|")]
            if len(cells) == len(headers):
                rows.append(dict(zip(headers, cells)))
        return rows
    return []


def find_matrix_rows(markdown: str) -> List[Dict[str, str]]:
    for heading in ["トレーサビリティマトリクス", "実装トレーサビリティ契約"]:
        rows = extract_table(markdown, heading)
        if rows:
            return rows
    return extract_any_top_level_table(markdown)


def collect_implementation_files(project_root: Path, roots: List[str], extensions: tuple[str, ...] = (".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".rb", ".swift")) -> set[str]:
    """Collect all code files under implementation_roots."""
    files: set[str] = set()
    for root in roots:
        root_path = project_root / root
        if not root_path.exists():
            continue
        for path in root_path.rglob("*"):
            if path.is_file() and path.suffix in extensions:
                files.add(str(path.relative_to(project_root)).replace("\\", "/"))
    return files


def validate(project_root: Path, config: Dict[str, object], *, orphan_check: bool = True) -> List[Finding]:
    findings: List[Finding] = []

    requirements_path = project_root / str(config.get("requirements_path", "docs/requirements.md"))
    traceability_path = project_root / str(config.get("traceability_path", "docs/traceability-matrix.md"))
    spec_dir = project_root / str(config.get("spec_dir", "docs/specs"))

    if not requirements_path.exists():
        findings.append(Finding("High", f"requirements file not found: {requirements_path}"))
    if not traceability_path.exists():
        findings.append(Finding("High", f"traceability matrix not found: {traceability_path}"))
    if not spec_dir.exists():
        findings.append(Finding("High", f"spec directory not found: {spec_dir}"))
        return findings

    requirements_mappings: Dict[str, List[Tuple[str, str]]] = {}
    if requirements_path.exists():
        requirements_mappings = parse_requirements_mappings(read_text(requirements_path))
        if not requirements_mappings:
            findings.append(Finding("High", "requirements traceability tables are missing or empty"))

    spec_contract_rows: Dict[tuple[str, str], List[Dict[str, str]]] = {}
    spec_feature_ids: Dict[str, List[str]] = {}
    spec_test_ids: Dict[str, List[str]] = {}
    seen_requirements_links: set[Tuple[str, str, str]] = set()
    existing_spec_ids: set[str] = set()

    for spec_path in sorted(spec_dir.glob("*.md")):
        markdown = read_text(spec_path)
        spec_id = extract_frontmatter_spec_id(markdown)
        if not spec_id:
            findings.append(Finding("High", f"{spec_path} is missing spec_id in frontmatter"))
            continue
        existing_spec_ids.add(spec_id)

        feature_ids = [feature_id for feature_id in collect_feature_ids(markdown) if not feature_id.startswith("TC-")]
        spec_feature_ids[spec_id] = feature_ids
        spec_test_ids[spec_id] = collect_test_ids(markdown)
        requirement_rows = extract_table(markdown, "対応要件（requirements.md）")

        contract_rows = extract_table(markdown, "実装トレーサビリティ契約")
        completion_rows = extract_table(markdown, "実装完了条件")
        if not contract_rows:
            findings.append(Finding("High", f"{spec_id} is missing 実装トレーサビリティ契約"))
        if not completion_rows:
            findings.append(Finding("High", f"{spec_id} is missing 実装完了条件"))

        completion_features = {row.get("機能ID", "") for row in completion_rows}

        for feature_id in feature_ids:
            key = (spec_id, feature_id)
            rows = [row for row in contract_rows if row.get("機能ID") == feature_id]
            if not rows:
                findings.append(Finding("High", f"{spec_id} / {feature_id} is missing contract rows"))
            else:
                spec_contract_rows[key] = rows
            if feature_id not in completion_features:
                findings.append(Finding("High", f"{spec_id} / {feature_id} is missing completion criteria"))

        for row in requirement_rows:
            requirement_id = row.get("要件ID", "")
            mapped_features = [
                feature_id
                for feature_id in split_csv(row.get("本仕様での実装機能ID", ""))
                if FEATURE_RE.fullmatch(feature_id)
            ]
            if not requirement_id:
                continue
            if requirement_id not in requirements_mappings:
                findings.append(Finding("High", f"{spec_id} references unknown requirement id {requirement_id}"))
                continue
            requirement_links = set(requirements_mappings.get(requirement_id, []))
            for feature_id in mapped_features:
                link = (spec_id, feature_id)
                seen_requirements_links.add((requirement_id, spec_id, feature_id))
                if link not in requirement_links:
                    findings.append(
                        Finding(
                            "High",
                            f"{spec_id} / {feature_id} is not linked from requirements traceability for {requirement_id}",
                        )
                    )

        for row in contract_rows:
            feature_id = row.get("機能ID", "")
            impl_file = row.get("実装ファイル", "")
            symbol_kind = row.get("シンボル種別", "")
            symbol_name = row.get("シンボル名", "")
            test_file = row.get("テストファイル", "")
            test_ids = split_csv(row.get("テストID", ""))

            if feature_id and feature_id not in feature_ids:
                findings.append(Finding("High", f"{spec_id} contract references unknown feature id {feature_id}"))

            if impl_file:
                impl_path = project_root / impl_file
                if not impl_path.exists():
                    findings.append(Finding("High", f"{spec_id} / {feature_id} implementation file not found: {impl_file}"))
                else:
                    impl_text = read_text(impl_path)
                    if not symbol_exists(symbol_kind, symbol_name, impl_text):
                        findings.append(
                            Finding(
                                "High",
                                f"{spec_id} / {feature_id} symbol not found in implementation: {symbol_kind} {symbol_name} ({impl_file})",
                            )
                        )

            if test_file:
                test_path = project_root / test_file
                if not test_path.exists():
                    findings.append(Finding("High", f"{spec_id} / {feature_id} test file not found: {test_file}"))
                else:
                    test_text = read_text(test_path)
                    for test_id in test_ids:
                        if test_id not in test_text:
                            findings.append(
                                Finding(
                                    "Medium",
                                    f"{spec_id} / {feature_id} test id {test_id} not found in {test_file}",
                                )
                            )

            for test_id in test_ids:
                if test_id not in spec_test_ids.get(spec_id, []):
                    findings.append(Finding("Medium", f"{spec_id} / {feature_id} references undefined test id {test_id}"))

    if traceability_path.exists():
        matrix_rows = find_matrix_rows(read_text(traceability_path))
    else:
        matrix_rows = []

    if not matrix_rows:
        findings.append(Finding("High", "traceability matrix has no parseable rows"))

    actual_matrix_signatures = set()
    for row in matrix_rows:
        requirement_id = row.get("要件ID", "")
        spec_id = row.get("仕様ID", "")
        feature_id = row.get("機能ID(FR/NFR)", "")
        impl_file = row.get("実装ファイル", "")
        symbol_kind = row.get("シンボル種別", "")
        symbol_name = row.get("シンボル名", "")
        test_file = row.get("テストファイル", "")
        test_ids = tuple(split_csv(row.get("テストID", "")))

        key = (spec_id, feature_id)
        actual_matrix_signatures.add(
            row_signature(
                requirement_id,
                spec_id,
                feature_id,
                impl_file,
                symbol_kind,
                symbol_name,
                test_file,
                test_ids,
            )
        )

        if key not in spec_contract_rows:
            findings.append(Finding("High", f"matrix row references unknown contract: {spec_id} / {feature_id}"))
            continue

        if requirement_id not in requirements_mappings:
            findings.append(Finding("High", f"matrix row references unknown requirement id: {requirement_id}"))
        elif (spec_id, feature_id) not in set(requirements_mappings.get(requirement_id, [])):
            findings.append(
                Finding(
                    "High",
                    f"matrix row is not linked from requirements traceability: {requirement_id} -> {spec_id} / {feature_id}",
                )
            )

        matching_row = None
        for contract_row in spec_contract_rows[key]:
            if (
                contract_row.get("実装ファイル", "") == impl_file
                and contract_row.get("シンボル種別", "") == symbol_kind
                and contract_row.get("シンボル名", "") == symbol_name
                and contract_row.get("テストファイル", "") == test_file
            ):
                matching_row = contract_row
                break

        if not matching_row:
            findings.append(Finding("High", f"matrix row does not match contract details: {spec_id} / {feature_id}"))
            continue

        contract_test_ids = tuple(split_csv(matching_row.get("テストID", "")))
        if contract_test_ids != test_ids:
            findings.append(Finding("Medium", f"matrix test IDs do not match contract: {spec_id} / {feature_id}"))

    expected_matrix_signatures = set()
    for requirement_id, mappings in requirements_mappings.items():
        for spec_id, feature_id in mappings:
            for contract_row in spec_contract_rows.get((spec_id, feature_id), []):
                expected_matrix_signatures.add(
                    row_signature(
                        requirement_id,
                        spec_id,
                        feature_id,
                        contract_row.get("実装ファイル", ""),
                        contract_row.get("シンボル種別", ""),
                        contract_row.get("シンボル名", ""),
                        contract_row.get("テストファイル", ""),
                        split_csv(contract_row.get("テストID", "")),
                    )
                )

    for signature in expected_matrix_signatures - actual_matrix_signatures:
        requirement_id, spec_id, feature_id, impl_file, symbol_kind, symbol_name, test_file, test_ids = signature
        findings.append(
            Finding(
                "High",
                "matrix row missing from expected coverage: "
                f"{requirement_id} -> {spec_id} / {feature_id} "
                f"({impl_file}, {symbol_kind} {symbol_name}, {test_file}, {', '.join(test_ids)})",
            )
        )

    for requirement_id, mappings in requirements_mappings.items():
        for spec_id, feature_id in mappings:
            if spec_id not in existing_spec_ids:
                findings.append(Finding("High", f"requirements traceability references missing spec: {requirement_id} -> {spec_id}"))
                continue
            if (spec_id, feature_id) not in spec_contract_rows:
                findings.append(
                    Finding(
                        "High",
                        f"requirements traceability references missing spec feature: {requirement_id} -> {spec_id} / {feature_id}",
                    )
                )
            if (requirement_id, spec_id, feature_id) not in seen_requirements_links:
                findings.append(
                    Finding(
                        "High",
                        f"requirements traceability is not reflected in spec requirement table: {requirement_id} -> {spec_id} / {feature_id}",
                    )
                )

    # --- orphan check: find implementation files not referenced by any SPEC ---
    if orphan_check:
        impl_roots = [str(r) for r in config.get("implementation_roots", ["src"])]
        all_impl_files = collect_implementation_files(project_root, impl_roots)
        referenced_files: set[str] = set()
        for rows in spec_contract_rows.values():
            for row in rows:
                impl_file = row.get("実装ファイル", "").replace("\\", "/")
                if impl_file:
                    referenced_files.add(impl_file)
        orphan_files = all_impl_files - referenced_files
        for orphan in sorted(orphan_files):
            findings.append(
                Finding(
                    "High",
                    f"implementation file not referenced by any SPEC contract: {orphan}",
                )
            )

    return findings


def print_findings(findings: Sequence[Finding], fmt: str = "text") -> int:
    if fmt == "json":
        result = {
            "ok": len(findings) == 0,
            "findings": [{"severity": f.severity, "message": f.message} for f in findings],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if not findings else 1

    if not findings:
        print("OK: spec consistency check passed.")
        return 0

    print("Findings:")
    for finding in findings:
        print(f"- {finding.severity}: {finding.message}")
    return 1


def generate_report(project_root: Path, config: Dict[str, object], fmt: str = "text") -> str:
    """Generate a summary report of all SPECs and their implementation status."""
    spec_dir = project_root / str(config.get("spec_dir", "docs/specs"))
    if not spec_dir.exists():
        return "No spec directory found."

    rows: List[Dict[str, str | int]] = []
    for spec_path in sorted(spec_dir.glob("*.md")):
        markdown = read_text(spec_path)
        spec_id = extract_frontmatter_spec_id(markdown)
        if not spec_id:
            continue

        status_match = re.search(r"^status:\s*(\S+)", markdown, re.MULTILINE)
        status = status_match.group(1) if status_match else "unknown"

        feature_ids = collect_feature_ids(markdown)
        contract_rows = extract_table(markdown, "実装トレーサビリティ契約")

        total_fr = len(feature_ids)
        implemented = 0
        tested = 0
        for feature_id in feature_ids:
            fr_rows = [r for r in contract_rows if r.get("機能ID") == feature_id]
            for row in fr_rows:
                impl_file = row.get("実装ファイル", "")
                if impl_file and (project_root / impl_file).exists():
                    implemented += 1
                    break
            for row in fr_rows:
                test_file = row.get("テストファイル", "")
                if test_file and (project_root / test_file).exists():
                    tested += 1
                    break

        rows.append({
            "spec_id": spec_id,
            "status": status,
            "total_fr": total_fr,
            "implemented": implemented,
            "tested": tested,
        })

    if fmt == "json":
        return json.dumps(rows, ensure_ascii=False, indent=2)

    if not rows:
        return "No SPEC documents found."

    lines = [
        "| SPEC | Status | FR Total | Implemented | Tested |",
        "|------|--------|----------|-------------|--------|",
    ]
    for row in rows:
        lines.append(
            f"| {row['spec_id']} | {row['status']} | {row['total_fr']} | {row['implemented']} | {row['tested']} |"
        )

    total_fr = sum(r["total_fr"] for r in rows)
    total_impl = sum(r["implemented"] for r in rows)
    total_test = sum(r["tested"] for r in rows)
    lines.append(f"| **Total** | | **{total_fr}** | **{total_impl}** | **{total_test}** |")

    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    project_root = Path(args.project_root).resolve()
    config = load_config(project_root, args.config)

    if args.report:
        print(generate_report(project_root, config, fmt=args.format))
        return 0

    findings = validate(project_root, config, orphan_check=args.orphan_check)
    return print_findings(findings, fmt=args.format)


if __name__ == "__main__":
    sys.exit(main())
