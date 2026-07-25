# -*- coding: utf-8 -*-
"""Design schema v2/v3 normalization, Spec Kit extraction, and quality gates.

Schema v2 remains readable so existing feature specifications and generated
documents can still be checked.  Schema v3 adds an explicit document level and
separates the four kinds of readiness that are often (and incorrectly) folded
into a single ``passed`` flag.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path


SCHEMA_VERSION = 3
LEGACY_SCHEMA_VERSION = 2
DOCUMENT_LEVELS = {"functional-design", "implementation-ready"}
READINESS_STATUSES = {"passed", "failed", "not-evaluated", "not-applicable"}
READINESS_AXES = (
    "requirements_coverage",
    "functional_design",
    "implementation_contracts",
    "operational_readiness",
)
EXECUTION_TYPES = {
    "screen",
    "api",
    "batch",
    "event",
    "external-interface",
    "manual",
    "cross-cutting",
}
INTERFACE_TYPES = EXECUTION_TYPES - {"cross-cutting"}
COVERAGE_STATES = {"covered", "partial", "future", "out-of-scope", "unresolved"}
FUNCTION_STATES = {"current", "future"}
RULE_BASES = {"specified", "derived", "confirmed"}
APPLICABILITY_STATES = {"required", "not-applicable", "not-evaluated"}
ARTIFACT_TYPES = {
    "spec",
    "plan",
    "research",
    "data-model",
    "contracts",
    "quickstart",
    "tasks",
    "constitution",
    "code",
}
AMBIGUITY_PATTERNS = (
    ("曖昧な程度・時期", re.compile(r"適切(?:に|な)|必要に応じ|速やかに|可能な限り|原則として")),
    ("代理者の決定方法", re.compile(r"代理[^。]*(?:者|承認)")),
)

TYPE_LABELS = {
    "functional-requirement": "機能要件",
    "user-story": "ユーザーストーリー",
    "acceptance-scenario": "受入シナリオ",
    "edge-case": "エッジケース",
    "clarification": "確認回答",
    "assumption": "前提",
    "success-criterion": "成功基準",
    "out-of-scope": "対象外",
}


def _clean_markdown(text):
    text = re.sub(r"\*\*|__|`", "", str(text or ""))
    return re.sub(r"\s+", " ", text).strip()


def _future_text(text):
    return bool(re.search(r"将来|future|v\s*\d+\s*対象外|対象外[・/／]?将来", text, re.I))


def _source_status(item_type, text):
    if item_type == "out-of-scope":
        return "future" if _future_text(text) else "out-of-scope"
    return "future" if _future_text(text) else "current"


def _logical_blocks(spec_text):
    """Yield logical Markdown blocks while joining continuation lines of list items."""
    current = None
    for line_no, raw in enumerate(spec_text.splitlines(), 1):
        stripped = raw.strip()
        if not stripped:
            if current:
                yield current
                current = None
            continue
        starts_block = bool(
            re.match(r"^#{1,6}\s+", stripped)
            or re.match(r"^[-*+]\s+", stripped)
            or re.match(r"^\d+[.)．]\s+", stripped)
            or re.match(r"^\*\*.+?\*\*\s*:?[：]?$", stripped)
        )
        if starts_block:
            if current:
                yield current
            current = [line_no, stripped]
            continue
        if current and re.match(r"^(?:[-*+]\s+|\d+[.)．]\s+)", current[1]):
            current[1] += " " + stripped
        else:
            if current:
                yield current
            current = [line_no, stripped]
    if current:
        yield current


def _fingerprint(item_type, text):
    normalized = _clean_markdown(text).casefold()
    return hashlib.sha1(f"{item_type}\0{normalized}".encode("utf-8")).hexdigest()[:12]


def build_source_catalog(items):
    """Persist identifiers separately from line numbers so insertion does not renumber them."""
    return [
        {
            "id": item["id"],
            "type": item["type"],
            "text": item["text"],
            "fingerprint": item.get("fingerprint") or _fingerprint(item["type"], item["text"]),
            "locator_key": item.get("locator_key", ""),
        }
        for item in items
    ]


def detect_ambiguities(items):
    """Return normative phrases that require confirmation before design can be final."""
    findings = []
    for item in items:
        if item["type"] in {"clarification", "out-of-scope"}:
            continue
        text = item["text"]
        for reason, pattern in AMBIGUITY_PATTERNS:
            if pattern.search(text):
                if reason == "代理者の決定方法" and re.search(r"設定|指定|選択|優先順位|順序|上長", text):
                    continue
                findings.append({"source_id": item["id"], "reason": reason, "text": text})
        if (
            "再送" in text
            and re.search(r"失敗|通知|送信|リトライ", text)
            and not re.search(r"\d+\s*(?:回|分|時間|日)|最大|上限|間隔", text)
        ):
            findings.append({"source_id": item["id"], "reason": "再送回数・間隔・終了条件", "text": text})
    unique = {}
    for finding in findings:
        unique[(finding["source_id"], finding["reason"])] = finding
    return list(unique.values())


def extract_normative_items(spec_text, source_catalog=None):
    """Extract normative elements and reuse persisted IDs for unchanged/moved items."""
    items = []
    counters = Counter()
    headings = []
    section = ""
    session_date = ""
    current_story = ""
    story_no = 0

    aliases = {
        "acceptance": ("acceptance scenarios", "acceptance criteria", "受入シナリオ", "受入条件"),
        "edge": ("edge cases", "エッジケース"),
        "clarifications": ("clarifications", "確認事項", "明確化"),
        "assumptions": ("assumptions", "前提"),
        "success": ("success criteria", "成功基準"),
        "out": ("out of scope", "対象外"),
    }

    catalog = source_catalog or []
    catalog_by_fingerprint = defaultdict(list)
    for entry in catalog:
        fingerprint = entry.get("fingerprint") or _fingerprint(entry.get("type", ""), entry.get("text", ""))
        catalog_by_fingerprint[(entry.get("type"), fingerprint)].append(entry)
    used_catalog_ids = set()

    def stable_id(proposed_id, item_type, text, explicit):
        if explicit:
            return proposed_id
        fingerprint = _fingerprint(item_type, text)
        for entry in catalog_by_fingerprint.get((item_type, fingerprint), []):
            if entry.get("id") not in used_catalog_ids:
                used_catalog_ids.add(entry.get("id"))
                return entry.get("id")
        candidates = []
        clean_text = _clean_markdown(text).casefold()
        for entry in catalog:
            if entry.get("type") != item_type or entry.get("id") in used_catalog_ids:
                continue
            ratio = SequenceMatcher(None, clean_text, _clean_markdown(entry.get("text", "")).casefold()).ratio()
            if ratio >= 0.9:
                candidates.append((ratio, entry))
        if candidates:
            entry = max(candidates, key=lambda candidate: candidate[0])[1]
            used_catalog_ids.add(entry.get("id"))
            return entry.get("id")
        reserved = {str(entry.get("id", "")) for entry in catalog} | {item["id"] for item in items}
        if proposed_id in reserved:
            numeric = re.match(r"^(.*?)(\d+)$", proposed_id)
            if numeric:
                prefix, digits = numeric.groups()
                values = [
                    int(match.group(1))
                    for value in reserved
                    if (match := re.fullmatch(re.escape(prefix) + r"(\d+)", value))
                ]
                return prefix + str(max(values or [0]) + 1).zfill(len(digits))
        return proposed_id

    def add(item_id, item_type, text, line_no, explicit=False):
        text = _clean_markdown(text)
        item_id = stable_id(item_id, item_type, text, explicit)
        if not text or any(existing["id"] == item_id for existing in items):
            return
        locator_key = " > ".join(headings)
        items.append(
            {
                "id": item_id,
                "type": item_type,
                "text": text,
                "locator": locator_key + f" (L{line_no})",
                "locator_key": locator_key,
                "fingerprint": _fingerprint(item_type, text),
                "source_status": _source_status(item_type, text),
            }
        )

    for line_no, stripped in _logical_blocks(spec_text):
        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            level = len(heading.group(1))
            title = _clean_markdown(heading.group(2))
            headings = headings[: level - 1]
            headings.append(title)
            normalized = title.casefold()
            section = ""
            for key, names in aliases.items():
                if any(name in normalized for name in names):
                    section = key
                    break
            session = re.search(r"session\s+(\d{4}[-/]\d{2}[-/]\d{2})", normalized, re.I)
            if session:
                session_date = session.group(1).replace("/", "-")
                section = "clarifications"
            story = re.match(r"user story\s*(\d+)?\s*[-:：]?\s*(.*)", title, re.I)
            if story:
                story_no = int(story.group(1) or (story_no + 1))
                current_story = f"US-{story_no:03d}"
                add(current_story, "user-story", title, line_no, explicit=bool(story.group(1)))
            continue

        emphasized = re.match(r"^\*\*(.+?)\*\*\s*:?[：]?$", stripped)
        if emphasized:
            normalized = _clean_markdown(emphasized.group(1)).casefold()
            for key, names in aliases.items():
                if any(name in normalized for name in names):
                    section = key
                    break
            continue

        fr_match = re.search(r"\b(FR-\d+)\b[^:：]*[:：]\s*(.+)$", stripped, re.I)
        if fr_match:
            add(fr_match.group(1).upper(), "functional-requirement", fr_match.group(2), line_no, explicit=True)
            continue
        sc_match = re.search(r"\b(SC-\d+)\b[^:：]*[:：]?\s*(.+)$", stripped, re.I)
        if sc_match:
            add(sc_match.group(1).upper(), "success-criterion", sc_match.group(2), line_no, explicit=True)
            continue

        numbered = re.match(r"^(\d+)[.)．]\s+(.+)$", stripped)
        bullet = re.match(r"^[-*+]\s+(.+)$", stripped)
        content = numbered.group(2) if numbered else (bullet.group(1) if bullet else "")
        if not content:
            continue

        if section == "acceptance":
            counters[("AC", current_story)] += 1
            prefix = current_story or "US-000"
            add(
                f"AC-{prefix.removeprefix('US-')}-{counters[('AC', current_story)]:02d}",
                "acceptance-scenario",
                content,
                line_no,
            )
        elif section == "edge":
            counters["EC"] += 1
            add(f"EC-{counters['EC']:03d}", "edge-case", content, line_no)
        elif section == "clarifications":
            counters[("CL", session_date)] += 1
            stamp = (session_date or "UNDATED").replace("-", "")
            explicit = re.search(r"\bCL-[A-Z0-9-]+\b", _clean_markdown(content), re.I)
            item_id = explicit.group(0).upper() if explicit else f"CL-{stamp}-{counters[('CL', session_date)]:02d}"
            add(item_id, "clarification", content, line_no, explicit=bool(explicit))
        elif section == "assumptions":
            counters["ASM"] += 1
            add(f"ASM-{counters['ASM']:03d}", "assumption", content, line_no)
        elif section == "out":
            counters["OOS"] += 1
            add(f"OOS-{counters['OOS']:03d}", "out-of-scope", content, line_no)

    return items


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def flatten_functions(cfg):
    rows = []
    for major in cfg.get("function_list", []) or []:
        for middle in major.get("children", []) or []:
            for minor in middle.get("children", []) or []:
                for row in minor.get("rows", []) or []:
                    rows.append((major, middle, minor, row))
    return rows


def _split_refs(value):
    if isinstance(value, list):
        values = value
    else:
        values = re.split(r"[,、\s]+", str(value or ""))
    return [str(v).strip().upper() for v in values if str(v).strip()]


def _legacy_execution(row):
    screens = [str(v).strip() for v in _as_list(row.get("画面")) if str(v).strip()]
    scr_refs = [re.match(r"SCR-\d+", v).group(0) for v in screens if re.match(r"SCR-\d+", v)]
    if scr_refs:
        return {"type": "screen", "refs": scr_refs}
    joined = " ".join(screens)
    if "全画面共通" in joined:
        return {"type": "cross-cutting", "refs": []}
    if any(word in joined for word in ("自動", "バッチ", "定時")):
        return {"type": "batch", "refs": []}
    return {"type": "manual", "refs": []}


def normalize_config(config):
    """Normalize without silently upgrading an already versioned document.

    v2 is deliberately returned as v2: callers that merely render/check an old
    document must not receive a lossy, implicit migration.  ``migrate_design``
    performs the explicit v1/v2 -> v3 upgrade.
    """
    cfg = copy.deepcopy(config)
    if cfg.get("schema_version") == SCHEMA_VERSION:
        cfg.setdefault("document_level", "functional-design")
        source = cfg.setdefault("source", {})
        source.setdefault("artifacts", [])
        cfg.setdefault("interfaces", cfg.pop("screens", []))
        cfg.setdefault("traceability", [])
        cfg.setdefault("source_catalog", [])
        cfg.setdefault("decisions", [])
        cfg.setdefault("requirement_decisions", [])
        cfg.setdefault("open_questions", [])
        cfg.setdefault("workflows", [])
        cfg.setdefault("state_models", [])
        cfg.setdefault("entities", [])
        cfg.setdefault("architecture", {})
        cfg.setdefault("quality_scenarios", [])
        cfg.setdefault("risks", [])
        cfg.setdefault("verification", [])
        cfg.setdefault("applicability", {})
        return cfg

    if cfg.get("schema_version") == LEGACY_SCHEMA_VERSION:
        cfg.setdefault("interfaces", cfg.pop("screens", []))
        cfg.setdefault("traceability", [])
        cfg.setdefault("source_catalog", [])
        cfg.setdefault("decisions", [])
        cfg.setdefault("open_questions", [])
        return cfg

    screens = cfg.pop("screens", []) or []
    interfaces = []
    for screen in screens:
        interfaces.append(
            {
                "id": screen.get("id", ""),
                "type": "screen",
                "name": screen.get("name", ""),
                "summary": screen.get("summary", ""),
                "actors": _as_list(screen.get("actors") or screen.get("roles")),
                "status": "future" if any(screen.get(k) for k in ("future", "out_v1", "対象外")) else "current",
            }
        )

    questions = list(cfg.get("open_questions", []) or [])
    migration_groups = defaultdict(list)
    for index, (major, _, _, row) in enumerate(flatten_functions(cfg), 1):
        function_id = row.get("id") or f"FNC-{index:03d}"
        name = row.get("機能名") or row.get("細分類") or ""
        if "業務ルール" in row or "画面" in row:
            summary = row.get("概要", "")
            legacy_rules = _as_list(row.get("業務ルール"))
        else:
            summary = row.get("機能", "")
            legacy_rules = _as_list(row.get("概要"))
        refs = _split_refs(row.get("source_refs") or row.get("FR") or row.get("由来FR"))
        row.clear()
        row.update(
            {
                "id": function_id,
                "name": name,
                "summary": summary,
                "actors": ["要確認"],
                "trigger": "要確認",
                "execution": _legacy_execution({"画面": config_row_screens(config, index - 1)}),
                "inputs": [],
                "outputs": [],
                "preconditions": [],
                "postconditions": [],
                "business_rules": [
                    {
                        "id": f"BR-{function_id.removeprefix('FNC-')}-{rule_index:02d}",
                        "text": str(rule),
                        "basis": "specified",
                        "source_refs": refs,
                    }
                    for rule_index, rule in enumerate(legacy_rules, 1)
                ],
                "exceptions": [],
                "data_entities": [],
                "source_refs": refs,
                "status": "future" if any(config_row_future(config, index - 1)) else "current",
            }
        )
        migration_groups[str(major.get("name", "未分類"))].append((function_id, refs))

    for group_index, (major_name, entries) in enumerate(migration_groups.items(), 1):
        function_ids = [entry[0] for entry in entries]
        source_refs = sorted({ref for _, refs in entries for ref in refs})
        questions.append(
            {
                "id": f"Q-MIG-{group_index:03d}",
                "topic": "legacy-design-details",
                "severity": "blocking",
                "function_ids": function_ids,
                "question": (
                    f"旧形式の大分類「{major_name}」に属する機能について、アクター、起動契機、"
                    "入出力、事前・事後条件、例外をまとめて確認してください: "
                    + ", ".join(function_ids)
                ),
                "source_refs": source_refs,
            }
        )

    cfg["schema_version"] = LEGACY_SCHEMA_VERSION
    cfg["interfaces"] = interfaces
    cfg["traceability"] = cfg.get("traceability", []) or []
    cfg["decisions"] = cfg.get("decisions", []) or []
    cfg["open_questions"] = questions
    cfg.setdefault("migration", {})["from_version"] = 1
    cfg["migration"]["warnings"] = ["旧形式からv2へ変換しました。確定版生成前に要確認事項を解消してください"]
    return cfg


def config_row_screens(config, wanted_index):
    for index, (_, _, _, row) in enumerate(flatten_functions(config)):
        if index == wanted_index:
            return row.get("画面", [])
    return []


def config_row_future(config, wanted_index):
    for index, (_, _, _, row) in enumerate(flatten_functions(config)):
        if index == wanted_index:
            return [bool(row.get(k)) for k in ("future", "将来", "out_v1", "対象外")]
    return [False]


def _report(errors, warnings, items, traceability, functions):
    by_type = defaultdict(lambda: {"total": 0, "resolved": 0})
    trace_by_id = {entry.get("source_id"): entry for entry in traceability}
    for item in items:
        bucket = by_type[item["type"]]
        bucket["total"] += 1
        coverage = trace_by_id.get(item["id"], {}).get("coverage")
        if coverage in {"covered", "future", "out-of-scope"}:
            bucket["resolved"] += 1
    coverage = {}
    for kind, counts in sorted(by_type.items()):
        coverage[kind] = {
            **counts,
            "percent": round(counts["resolved"] * 100 / counts["total"], 1) if counts["total"] else 100.0,
        }
    return {
        "status": "passed" if not errors else "failed",
        "blocking_error_count": len(errors),
        "warning_count": len(warnings),
        "unresolved_count": sum(1 for e in traceability if e.get("coverage") in {"partial", "unresolved"}),
        "unsubstantiated_count": sum(1 for _, _, _, f in functions if not f.get("source_refs")),
        "coverage": coverage,
        "errors": errors,
        "warnings": warnings,
    }


def _validate_v2_design(spec_text, config):
    """Validate schema v2 and bidirectional traceability against spec.md."""
    cfg = normalize_config(config)
    errors = []
    warnings = []
    items = extract_normative_items(spec_text, cfg.get("source_catalog"))
    item_by_id = {item["id"]: item for item in items}
    functions = flatten_functions(cfg)
    function_by_id = {}

    if config.get("schema_version") != LEGACY_SCHEMA_VERSION:
        errors.append("旧形式です。v2へ移行し、要確認事項を解消してください")
    if not functions:
        errors.append("機能が1件もありません")

    interface_by_id = {}
    for interface in cfg.get("interfaces", []) or []:
        interface_id = str(interface.get("id", "")).strip()
        interface_type = interface.get("type")
        if not interface_id or interface_id in interface_by_id:
            errors.append(f"インターフェースIDが空または重複しています: {interface_id or '(空)'}")
        else:
            interface_by_id[interface_id] = interface
        if interface_type not in INTERFACE_TYPES:
            errors.append(f"インターフェース {interface_id}: type が不正です: {interface_type}")
        if not str(interface.get("name", "")).strip():
            errors.append(f"インターフェース {interface_id}: name が空です")
        if not [str(v).strip() for v in _as_list(interface.get("actors")) if str(v).strip()]:
            errors.append(f"インターフェース {interface_id}: actors が空です")

    decision_ids = {str(d.get("id", "")).upper() for d in cfg.get("decisions", []) or []}
    resolved_ambiguity_sources = {
        ref
        for decision in cfg.get("decisions", []) or []
        for ref in _split_refs(decision.get("source_refs"))
    }
    for decision in cfg.get("decisions", []) or []:
        decision_id = str(decision.get("id", "")).upper()
        if decision_id not in item_by_id or item_by_id[decision_id]["type"] != "clarification":
            errors.append(f"確認済み決定 {decision_id or '(空)'}: spec.mdのClarificationを参照していません")
        if not str(decision.get("question", "")).strip() or not str(decision.get("answer", "")).strip():
            errors.append(f"確認済み決定 {decision_id or '(空)'}: questionまたはanswerが空です")
    for ambiguity in detect_ambiguities(items):
        if ambiguity["source_id"] not in resolved_ambiguity_sources:
            errors.append(
                f"規範要素 {ambiguity['source_id']} に未確認の曖昧さがあります"
                f"（{ambiguity['reason']}）: {ambiguity['text']}"
            )
    valid_source_ids = set(item_by_id) | decision_ids
    for major, middle, minor, function in functions:
        fid = str(function.get("id", "")).strip()
        label = fid or function.get("name") or "(名称なし)"
        if not re.fullmatch(r"FNC-\d{3,}", fid):
            errors.append(f"機能 {label}: id は FNC-xxx 形式で指定してください")
        elif fid in function_by_id:
            errors.append(f"機能IDが重複しています: {fid}")
        else:
            function_by_id[fid] = function
        for category, category_label in ((major, "大分類"), (middle, "中分類"), (minor, "小分類")):
            if not str(category.get("name", "")).strip():
                errors.append(f"機能 {label}: {category_label}名が空です")
        for key, display in (("name", "機能名"), ("summary", "概要"), ("trigger", "起動契機")):
            if not str(function.get(key, "")).strip():
                errors.append(f"機能 {label}: {display}が空です")
        actors = [str(v).strip() for v in _as_list(function.get("actors")) if str(v).strip()]
        if not actors or "要確認" in actors:
            errors.append(f"機能 {label}: アクターが未確定です")
        status = function.get("status")
        if status not in FUNCTION_STATES:
            errors.append(f"機能 {label}: status が不正です: {status}")
        execution = function.get("execution") or {}
        execution_type = execution.get("type")
        if execution_type not in EXECUTION_TYPES:
            errors.append(f"機能 {label}: execution.type が不正です: {execution_type}")
        refs = _split_refs(function.get("source_refs"))
        if not refs:
            errors.append(f"機能 {label}: 根拠参照がありません")
        invalid_refs = [ref for ref in refs if ref not in valid_source_ids]
        if invalid_refs:
            errors.append(f"機能 {label}: specに無い根拠参照: {', '.join(invalid_refs)}")
        source_statuses = {item_by_id[r]["source_status"] for r in refs if r in item_by_id}
        if status == "current" and source_statuses and source_statuses <= {"future", "out-of-scope"}:
            errors.append(f"機能 {label}: 将来・対象外の根拠だけを現行機能に紐付けています")
        for key in ("inputs", "outputs", "preconditions", "postconditions", "exceptions", "data_entities"):
            if key not in function or not isinstance(function.get(key), list):
                errors.append(f"機能 {label}: {key} は配列で指定してください")
        if not function.get("outputs") and not function.get("postconditions"):
            warnings.append(f"機能 {label}: 出力または事後状態がありません")
        if not function.get("data_entities"):
            warnings.append(f"機能 {label}: 対象データがありません")
        execution_refs = [str(v) for v in _as_list(execution.get("refs")) if str(v)]
        if execution_type == "cross-cutting" and execution_refs:
            errors.append(f"機能 {label}: cross-cutting はインターフェース参照を持てません")
        if execution_type != "cross-cutting":
            if not execution_refs:
                errors.append(f"機能 {label}: execution.refs が空です")
            for ref in execution_refs:
                interface = interface_by_id.get(ref)
                if not interface:
                    errors.append(f"機能 {label}: 未定義のインターフェース {ref} を参照しています")
                elif interface.get("type") != execution_type:
                    errors.append(
                        f"機能 {label}: execution.type={execution_type} と {ref} のtype={interface.get('type')}が不一致です"
                    )
        rules = function.get("business_rules")
        if not isinstance(rules, list) or not rules:
            errors.append(f"機能 {label}: 業務ルールがありません")
            rules = []
        if len(rules) > 7:
            warnings.append(f"機能 {label}: 業務ルールが{len(rules)}件あります。責務が大きすぎないか確認してください")
        for rule_index, rule in enumerate(rules, 1):
            if not isinstance(rule, dict):
                errors.append(f"機能 {label}: 業務ルール{rule_index}はオブジェクトで指定してください")
                continue
            if not str(rule.get("text", "")).strip():
                errors.append(f"機能 {label}: 業務ルール{rule_index}の本文が空です")
            basis = rule.get("basis")
            if basis not in RULE_BASES:
                errors.append(f"機能 {label}: 業務ルール{rule_index}のbasisが不正です: {basis}")
            rule_refs = _split_refs(rule.get("source_refs"))
            if not rule_refs:
                errors.append(f"機能 {label}: 業務ルール{rule_index}に根拠がありません")
            invalid_rule_refs = [ref for ref in rule_refs if ref not in valid_source_ids]
            if invalid_rule_refs:
                errors.append(f"機能 {label}: 業務ルール{rule_index}の根拠が不正です: {', '.join(invalid_rule_refs)}")
            if basis == "derived" and not str(rule.get("rationale", "")).strip():
                errors.append(f"機能 {label}: 導出した業務ルール{rule_index}にrationaleがありません")
            if basis == "confirmed" and not any(ref.startswith("CL-") or ref in decision_ids for ref in rule_refs):
                errors.append(f"機能 {label}: 確認済み業務ルール{rule_index}に確認回答の参照がありません")
            missing_from_function = [ref for ref in rule_refs if ref not in refs]
            if missing_from_function:
                errors.append(
                    f"機能 {label}: 業務ルール{rule_index}の根拠が機能のsource_refsにありません: "
                    + ", ".join(missing_from_function)
                )
        for exception_index, exception in enumerate(function.get("exceptions", []) or [], 1):
            if not isinstance(exception, dict):
                errors.append(f"機能 {label}: 例外{exception_index}はオブジェクトで指定してください")
                continue
            if not str(exception.get("condition", "")).strip() or not str(exception.get("behavior", "")).strip():
                errors.append(f"機能 {label}: 例外{exception_index}のconditionまたはbehaviorが空です")
            basis = exception.get("basis")
            if basis not in RULE_BASES:
                errors.append(f"機能 {label}: 例外{exception_index}のbasisが不正です: {basis}")
            exception_refs = _split_refs(exception.get("source_refs"))
            if not exception_refs:
                errors.append(f"機能 {label}: 例外{exception_index}に根拠がありません")
            invalid_exception_refs = [ref for ref in exception_refs if ref not in valid_source_ids]
            if invalid_exception_refs:
                errors.append(f"機能 {label}: 例外{exception_index}の根拠が不正です: {', '.join(invalid_exception_refs)}")
            missing_from_function = [ref for ref in exception_refs if ref not in refs]
            if missing_from_function:
                errors.append(
                    f"機能 {label}: 例外{exception_index}の根拠が機能のsource_refsにありません: "
                    + ", ".join(missing_from_function)
                )
            if basis == "derived" and not str(exception.get("rationale", "")).strip():
                errors.append(f"機能 {label}: 導出した例外{exception_index}にrationaleがありません")
            if basis == "confirmed" and not any(ref.startswith("CL-") or ref in decision_ids for ref in exception_refs):
                errors.append(f"機能 {label}: 確認済み例外{exception_index}に確認回答の参照がありません")

    traceability = cfg.get("traceability", []) or []
    trace_by_id = {}
    for entry in traceability:
        source_id = str(entry.get("source_id", "")).strip().upper()
        if source_id in trace_by_id:
            errors.append(f"トレーサビリティが重複しています: {source_id}")
        trace_by_id[source_id] = entry
        if source_id not in item_by_id:
            errors.append(f"specに無いトレーサビリティ項目: {source_id}")
        coverage = entry.get("coverage")
        if coverage not in COVERAGE_STATES:
            errors.append(f"トレーサビリティ {source_id}: coverage が不正です: {coverage}")
        mapped = [str(v) for v in _as_list(entry.get("function_ids")) if str(v)]
        unknown = [fid for fid in mapped if fid not in function_by_id]
        if unknown:
            errors.append(f"トレーサビリティ {source_id}: 未定義の機能: {', '.join(unknown)}")
        if coverage == "covered" and not mapped and item_by_id.get(source_id, {}).get("type") != "success-criterion":
            errors.append(f"トレーサビリティ {source_id}: covered ですが機能がありません")
        if coverage == "covered" and item_by_id.get(source_id, {}).get("type") == "success-criterion":
            if not mapped and not str(entry.get("verification", "")).strip():
                errors.append(f"トレーサビリティ {source_id}: 成功基準の検証方法がありません")
        if coverage in {"partial", "unresolved"}:
            errors.append(f"トレーサビリティ {source_id}: {coverage} のまま確定版を生成できません")
        if coverage == "out-of-scope" and mapped:
            current = [fid for fid in mapped if function_by_id.get(fid, {}).get("status") == "current"]
            if current:
                errors.append(f"トレーサビリティ {source_id}: 対象外項目に現行機能が紐付いています")
        source_status = item_by_id.get(source_id, {}).get("source_status")
        if source_status == "future" and coverage != "future":
            errors.append(f"トレーサビリティ {source_id}: 将来要素はcoverage=futureにしてください")
        if source_status == "out-of-scope" and coverage != "out-of-scope":
            errors.append(f"トレーサビリティ {source_id}: 対象外要素はcoverage=out-of-scopeにしてください")
        if coverage == "future":
            current = [fid for fid in mapped if function_by_id.get(fid, {}).get("status") == "current"]
            if current:
                errors.append(f"トレーサビリティ {source_id}: 将来要素に現行機能が紐付いています")
        if source_status == "current" and coverage == "covered" and mapped:
            if not any(function_by_id.get(fid, {}).get("status") == "current" for fid in mapped):
                errors.append(f"トレーサビリティ {source_id}: 現行要素が将来機能だけに紐付いています")

    for source_id in item_by_id:
        if source_id not in trace_by_id:
            errors.append(f"規範要素が未追跡です: {source_id}")
    for fid, function in function_by_id.items():
        for source_id in _split_refs(function.get("source_refs")):
            if source_id in item_by_id and fid not in _as_list(trace_by_id.get(source_id, {}).get("function_ids")):
                errors.append(f"双方向参照が不一致です: {fid} → {source_id}")
    for source_id, entry in trace_by_id.items():
        for fid in _as_list(entry.get("function_ids")):
            if source_id not in _split_refs(function_by_id.get(fid, {}).get("source_refs")):
                errors.append(f"双方向参照が不一致です: {source_id} → {fid}")

    blocking_questions = [
        q
        for q in cfg.get("open_questions", []) or []
        if q.get("severity", "blocking") == "blocking" and q.get("status", "open") != "resolved"
    ]
    for question in cfg.get("open_questions", []) or []:
        if question.get("status") != "resolved":
            continue
        confirmation_id = str(question.get("confirmation_id", "")).upper()
        if confirmation_id not in decision_ids:
            errors.append(f"解決済み質問 {question.get('id', '(空)')}: 確認済み決定への参照がありません")
            continue
        affected = [str(fid) for fid in _as_list(question.get("function_ids") or question.get("function_id")) if str(fid)]
        for fid in affected:
            if confirmation_id not in _split_refs(function_by_id.get(fid, {}).get("source_refs")):
                errors.append(f"解決済み質問 {question.get('id', '(空)')}: {fid} が {confirmation_id} を参照していません")
    if blocking_questions:
        errors.append(f"ユーザー確認が必要な未解決事項が{len(blocking_questions)}件あります")

    report = _report(errors, warnings, items, traceability, functions)
    report["unresolved_count"] += len(blocking_questions)
    return cfg, report, items


def _fact_text(value):
    """Return a display value from either a v2 scalar or a v3 fact object."""
    if not isinstance(value, dict):
        return str(value or "").strip()
    for key in ("text", "name", "value", "description", "action", "id"):
        if str(value.get(key, "")).strip():
            return str(value[key]).strip()
    return ""


def _has_substantive_content(value):
    """Distinguish a design fact from an id/name plus provenance shell."""
    if isinstance(value, list):
        return any(_has_substantive_content(item) for item in value)
    if not isinstance(value, dict):
        return bool(str(value or "").strip())
    metadata = {
        "id",
        "name",
        "title",
        "type",
        "kind",
        "basis",
        "source_refs",
        "sources",
        "rationale",
        "confirmation",
        "confirmation_id",
        "status",
    }
    return any(
        key not in metadata and item not in (None, "", [], {}) and _has_substantive_content(item)
        for key, item in value.items()
    )


def _sync_requirement_decisions(cfg, items):
    """Reflect spec Clarifications as confirmed requirement decisions."""
    existing = {
        str(decision.get("id", "")).strip().upper(): copy.deepcopy(decision)
        for decision in cfg.get("requirement_decisions", []) or []
        if isinstance(decision, dict) and str(decision.get("id", "")).strip()
    }
    for item in items:
        if item.get("type") != "clarification":
            continue
        text = item.get("text", "")
        match = re.search(r"(?:^|\s)Q[:：]\s*(.*?)\s*(?:→|->|⇒)\s*A[:：]\s*(.+)$", text)
        question = match.group(1).strip() if match else text
        answer = match.group(2).strip() if match else text
        existing[item["id"]] = {
            **existing.get(item["id"], {}),
            "id": item["id"],
            "question": question,
            "answer": answer,
            "source_locator": item.get("locator", "spec.md > Clarifications"),
            "source_refs": [item["id"]],
        }
    cfg["requirement_decisions"] = list(existing.values())
    return cfg


def _reference_values(value):
    # v3 source_refs is an array whose individual entries are atomic locators.
    # A locator may legitimately contain spaces (for example
    # ``plan:System Context``), so applying the legacy whitespace splitter to
    # every array item corrupts one locator into several unknown references.
    # Keep scalar compatibility for the historical ``"FR-001, FR-002"`` form.
    is_collection = isinstance(value, (list, tuple, set))
    values = _as_list(value)
    refs = []
    for entry in values:
        if isinstance(entry, dict):
            entry = entry.get("id") or entry.get("ref") or entry.get("path") or ""
        text = str(entry or "").strip()
        if not text:
            continue
        if is_collection:
            refs.append(text)
        else:
            refs.extend(_split_refs(text))
    return refs


def _v3_compatibility_view(config):
    """Project v3 facts onto v2 fields so the proven v2 trace gate is reused."""
    cfg = copy.deepcopy(config)
    cfg["schema_version"] = LEGACY_SCHEMA_VERSION

    def compat_refs(value):
        refs = []
        for ref in _reference_values(value):
            normative = re.findall(r"(?:FR|SC|US|AC|EC|ASM|OOS|CL)-[A-Z0-9-]+", ref.upper())
            refs.extend(normative)
        return list(dict.fromkeys(refs))

    cfg["decisions"] = copy.deepcopy(cfg.get("requirement_decisions", []) or [])
    for entry in cfg.get("traceability", []) or []:
        if entry.get("verification_ids") and not entry.get("verification"):
            entry["verification"] = "v3 verification: " + ", ".join(
                str(value) for value in _as_list(entry.get("verification_ids"))
            )
    for interface in cfg.get("interfaces", []) or []:
        actors = interface.get("actors")
        if isinstance(actors, dict):
            interface["actors"] = [
                _fact_text(actor)
                for role_values in actors.values()
                for actor in _as_list(role_values)
                if _fact_text(actor)
            ]
    for _, _, _, function in flatten_functions(cfg):
        actors = function.get("actors")
        if isinstance(actors, dict):
            function["actors"] = [
                _fact_text(actor)
                for role_values in actors.values()
                for actor in _as_list(role_values)
                if _fact_text(actor)
            ]
        function["trigger"] = _fact_text(function.get("trigger"))
        function["source_refs"] = compat_refs(function.get("source_refs"))
        for key in ("inputs", "outputs", "preconditions", "postconditions", "data_entities"):
            function[key] = [_fact_text(item) for item in _as_list(function.get(key)) if _fact_text(item)]
        for rule in function.get("business_rules", []) or []:
            if isinstance(rule, dict):
                rule["source_refs"] = compat_refs(rule.get("source_refs"))
        for exception in function.get("exceptions", []) or []:
            if isinstance(exception, dict):
                exception["source_refs"] = compat_refs(exception.get("source_refs"))
    return cfg


def _artifact_type(value):
    aliases = {
        "data_model": "data-model",
        "datamodel": "data-model",
        "contract": "contracts",
        "openapi": "contracts",
        "quick-start": "quickstart",
        "source-code": "code",
    }
    normalized = str(value or "").strip().casefold().replace("_", "-")
    return aliases.get(normalized, normalized)


def _validate_artifacts(spec_text, cfg, feature_dir, errors, warnings):
    source = cfg.get("source") or {}
    artifacts = source.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        errors.append("source.artifacts に入力成果物がありません")
        return [], set(), set()

    normalized = []
    types = set()
    reference_roots = set()
    seen_paths = set()
    root = Path(feature_dir) if feature_dir else None
    for index, artifact in enumerate(artifacts, 1):
        label = f"source.artifacts[{index}]"
        if not isinstance(artifact, dict):
            errors.append(f"{label}: オブジェクトで指定してください")
            continue
        kind = _artifact_type(artifact.get("type") or artifact.get("kind"))
        path = str(artifact.get("path") or artifact.get("file") or "").strip()
        if kind not in ARTIFACT_TYPES:
            errors.append(f"{label}: type が不正です: {kind or '(空)'}")
        if not path:
            errors.append(f"{label}: path が空です")
        elif path in seen_paths:
            errors.append(f"{label}: path が重複しています: {path}")
        seen_paths.add(path)
        locator = artifact.get("sections") or artifact.get("headings") or artifact.get("locator")
        if not locator:
            errors.append(f"{label}: 参照見出し(sections/locator)がありません")
        fingerprint = str(artifact.get("fingerprint", "")).strip()
        if not fingerprint:
            errors.append(f"{label}: fingerprint がありません")
        elif not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
            errors.append(f"{label}: fingerprintは64桁の小文字SHA-256で指定してください")
        artifact_id = str(artifact.get("id", "")).strip()
        reference_roots.update(v.upper() for v in (artifact_id, path, kind) if v)
        if kind == "contracts":
            reference_roots.add("CONTRACT")
        types.add(kind)
        normalized.append({**artifact, "type": kind, "path": path})

        candidate = None
        if root is not None and path:
            raw_path = Path(path)
            if raw_path.is_absolute():
                errors.append(f"{label}: pathはfeature directoryからの相対pathにしてください: {path}")
            candidate = raw_path if raw_path.is_absolute() else root / raw_path
            try:
                candidate.resolve().relative_to(root.resolve())
            except ValueError:
                errors.append(f"{label}: pathがfeature directory外を参照しています: {path}")
            if not candidate.exists():
                errors.append(f"{label}: feature directory内に存在しません: {path}")
            elif not candidate.is_file():
                errors.append(f"{label}: source artifactはファイル単位で指定してください: {path}")
        if kind == "spec" and fingerprint:
            expected = fingerprint
            raw = candidate.read_bytes() if candidate is not None and candidate.is_file() else spec_text.encode("utf-8")
            actual = hashlib.sha256(raw).hexdigest()
            if re.fullmatch(r"[0-9a-f]{64}", expected) and expected != actual:
                errors.append(f"{label}: spec.md のfingerprintが一致しません")
            if candidate is not None and candidate.is_file():
                canonical_text = candidate.read_text(encoding="utf-8")
                if canonical_text != spec_text:
                    errors.append(
                        f"{label}: 検証に渡されたspec内容がsource.artifactsの正本と一致しません"
                    )
        elif candidate is not None and candidate.is_file() and fingerprint:
            expected = fingerprint
            actual = hashlib.sha256(candidate.read_bytes()).hexdigest()
            if re.fullmatch(r"[0-9a-f]{64}", expected) and expected != actual:
                errors.append(f"{label}: fingerprintが一致しません: {path}")

    spec_count = sum(1 for artifact in normalized if artifact.get("type") == "spec")
    if spec_count == 0:
        errors.append("source.artifacts に type=spec がありません")
    elif spec_count != 1:
        errors.append(f"source.artifacts のtype=specは1件だけ必要です: {spec_count}件")
    return normalized, types, reference_roots


def _task_progress_from_artifacts(artifacts, feature_dir):
    """Read only Markdown checkbox counts from the declared tasks artifact."""
    if feature_dir is None:
        return None
    root = Path(feature_dir).resolve()
    for artifact in artifacts:
        if _artifact_type(artifact.get("type")) != "tasks":
            continue
        raw_path = Path(str(artifact.get("path", "")))
        if raw_path.is_absolute():
            return None
        path = (root / raw_path).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            return None
        if not path.is_file():
            return None
        matches = []
        excluded_section = False
        for line in path.read_text(encoding="utf-8").splitlines():
            heading = re.match(r"^\s*#{2,6}\s+(.+?)\s*$", line)
            if heading:
                excluded_section = bool(
                    re.search(
                        r"\b(?:deferred|future|out[ -]of[ -]scope)\b|延期|将来|対象外",
                        heading.group(1),
                        re.I,
                    )
                )
                continue
            task = re.match(r"^\s*[-*]\s+\[([ xX])\]\s+(.+)$", line)
            if task and not excluded_section and "[future]" not in task.group(2).casefold():
                matches.append(task.group(1))
        return {
            "completed": sum(1 for marker in matches if marker.casefold() == "x"),
            "total": len(matches),
        }
    return None


def _artifact_aliases(artifact):
    path = Path(str(artifact.get("path", "")))
    kind = _artifact_type(artifact.get("type"))
    aliases = {
        str(artifact.get("id", "")),
        kind,
        str(path).replace("\\", "/"),
        path.name,
        path.stem,
    }
    if kind == "contracts":
        aliases.update({"contract", "contracts"})
    return {alias.strip().upper() for alias in aliases if alias and alias.strip()}


def _artifact_ref_parts(ref, artifacts):
    text = str(ref or "").strip()
    if not text:
        return None
    candidates = []
    for artifact in artifacts:
        for alias in _artifact_aliases(artifact):
            for separator in ("#", ":", ">", " /"):
                prefix = alias + separator
                if text.upper().startswith(prefix):
                    candidates.append((len(alias), artifact, text[len(alias):]))
            if text.upper() == alias:
                candidates.append((len(alias), artifact, ""))
    if not candidates:
        return None
    _, artifact, locator = max(candidates, key=lambda item: item[0])
    locator = locator.strip()
    if locator.startswith(("#", ":", ">")):
        locator = locator[1:].strip()
    elif locator.startswith("/") and not locator.startswith("//"):
        locator = locator[1:].strip()
    artifact_path = str(artifact.get("path", "")).replace("\\", "/")
    for prefix in (artifact_path, Path(artifact_path).name):
        if prefix and locator.casefold().startswith(prefix.casefold()):
            locator = locator[len(prefix):].strip()
            if locator.startswith("#"):
                locator = locator[1:]
            break
    return artifact, locator.strip()


def _json_pointer_exists(document, pointer):
    if pointer in ("", "/"):
        return True
    if not pointer.startswith("/"):
        return False
    current = document
    for raw_token in pointer[1:].split("/"):
        token = raw_token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and token in current:
            current = current[token]
        elif isinstance(current, list) and token.isdigit() and int(token) < len(current):
            current = current[int(token)]
        else:
            return False
    return True


def _yaml_mapping_paths(text):
    """Extract mapping-key paths needed to resolve OpenAPI JSON Pointers."""
    paths = set()
    stack = []
    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith(("#", "- ")):
            continue
        # Values after a colon are allowed; only the key and indentation matter.
        candidate = re.match(r"^(\s*)(?:\"([^\"]+)\"|'([^']+)'|([^:#][^:]*?)):\s*.*$", raw_line)
        if not candidate:
            continue
        indent = len(candidate.group(1).replace("\t", "    "))
        key = next((value for value in candidate.groups()[1:] if value is not None), "").strip()
        if not key or key.startswith("-"):
            continue
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, key))
        paths.add(tuple(item[1] for item in stack))
    return paths


def _yaml_pointer_exists(text, pointer):
    if pointer in ("", "/"):
        return True
    if not pointer.startswith("/"):
        return False
    tokens = tuple(
        token.replace("~1", "/").replace("~0", "~")
        for token in pointer[1:].split("/")
    )
    return tokens in _yaml_mapping_paths(text)


def _source_locator_exists(path, artifact, locator):
    if not locator or locator in {"*", "文書全体", "全体"}:
        return True
    if locator.casefold() in {
        str(artifact.get("path", "")).casefold(),
        path.name.casefold(),
    }:
        return True
    text = path.read_text(encoding="utf-8")
    kind = _artifact_type(artifact.get("type"))
    if kind == "contracts" and locator.startswith("/"):
        try:
            return _json_pointer_exists(json.loads(text), locator)
        except json.JSONDecodeError:
            return _yaml_pointer_exists(text, locator)
    normalized_locator = " ".join(locator.casefold().split())
    normalized_text = " ".join(text.casefold().split())
    return normalized_locator in normalized_text


def _validate_source_locators(cfg, artifacts, feature_dir, errors):
    if feature_dir is None:
        return
    root = Path(feature_dir).resolve()
    checked = set()
    for ref in _nested_source_refs(cfg):
        parts = _artifact_ref_parts(ref, artifacts)
        if parts is None:
            continue
        artifact, locator = parts
        identity = (str(artifact.get("path", "")), locator)
        if identity in checked:
            continue
        checked.add(identity)
        path = (root / Path(str(artifact.get("path", "")))).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            continue
        if path.is_file() and not _source_locator_exists(path, artifact, locator):
            errors.append(
                f"source_refのlocatorが正本に存在しません: {ref} ({artifact.get('path')})"
            )


def _known_source_ref(ref, valid_source_ids, artifact_roots):
    normalized = str(ref or "").strip().upper()
    if not normalized:
        return False
    if normalized in valid_source_ids or any(
        normalized.endswith(":" + source_id) for source_id in valid_source_ids if source_id
    ):
        return True
    return any(
        normalized == root
        or normalized.startswith(root + "#")
        or normalized.startswith(root + ":")
        or normalized.startswith(root + ">")
        or normalized.startswith(root + " /")
        for root in artifact_roots
        if root
    )


def _references_artifact(record, artifact_names):
    """Return whether a fact cites one of the requested artifact namespaces."""
    names = {str(name).strip().upper() for name in artifact_names if str(name).strip()}
    for ref in _nested_source_refs(record):
        normalized = str(ref).strip().upper()
        if any(
            normalized == name
            or normalized.startswith(name + ":")
            or normalized.startswith(name + "#")
            or normalized.startswith(name + ">")
            or normalized.startswith(name + " /")
            for name in names
        ):
            return True
    return False


def _validate_provenance(record, label, valid_source_ids, artifact_roots, decision_ids, errors):
    if not isinstance(record, dict):
        errors.append(f"{label}: factはオブジェクトで指定してください")
        return
    basis = record.get("basis")
    if basis not in RULE_BASES:
        errors.append(f"{label}: basis が不正です: {basis}")
    refs = _reference_values(record.get("source_refs"))
    if not refs:
        errors.append(f"{label}: source_refs がありません")
    unknown = [ref for ref in refs if not _known_source_ref(ref, valid_source_ids, artifact_roots)]
    if unknown:
        errors.append(f"{label}: 未定義のsource_refsがあります: {', '.join(unknown)}")
    if basis == "derived" and not str(record.get("rationale", "")).strip():
        errors.append(f"{label}: derived factにrationaleがありません")
    if basis == "confirmed":
        confirmation = record.get("confirmation") or record.get("confirmation_id")
        confirmation_id = str(
            confirmation.get("id", "") if isinstance(confirmation, dict) else confirmation or ""
        ).strip().upper()
        if not confirmation_id:
            errors.append(f"{label}: confirmed factにconfirmationがありません")
        elif confirmation_id not in decision_ids:
            errors.append(f"{label}: confirmationが確認済み決定を参照していません: {confirmation_id}")
        if confirmation_id and confirmation_id not in refs:
            errors.append(f"{label}: confirmationがsource_refsに含まれていません: {confirmation_id}")


def _section_items(cfg, key):
    value = cfg.get(key, [])
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for item_key in ("items", "models", "records", key):
            if isinstance(value.get(item_key), list):
                return value[item_key]
    return []


def _normalize_applicability_status(value):
    value = str(value or "").strip().casefold().replace("_", "-")
    aliases = {"notapplicable": "not-applicable", "not-evaluated-yet": "not-evaluated"}
    return aliases.get(value, value)


def _applicability(cfg, key, items):
    entry = (cfg.get("applicability") or {}).get(key)
    singular = key.removesuffix("s")
    entry = entry or cfg.get(f"{singular}_applicability") or cfg.get(f"{key}_applicability")
    section = cfg.get(key)
    if not entry and isinstance(section, dict):
        entry = section.get("applicability") or section.get("not_applicable")
        if entry and "status" not in entry and "not_applicable" in section:
            entry = {**entry, "status": "not-applicable"}
    entry = copy.deepcopy(entry) if isinstance(entry, dict) else {}
    if not entry:
        for alias in (f"{singular}_not_applicable", f"{key}_not_applicable"):
            if isinstance(cfg.get(alias), dict):
                entry = {**cfg[alias], "status": "not-applicable"}
                break
    if not entry and items:
        entry = {"status": "required"}
    entry["status"] = _normalize_applicability_status(entry.get("status") or "not-evaluated")
    return entry


def _state_requirement_present(items):
    known_business_states = re.compile(
        r"受付済|処理中|配送(?:待ち|中|済)|承認(?:待ち|済)|却下|完了済|失敗(?:済)?|"
        r"取消(?:済|不可|要求)|キャンセル(?:済|不可|要求)",
        re.I,
    )
    lifecycle_language = re.compile(
        r"遷移|状態(?:管理|機械|モデル)|ライフサイクル|state\s+(?:machine|transition)|lifecycle|"
        r"(?:状態|ステータス).{0,24}(?:変更|更新|保持|操作|許可|禁止|可否|依存|のみ|から|へ)|"
        r"(?:変更|更新|操作|許可|禁止|可否).{0,24}(?:状態|ステータス)",
        re.I,
    )
    transport_status = re.compile(
        r"HTTP\s*(?:status|ステータス|状態)?\s*(?:code|コード)|"
        r"(?:response|レスポンス)(?:の)?\s*(?:status|ステータス|状態)\s*(?:code|コード)|"
        r"\bstatus\s+code\b",
        re.I,
    )
    for item in items:
        if item.get("type") not in {"functional-requirement", "acceptance-scenario", "edge-case"}:
            continue
        text = transport_status.sub("", item.get("text", ""))
        if known_business_states.search(text) or lifecycle_language.search(text):
            return True
    return False


def _workflow_requirement_present(items, functions):
    pattern = re.compile(r"外部|連携|通知|非同期|イベント|再送|リトライ|バッチ|順序|ワークフロー", re.I)
    if any(pattern.search(item.get("text", "")) for item in items):
        return True
    boundaries = {
        (function.get("execution") or {}).get("type")
        for _, _, _, function in functions
        if (function.get("execution") or {}).get("type")
    }
    return len(boundaries - {"screen", "manual", "cross-cutting"}) >= 2


def _validate_applicability(
    cfg,
    key,
    items,
    inferred_required,
    valid_source_ids,
    artifact_roots,
    decision_ids,
    errors,
):
    entry = _applicability(cfg, key, items)
    status = entry.get("status")
    label = "処理フロー" if key == "workflows" else "状態遷移"
    if status not in APPLICABILITY_STATES:
        errors.append(f"{label}のapplicability.statusが不正です: {status}")
    elif status == "not-evaluated":
        errors.append(f"{label}の必要性が未評価です")
    elif status == "required" and not items:
        errors.append(f"{label}が必要ですが構造データがありません")
    elif status == "not-applicable":
        if not str(entry.get("rationale", "")).strip():
            errors.append(f"{label}をnot-applicableとするrationaleがありません")
        _validate_provenance(entry, f"{label}のnot-applicable判断", valid_source_ids, artifact_roots, decision_ids, errors)
        if inferred_required:
            errors.append(f"specの内容から{label}が必要ですがnot-applicableになっています")
    return entry


def _validate_v3_functions(
    cfg,
    valid_source_ids,
    artifact_roots,
    decision_ids,
    errors,
    implementation_errors=None,
    implementation_ready=False,
):
    """Check the provenance-bearing function facts introduced by v3."""
    for _, _, _, function in flatten_functions(cfg):
        label = str(function.get("id") or function.get("name") or "(名称なし)")
        priority = function.get("priority")
        if priority not in (None, ""):
            if not isinstance(priority, dict):
                errors.append(f"機能 {label}: priorityは根拠付きobjectで指定してください")
            else:
                priority_value = str(priority.get("value", "")).upper()
                if priority_value not in {"P0", "P1", "P2", "P3", "P4", "UNSPECIFIED"}:
                    errors.append(f"機能 {label}: priority.valueが不正です: {priority_value or '(空)'}")
                _validate_provenance(
                    priority,
                    f"機能 {label}のpriority",
                    valid_source_ids,
                    artifact_roots,
                    decision_ids,
                    errors,
                )
        actors = function.get("actors")
        if not isinstance(actors, dict):
            errors.append(f"機能 {label}: actorsをinitiators/processors/recipients/operatorsへ分離してください")
        else:
            role_keys = ("initiators", "processors", "recipients", "operators")
            missing = [key for key in role_keys if key not in actors or not isinstance(actors.get(key), list)]
            if missing:
                errors.append(f"機能 {label}: actor roleが不足しています: {', '.join(missing)}")
            if not any(_fact_text(actor) for actor in _as_list(actors.get("initiators"))):
                errors.append(f"機能 {label}: initiatorsが空です")
            if not any(_fact_text(actor) for actor in _as_list(actors.get("processors"))):
                errors.append(f"機能 {label}: processorsが空です")

        trigger = function.get("trigger")
        _validate_provenance(trigger, f"機能 {label}の起動契機", valid_source_ids, artifact_roots, decision_ids, errors)
        if not _fact_text(trigger):
            errors.append(f"機能 {label}: 起動契機のtextが空です")
        for key, display in (
            ("inputs", "入力"),
            ("outputs", "出力"),
            ("preconditions", "事前条件"),
            ("postconditions", "事後条件"),
        ):
            for index, fact in enumerate(_as_list(function.get(key)), 1):
                _validate_provenance(
                    fact,
                    f"機能 {label}の{display}{index}",
                    valid_source_ids,
                    artifact_roots,
                    decision_ids,
                    errors,
                )
                if not _fact_text(fact):
                    errors.append(f"機能 {label}の{display}{index}: text/nameが空です")
                if key in {"inputs", "outputs"}:
                    fact_type = str(fact.get("type", "")).strip() if isinstance(fact, dict) else ""
                    has_required = isinstance(fact, dict) and isinstance(fact.get("required"), bool)
                    if not fact_type:
                        message = f"機能 {label}の{display}{index}: typeが空です"
                        errors.append(message)
                        if implementation_ready and implementation_errors is not None:
                            implementation_errors.append(message)
                    elif implementation_ready and _is_unresolved_value(fact_type):
                        implementation_errors.append(
                            f"機能 {label}の{display}{index}: implementation-readyではtypeを確定してください"
                        )
                    if not has_required:
                        message = f"機能 {label}の{display}{index}: requiredをbooleanで指定してください"
                        errors.append(message)
                        if implementation_ready and implementation_errors is not None:
                            implementation_errors.append(message)
        for index, entity_ref in enumerate(_as_list(function.get("data_entities")), 1):
            if isinstance(entity_ref, dict):
                _validate_provenance(
                    entity_ref,
                    f"機能 {label}の対象データ{index}",
                    valid_source_ids,
                    artifact_roots,
                    decision_ids,
                    errors,
                )
            if not _fact_text(entity_ref):
                errors.append(f"機能 {label}の対象データ{index}: entity参照が空です")
        for index, rule in enumerate(_as_list(function.get("business_rules")), 1):
            _validate_provenance(
                rule,
                f"機能 {label}の業務ルール{index}",
                valid_source_ids,
                artifact_roots,
                decision_ids,
                errors,
            )
        for index, exception in enumerate(_as_list(function.get("exceptions")), 1):
            _validate_provenance(
                exception,
                f"機能 {label}の例外{index}",
                valid_source_ids,
                artifact_roots,
                decision_ids,
                errors,
            )


def _design_record_registry(cfg):
    """Index every addressable design record for trace and clarification checks."""
    records = {}

    def register(prefix, record, aliases=()):
        if not isinstance(record, dict) or not record.get("id"):
            return
        record_id = str(record["id"]).strip().upper()
        for key in (record_id, f"{prefix}:{record_id}", *(f"{alias}:{record_id}" for alias in aliases)):
            records[key.upper()] = record

    for _, _, _, record in flatten_functions(cfg):
        register("function", record, ("fnc",))
    for record in _section_items(cfg, "workflows"):
        register("workflow", record)
    for record in _section_items(cfg, "state_models"):
        register("state-model", record, ("state",))
    for record in _section_items(cfg, "entities"):
        register("entity", record)
    for record in cfg.get("interfaces", []) or []:
        register("interface", record)
    for record in _section_items(cfg, "quality_scenarios"):
        register("quality-scenario", record, ("quality",))
    for record in _section_items(cfg, "risks"):
        register("risk", record)
    for record in _section_items(cfg, "verification"):
        register("verification", record)
    architecture = cfg.get("architecture") or {}
    if isinstance(architecture, dict):
        for view_key in (
            "context",
            "system_context",
            "containers",
            "container",
            "components",
            "component",
            "code",
            "decisions",
        ):
            for record in _architecture_records(architecture.get(view_key)):
                register("architecture", record)
    return records


def _validate_v3_questions(cfg, valid_source_ids, artifact_roots, decision_ids, errors):
    seen = set()
    design_records = _design_record_registry(cfg)
    allowed_return_to = {"/speckit.clarify", "/speckit.plan", "/speckit.analyze"}
    for index, question in enumerate(cfg.get("open_questions", []) or [], 1):
        label = f"open_questions[{index}]"
        if not isinstance(question, dict):
            errors.append(f"{label}: オブジェクトで指定してください")
            continue
        question_id = str(question.get("id", "")).strip()
        if not question_id or question_id in seen:
            errors.append(f"{label}: idが空または重複しています")
        seen.add(question_id)
        refs = _reference_values(question.get("source_refs"))
        if not refs:
            errors.append(f"{label}: source_refsがありません")
        unknown = [ref for ref in refs if not _known_source_ref(ref, valid_source_ids, artifact_roots)]
        if unknown:
            errors.append(f"{label}: 未定義source_refs: {', '.join(unknown)}")
        affected = _as_list(
            question.get("affected_refs")
            or question.get("function_ids")
            or question.get("function_id")
            or question.get("design_refs")
        )
        affected_values = [
            str(value.get("id") or value.get("ref") or "") if isinstance(value, dict) else str(value)
            for value in affected
        ]
        if not any(str(value).strip() for value in affected):
            errors.append(f"{label}: affected_refsがありません")
        else:
            unknown_affected = [
                value
                for value in affected_values
                if value.strip()
                and value.strip().upper() not in design_records
                and not _known_source_ref(value, valid_source_ids, artifact_roots)
            ]
            if unknown_affected:
                errors.append(f"{label}: 未定義affected_refs: {', '.join(unknown_affected)}")
        return_to = str(question.get("return_to", "")).strip()
        if return_to not in allowed_return_to:
            errors.append(f"{label}: return_toが不正です: {return_to or '(空)'}")
        if question.get("status") == "resolved":
            confirmation = str(question.get("confirmation") or question.get("confirmation_id") or "").upper()
            if confirmation not in decision_ids:
                errors.append(f"{label}: resolvedですが有効なconfirmationがありません")
            else:
                for affected_ref in affected_values:
                    target = design_records.get(affected_ref.strip().upper())
                    if target is None:
                        errors.append(f"{label}: resolved対象のdesign recordが見つかりません: {affected_ref}")
                        continue
                    target_refs = {ref.upper() for ref in _nested_source_refs(target)}
                    if confirmation not in target_refs:
                        errors.append(
                            f"{label}: {affected_ref} が確認済み決定 {confirmation} を参照していません"
                        )


def _validate_workflows(cfg, workflows, function_ids, interface_ids, source_context, errors):
    valid_source_ids, artifact_roots, decision_ids = source_context
    seen = set()
    for index, workflow in enumerate(workflows, 1):
        label = f"workflow[{index}]"
        if not isinstance(workflow, dict):
            errors.append(f"{label}: オブジェクトで指定してください")
            continue
        wid = str(workflow.get("id", "")).strip()
        if not wid or wid in seen:
            errors.append(f"{label}: idが空または重複しています: {wid or '(空)'}")
        seen.add(wid)
        if not str(workflow.get("name", "")).strip():
            errors.append(f"{label}: nameが空です")
        workflow_type = str(workflow.get("type", "")).casefold()
        if workflow_type not in {"activity", "sequence"}:
            errors.append(f"{label}: typeが不正です: {workflow_type or '(空)'}")
        _validate_provenance(workflow, label, valid_source_ids, artifact_roots, decision_ids, errors)
        participants = workflow.get("participants")
        if not isinstance(participants, list) or len(participants) < 2:
            errors.append(f"{label}: participantsは役割付きで2件以上必要です")
            participants = []
        participant_ids = set()
        allowed_roles = {
            "initiator",
            "processor",
            "recipient",
            "operator",
            "external-system",
            "data-store",
        }
        for participant_index, participant in enumerate(participants, 1):
            participant_label = f"{label}.participants[{participant_index}]"
            if not isinstance(participant, dict):
                errors.append(f"{participant_label}: provenance付きobjectで指定してください")
                continue
            participant_id = str(participant.get("id", "")).strip()
            participant_name = str(participant.get("name", "")).strip()
            participant_role = str(participant.get("role", "")).strip()
            if not participant_id or participant_id in participant_ids:
                errors.append(f"{participant_label}: idが空または重複しています")
            participant_ids.add(participant_id)
            if not participant_name:
                errors.append(f"{participant_label}: nameが空です")
            if participant_role not in allowed_roles:
                errors.append(
                    f"{participant_label}: roleが不正です: {participant_role or '(空)'}"
                )
            _validate_provenance(
                participant, participant_label, valid_source_ids, artifact_roots, decision_ids, errors
            )
        steps = workflow.get("steps")
        if not isinstance(steps, list) or len(steps) < 2:
            errors.append(f"{label}: stepsは2件以上必要です")
            steps = []
        step_ids = {
            str(step.get("id", "")).strip()
            for step in steps
            if isinstance(step, dict) and str(step.get("id", "")).strip()
        }
        if len(step_ids) != len(steps):
            errors.append(f"{label}: step idが空または重複しています")
        for step_index, step in enumerate(steps, 1):
            step_label = f"{label}.steps[{step_index}]"
            if not isinstance(step, dict):
                errors.append(f"{step_label}: オブジェクトで指定してください")
                continue
            step_action = _fact_text(
                step.get("action") or step.get("message") or step.get("text") or step.get("description")
            )
            if not step_action:
                errors.append(f"{step_label}: actionが空です")
            elif _is_unresolved_value(step_action):
                errors.append(f"{step_label}: actionが未確定です")
            step_status = str(step.get("status", "normal")).casefold()
            if step_status not in {"normal", "exception", "recovery"}:
                errors.append(f"{step_label}: statusが不正です: {step_status or '(空)'}")
            actor = str(step.get("actor") or step.get("from") or "").strip()
            if not actor:
                errors.append(f"{step_label}: actorまたはfromが空です")
            if workflow_type == "sequence":
                for endpoint in ("from", "to"):
                    if not str(step.get(endpoint, "")).strip():
                        errors.append(f"{step_label}: sequenceでは{endpoint}が必須です")
            for endpoint in ("from", "to"):
                participant = str(step.get(endpoint, "")).strip()
                if participant and participant not in participant_ids:
                    errors.append(f"{step_label}: {endpoint}がparticipantsを参照していません: {participant}")
            next_values = _as_list(step.get("next") or step.get("next_step_id"))
            for next_value in next_values:
                next_step = str(
                    next_value.get("id") or next_value.get("step_id") or next_value.get("next") or ""
                    if isinstance(next_value, dict)
                    else next_value
                ).strip()
                if next_step and next_step not in step_ids:
                    errors.append(f"{step_label}: nextが未定義stepを参照しています: {next_step}")
            _validate_provenance(step, step_label, valid_source_ids, artifact_roots, decision_ids, errors)
            unknown_functions = [
                value for value in _as_list(step.get("function_ids") or step.get("function_id"))
                if str(value) not in function_ids
            ]
            if unknown_functions:
                errors.append(f"{step_label}: 未定義の機能参照: {', '.join(map(str, unknown_functions))}")
            unknown_interfaces = [
                value for value in _as_list(step.get("interface_refs") or step.get("interface_ids"))
                if str(value) not in interface_ids
            ]
            if unknown_interfaces:
                errors.append(f"{step_label}: 未定義のinterface参照: {', '.join(map(str, unknown_interfaces))}")


def _validate_state_models(cfg, state_models, entity_ids, source_context, errors, require_policy=False):
    valid_source_ids, artifact_roots, decision_ids = source_context
    seen = set()
    for index, model in enumerate(state_models, 1):
        label = f"state_models[{index}]"
        if not isinstance(model, dict):
            errors.append(f"{label}: オブジェクトで指定してください")
            continue
        mid = str(model.get("id", "")).strip()
        if not mid or mid in seen:
            errors.append(f"{label}: idが空または重複しています: {mid or '(空)'}")
        seen.add(mid)
        entity = str(model.get("entity") or model.get("entity_id") or "").strip()
        if not entity:
            errors.append(f"{label}: entityが空です")
        elif entity_ids and entity not in entity_ids:
            errors.append(f"{label}: 未定義のentityを参照しています: {entity}")
        _validate_provenance(model, label, valid_source_ids, artifact_roots, decision_ids, errors)
        states = model.get("states")
        if not isinstance(states, list) or len(states) < 2:
            errors.append(f"{label}: statesは2件以上必要です")
            states = []
        state_ids = set()
        flagged_initial = []
        flagged_terminal = []
        for state_index, state in enumerate(states, 1):
            state_label = f"{label}.states[{state_index}]"
            if not isinstance(state, dict):
                errors.append(f"{state_label}: 状態はprovenance付きobjectで指定してください")
                continue
            state_id = str(state.get("id") or state.get("name") or "").strip()
            if not state_id or state_id in state_ids:
                errors.append(f"{state_label}: id/nameが空または重複しています")
            state_ids.add(state_id)
            if state.get("initial"):
                flagged_initial.append(state_id)
            if state.get("terminal"):
                flagged_terminal.append(state_id)
            _validate_provenance(state, state_label, valid_source_ids, artifact_roots, decision_ids, errors)
        initial = str(model.get("initial_state") or (flagged_initial[0] if len(flagged_initial) == 1 else "")).strip()
        terminal = {
            str(value)
            for value in (_as_list(model.get("terminal_states")) or flagged_terminal)
            if str(value)
        }
        if len(flagged_initial) > 1:
            errors.append(f"{label}: initial=trueの状態は1件だけにしてください")
        if initial not in state_ids:
            errors.append(f"{label}: initial_stateがstatesを参照していません: {initial or '(空)'}")
        if not terminal or not terminal <= state_ids:
            errors.append(f"{label}: terminal_statesが空またはstates外です")
        transitions = model.get("transitions")
        if not isinstance(transitions, list) or not transitions:
            errors.append(f"{label}: transitionsがありません")
            transitions = []
        incoming = Counter()
        outgoing = Counter()
        adjacency = {state_id: set() for state_id in state_ids}
        seen_transitions = set()
        for transition_index, transition in enumerate(transitions, 1):
            transition_label = f"{label}.transitions[{transition_index}]"
            if not isinstance(transition, dict):
                errors.append(f"{transition_label}: オブジェクトで指定してください")
                continue
            from_state = str(transition.get("from", "")).strip()
            to_state = str(transition.get("to", "")).strip()
            if from_state not in state_ids or to_state not in state_ids:
                errors.append(f"{transition_label}: from/toがstatesを参照していません")
            trigger = _fact_text(transition.get("trigger")).strip()
            if not trigger:
                errors.append(f"{transition_label}: triggerが空です")
            elif _is_unresolved_value(trigger):
                errors.append(f"{transition_label}: triggerが未確定です")
            condition = _fact_text(transition.get("condition")).strip()
            if not condition:
                errors.append(f"{transition_label}: conditionが空です（無条件ならその旨を明記してください）")
            elif _is_unresolved_value(condition):
                errors.append(f"{transition_label}: conditionが未確定です")
            action = _fact_text(transition.get("action")).strip()
            if not action:
                errors.append(f"{transition_label}: actionが空です（副作用なしならその旨を明記してください）")
            elif _is_unresolved_value(action):
                errors.append(f"{transition_label}: actionが未確定です")
            _validate_provenance(
                transition, transition_label, valid_source_ids, artifact_roots, decision_ids, errors
            )
            outgoing[from_state] += 1
            incoming[to_state] += 1
            if from_state in state_ids and to_state in state_ids:
                adjacency[from_state].add(to_state)
                transition_key = (from_state, to_state, trigger)
                if transition_key in seen_transitions:
                    errors.append(f"{transition_label}: 同一のfrom/to/triggerが重複しています")
                seen_transitions.add(transition_key)
                if from_state in terminal:
                    errors.append(f"{transition_label}: 終端状態 {from_state} から遷移しています")
        for state_id in state_ids - terminal:
            if not outgoing[state_id]:
                errors.append(f"{label}: 非終端状態 {state_id} からの遷移がありません")
        for state_id in state_ids - {initial}:
            if not incoming[state_id]:
                errors.append(f"{label}: 状態 {state_id} への遷移がありません")
        if initial in state_ids:
            reachable = {initial}
            pending = [initial]
            while pending:
                current = pending.pop()
                for target in adjacency.get(current, set()):
                    if target not in reachable:
                        reachable.add(target)
                        pending.append(target)
            unreachable = sorted(state_ids - reachable)
            if unreachable:
                errors.append(
                    f"{label}: 初期状態 {initial} から到達できない状態があります: "
                    + ", ".join(unreachable)
                )
        if require_policy and not str(
            model.get("unlisted_transitions") or model.get("undefined_transition_policy") or ""
        ).strip():
            errors.append(f"{label}: 未定義・禁止遷移の扱い(unlisted_transitions)がありません")


def _validate_entities(cfg, entities, source_context, errors):
    valid_source_ids, artifact_roots, decision_ids = source_context
    ids = set()
    names = set()
    declared_targets = {
        str(value).strip()
        for entity in entities
        if isinstance(entity, dict)
        for value in (entity.get("id"), entity.get("name"))
        if str(value or "").strip()
    }
    for index, entity in enumerate(entities, 1):
        label = f"entities[{index}]"
        if not isinstance(entity, dict):
            errors.append(f"{label}: オブジェクトで指定してください")
            continue
        entity_id = str(entity.get("id", "")).strip()
        name = str(entity.get("name", "")).strip()
        if not entity_id or entity_id in ids:
            errors.append(f"{label}: idが空または重複しています: {entity_id or '(空)'}")
        if not name or name in names:
            errors.append(f"{label}: nameが空または重複しています: {name or '(空)'}")
        ids.add(entity_id)
        names.add(name)
        _validate_provenance(entity, label, valid_source_ids, artifact_roots, decision_ids, errors)
        collections = {
            "attributes": entity.get("attributes", entity.get("fields", [])),
            "constraints": entity.get("constraints", []),
            "relationships": entity.get("relationships", []),
        }
        attribute_names = set()
        for key, values in collections.items():
            if not isinstance(values, list):
                errors.append(f"{label}.{key}: 配列で指定してください")
                continue
            for fact_index, fact in enumerate(values, 1):
                fact_label = f"{label}.{key}[{fact_index}]"
                _validate_provenance(fact, fact_label, valid_source_ids, artifact_roots, decision_ids, errors)
                if not _fact_text(fact):
                    errors.append(f"{fact_label}: name/textが空です")
                if key == "attributes" and isinstance(fact, dict):
                    attribute_name = str(fact.get("name", "")).strip()
                    if attribute_name in attribute_names:
                        errors.append(f"{fact_label}: attribute nameが重複しています: {attribute_name}")
                    if attribute_name:
                        attribute_names.add(attribute_name)
                if key == "relationships" and isinstance(fact, dict):
                    target = str(fact.get("to") or fact.get("target") or fact.get("entity_id") or "").strip()
                    if not target:
                        errors.append(f"{fact_label}: to/targetが空です")
                    elif target not in declared_targets:
                        errors.append(f"{fact_label}: 未定義entityを参照しています: {target}")
                    relation_type = str(fact.get("type", "")).casefold()
                    if relation_type not in {"one-to-one", "one-to-many", "many-to-many", "reference"}:
                        errors.append(
                            f"{fact_label}: relationship typeが不正です: {relation_type or '(空)'}"
                        )
    return ids | names


def _validate_implementation_entity_types(entities, errors):
    """Require programmer-facing attribute contracts without re-running logical checks."""
    for index, entity in enumerate(entities, 1):
        if not isinstance(entity, dict):
            continue
        label = f"entities[{index}]"
        attributes = entity.get("attributes", entity.get("fields", []))
        if not isinstance(attributes, list) or not attributes:
            errors.append(f"{label}: implementation-readyにはattributesが1件以上必要です")
            continue
        for attribute_index, attribute in enumerate(attributes, 1):
            if not isinstance(attribute, dict):
                errors.append(
                    f"{label}.attributes[{attribute_index}]: implementation-readyでは型付きobjectが必要です"
                )
                continue
            attribute_label = f"{label}.attributes[{attribute_index}]"
            attribute_type = str(attribute.get("type", "")).strip()
            if not attribute_type:
                errors.append(f"{attribute_label}: implementation-readyにはtypeが必要です")
            elif _is_unresolved_value(attribute_type):
                errors.append(f"{attribute_label}: implementation-readyではtypeを確定してください")
            if not isinstance(attribute.get("required"), bool):
                errors.append(
                    f"{attribute_label}: implementation-readyにはrequiredを真偽値で指定してください"
                )


def _architecture_records(value):
    """Yield concrete architecture facts without treating a diagram view as a fact."""
    if isinstance(value, list):
        yield from value
    elif isinstance(value, dict):
        for key in ("elements", "nodes", "people", "systems", "containers", "relationships", "decisions"):
            records = value.get(key)
            if isinstance(records, list):
                yield from records


def _has_architecture_view(value):
    if isinstance(value, list):
        return bool(value)
    if not isinstance(value, dict):
        return False
    return bool(list(_architecture_records(value))) or bool(value.get("diagram") or value.get("summary"))


CONTRACT_FIELDS = {
    "api": ("method", "path", "auth", "request", "response", "errors"),
    "event": (
        "producer",
        "consumers",
        "trigger",
        "payload",
        "delivery",
        "ordering",
        "deduplication",
        "retry",
        "recovery",
        "schema",
        "version",
    ),
    "batch": (
        "schedule",
        "timezone",
        "initiator",
        "input",
        "output",
        "target_range",
        "overlap_policy",
        "transaction",
        "retry",
        "recovery",
        "monitoring",
    ),
    "external-interface": (
        "direction", "protocol", "endpoint", "auth", "payload", "timeout", "delivery", "retry", "recovery"
    ),
    "screen": ("route", "input", "output", "validation", "actions", "auth", "errors"),
    "manual": (
        "initiator",
        "preconditions",
        "procedure",
        "roles",
        "input",
        "output",
        "evidence",
        "approval",
        "failure",
        "recovery",
        "completion_record",
    ),
}

UNRESOLVED_VALUE = re.compile(
    r"^(?:tbd|todo|unknown|undetermined|未確定|要確認)(?:$|[\s:：(/（].*)",
    re.IGNORECASE,
)


def _is_unresolved_value(value):
    """Return true when an implementation contract still contains a placeholder."""
    if isinstance(value, str):
        return bool(UNRESOLVED_VALUE.match(value.strip()))
    if isinstance(value, list):
        return any(_is_unresolved_value(item) for item in value)
    if isinstance(value, dict):
        if str(value.get("status", "")).casefold() == "not-applicable":
            return False
        return any(_is_unresolved_value(item) for item in value.values())
    return False


def _present(record, key):
    if key not in record:
        return False
    value = record.get(key)
    if value is False or value == 0:
        return True
    return bool(value) or value == "none"


def _present_contract_field(contract, key):
    aliases = {
        "input": ("input", "inputs", "fields"),
        "output": ("output", "outputs", "display_fields"),
        "response": ("response", "responses"),
        "endpoint": ("endpoint", "endpoint_or_channel"),
        "navigation": ("navigation", "actions", "route", "view_id"),
        "auth": ("auth", "permissions"),
        "route": ("route", "view_id"),
        "actions": ("actions", "navigation"),
        "failure": ("failure", "rollback"),
        "completion_record": ("completion_record", "completion", "record"),
        "schema": ("schema", "schema_ref", "payload_schema"),
        "version": ("version", "schema_version", "payload_version"),
        "consumers": ("consumers", "consumer"),
    }
    return any(_present(contract, candidate) for candidate in aliases.get(key, (key,)))


def _contract_data_records(value):
    if isinstance(value, list):
        for record in value:
            if isinstance(record, dict):
                if any(key in record for key in ("basis", "source_refs", "name", "id", "code", "status")):
                    yield record
                for nested in record.values():
                    yield from _contract_data_records(nested)
    elif isinstance(value, dict):
        if any(key in value for key in ("basis", "source_refs", "name", "id", "text", "code", "status")):
            yield value
        for nested in value.values():
            yield from _contract_data_records(nested)


def _require_structured_fields(value, label, groups, errors):
    if not isinstance(value, dict):
        errors.append(f"{label}: 構造化objectで指定してください")
        return
    missing = []
    for display, alternatives in groups:
        if not any(_present(value, key) for key in alternatives):
            missing.append(display)
    if missing:
        errors.append(f"{label}: 必須項目が不足しています: {', '.join(missing)}")


def _validate_contracts(cfg, source_context, errors):
    valid_source_ids, artifact_roots, decision_ids = source_context
    interface_ids = set()
    external_present = False
    for index, interface in enumerate(cfg.get("interfaces", []) or [], 1):
        if not isinstance(interface, dict):
            continue
        interface_id = str(interface.get("id", "")).strip()
        interface_ids.add(interface_id)
        kind = interface.get("type")
        if kind in {"api", "event", "external-interface"}:
            external_present = True
        required = CONTRACT_FIELDS.get(kind)
        if not required:
            continue
        contract = interface.get("contract")
        label = f"インターフェース {interface_id or index} のcontract"
        if not isinstance(contract, dict):
            errors.append(f"{label}がありません")
            continue
        _validate_provenance(contract, label, valid_source_ids, artifact_roots, decision_ids, errors)
        if kind in {"api", "event", "external-interface"} and not _references_artifact(
            contract, {"contract", "contracts"}
        ):
            errors.append(
                f"{label}: 外部契約の正本(contract:...)をsource_refsで参照していません"
            )
        missing = [key for key in required if not _present_contract_field(contract, key)]
        method = str(contract.get("method", "")).upper()
        if kind == "api" and method in {"POST", "PUT", "PATCH", "DELETE"}:
            for key in ("idempotency", "transaction", "concurrency"):
                if not _present_contract_field(contract, key):
                    missing.append(key)
        if missing:
            errors.append(f"{label}: 必須項目が不足しています: {', '.join(missing)}")
        for key in required:
            aliases = {
                "input": ("input", "inputs", "fields"),
                "output": ("output", "outputs", "display_fields"),
                "response": ("response", "responses"),
                "endpoint": ("endpoint", "endpoint_or_channel"),
                "route": ("route", "view_id"),
                "actions": ("actions", "navigation"),
                "schema": ("schema", "schema_ref", "payload_schema"),
                "version": ("version", "schema_version", "payload_version"),
                "consumers": ("consumers", "consumer"),
            }.get(key, (key,))
            for field_name in aliases:
                if field_name in contract and _is_unresolved_value(contract[field_name]):
                    errors.append(f"{label}.{field_name}: implementation-readyでは未確定値を使用できません")
        if kind == "api" and method in {"POST", "PUT", "PATCH", "DELETE"}:
            for key in ("idempotency", "transaction", "concurrency"):
                if key in contract and _is_unresolved_value(contract[key]):
                    errors.append(f"{label}.{key}: implementation-readyでは未確定値を使用できません")
        for data_key in (
            "input",
            "inputs",
            "output",
            "outputs",
            "request",
            "response",
            "payload",
            "errors",
            "validation",
            "navigation",
        ):
            for data_index, fact in enumerate(_contract_data_records(contract.get(data_key)), 1):
                # The contract-level provenance covers fields copied verbatim
                # from OpenAPI/event schemas.  If an individual item declares
                # provenance, validate it as an independently derived fact.
                if "basis" in fact or "source_refs" in fact:
                    _validate_provenance(
                        fact,
                        f"{label}.{data_key}[{data_index}]",
                        valid_source_ids,
                        artifact_roots,
                        decision_ids,
                        errors,
                    )
    return interface_ids, external_present


def _validate_operational_contracts(cfg, errors):
    """Check retry exhaustion and recovery semantics on operational boundaries."""
    for index, interface in enumerate(cfg.get("interfaces", []) or [], 1):
        if not isinstance(interface, dict):
            continue
        kind = interface.get("type")
        contract = interface.get("contract")
        if not isinstance(contract, dict):
            continue
        label = f"インターフェース {interface.get('id') or index} のcontract"
        if kind in {"event", "external-interface"}:
            _require_structured_fields(
                contract.get("retry"),
                f"{label}.retry",
                (
                    ("上限", ("max_attempts", "limit", "attempts")),
                    ("間隔/backoff", ("interval", "backoff")),
                    ("上限到達時", ("on_exhaustion", "dead_letter", "isolation")),
                ),
                errors,
            )
            _require_structured_fields(
                contract.get("recovery"),
                f"{label}.recovery",
                (
                    ("通知/alert", ("notification", "alert")),
                    ("手動復旧/runbook", ("manual_recovery", "manual_retry", "runbook", "procedure")),
                ),
                errors,
            )
        elif kind == "batch":
            _require_structured_fields(
                contract.get("retry"),
                f"{label}.retry",
                (
                    ("上限", ("max_attempts", "limit", "attempts")),
                    ("間隔/backoff", ("interval", "backoff")),
                    ("上限到達時", ("on_exhaustion", "dead_letter", "isolation")),
                ),
                errors,
            )
            _require_structured_fields(
                contract.get("recovery"),
                f"{label}.recovery",
                (
                    ("再開方法", ("resume", "restart", "checkpoint", "runbook", "procedure")),
                    ("証跡", ("evidence", "audit", "record")),
                ),
                errors,
            )


def _validate_architecture(
    cfg,
    source_context,
    errors,
    require_core_views=True,
    validate_operational=False,
):
    valid_source_ids, artifact_roots, decision_ids = source_context
    architecture = cfg.get("architecture")
    if not isinstance(architecture, dict):
        errors.append("architectureはオブジェクトで指定してください")
        return
    global_element_views = {}
    for view_key in ("context", "containers", "components", "code"):
        view = architecture.get(view_key)
        if view_key == "context" and not view:
            view = architecture.get("system_context")
        if view_key == "containers" and not view:
            view = architecture.get("container")
        if view_key == "components" and not view:
            view = architecture.get("component")
        if not _has_architecture_view(view):
            if require_core_views and view_key in {"context", "containers"}:
                errors.append(f"architecture.{view_key} がありません")
            continue
        if not isinstance(view, dict):
            errors.append(f"architecture.{view_key}は構造化objectで指定してください")
            continue
        records = list(_architecture_records(view))
        for index, fact in enumerate(records, 1):
            _validate_provenance(
                fact,
                f"architecture.{view_key} fact[{index}]",
                valid_source_ids,
                artifact_roots,
                decision_ids,
                errors,
            )
        elements = [
            element
            for key in ("elements", "nodes", "people", "systems", "containers")
            for element in _as_list(view.get(key))
            if isinstance(element, dict)
        ]
        relationships = [
            relation
            for relation in _as_list(view.get("relationships"))
            if isinstance(relation, dict)
        ]
        if not elements:
            errors.append(f"architecture.{view_key}.elementsがありません")
        if view_key == "context" and len(elements) < 2:
            errors.append("architecture.contextには対象systemとactor/external systemが必要です")
        if not relationships and (view_key == "context" or len(elements) > 1):
            errors.append(f"architecture.{view_key}.relationshipsがありません")
        element_ids = [str(element.get("id", "")).strip() for element in elements]
        if len({value for value in element_ids if value}) != len(elements):
            errors.append(f"architecture.{view_key}.elementsのidが空または重複しています")
        for element_id in (value for value in element_ids if value):
            previous_view = global_element_views.get(element_id)
            if previous_view is not None:
                errors.append(
                    f"architecture element id {element_id} が{previous_view}と{view_key}で重複しています"
                )
            else:
                global_element_views[element_id] = view_key
        allowed_types = {
            "context": {"person", "system", "external-system"},
            "containers": {"application", "worker", "database", "queue", "external-system"},
            "components": {"component", "service", "module", "repository", "adapter", "external-system"},
            "code": {"package", "module", "class", "function", "interface", "external"},
        }[view_key]
        for element_index, element in enumerate(elements, 1):
            element_type = str(element.get("type", "")).strip()
            if element_type not in allowed_types:
                errors.append(
                    f"architecture.{view_key}.elements[{element_index}]: typeが不正です: "
                    f"{element_type or '(空)'}"
                )
            if not str(element.get("name", "")).strip():
                errors.append(f"architecture.{view_key}.elements[{element_index}]: nameが空です")
        if view_key == "context":
            types = {str(element.get("type", "")).strip() for element in elements}
            if "system" not in types or not types & {"person", "external-system"}:
                errors.append(
                    "architecture.contextにはtype=systemとperson/external-systemの双方が必要です"
                )
        elif view_key == "containers":
            types = {str(element.get("type", "")).strip() for element in elements}
            if not types & {"application", "worker", "database", "queue"}:
                errors.append("architecture.containersに実装・保存境界がありません")
        elif view_key == "components":
            types = {str(element.get("type", "")).strip() for element in elements}
            if not types & {"component", "service", "module", "repository", "adapter"}:
                errors.append("architecture.componentsにコンポーネント要素がありません")
        elif view_key == "code":
            types = {str(element.get("type", "")).strip() for element in elements}
            if not types & {"package", "module", "class", "function", "interface"}:
                errors.append("architecture.codeにコード要素がありません")
        element_id_set = {value for value in element_ids if value}
        for relation_index, relation in enumerate(relationships, 1):
            for endpoint in ("from", "to"):
                target = str(relation.get(endpoint, "")).strip()
                if not target or target not in element_id_set:
                    errors.append(
                        f"architecture.{view_key}.relationships[{relation_index}]: "
                        f"{endpoint}が同じ図のelementを参照していません: {target or '(空)'}"
                    )
            if not str(relation.get("label") or relation.get("description") or "").strip():
                errors.append(
                    f"architecture.{view_key}.relationships[{relation_index}]: label/descriptionが空です"
                )
    for index, decision in enumerate(_as_list(architecture.get("decisions")), 1):
        _validate_provenance(
            decision,
            f"architecture.decisions[{index}]",
            valid_source_ids,
            artifact_roots,
            decision_ids,
            errors,
        )
        if not str(decision.get("id", "")).strip() or not str(
            decision.get("decision") or decision.get("rationale") or ""
        ).strip():
            errors.append(f"architecture.decisions[{index}]: idまたは設計判断本文が空です")
    if validate_operational:
        for key in ("deployment", "observability", "recovery"):
            value = architecture.get(key)
            if not value:
                continue
            records = list(_architecture_records(value))
            if isinstance(value, dict) and not records and value.get("basis"):
                records = [value]
            if not records:
                errors.append(f"architecture.{key}にprovenance付きfactがありません")
            for index, fact in enumerate(records, 1):
                _validate_provenance(
                    fact,
                    f"architecture.{key}[{index}]",
                    valid_source_ids,
                    artifact_roots,
                    decision_ids,
                    errors,
                )
                if not _has_substantive_content(fact):
                    errors.append(f"architecture.{key}[{index}]に具体的内容がありません")


def _validate_quality_risks_verification(cfg, items, source_context, functional_errors, operational_errors):
    valid_source_ids, artifact_roots, decision_ids = source_context
    scenarios = _section_items(cfg, "quality_scenarios")
    for index, scenario in enumerate(scenarios, 1):
        label = f"quality_scenarios[{index}]"
        if not isinstance(scenario, dict):
            operational_errors.append(f"{label}: オブジェクトで指定してください")
            continue
        missing = [key for key in ("id", "response", "measure") if not _present(scenario, key)]
        if not (_present(scenario, "category") or _present(scenario, "attribute")):
            missing.append("category/attribute")
        if not (_present(scenario, "scenario") or _present(scenario, "stimulus")):
            missing.append("scenario/stimulus")
        if missing:
            operational_errors.append(f"{label}: 必須項目が不足しています: {', '.join(missing)}")
        for key in ("response", "measure"):
            if key in scenario and _is_unresolved_value(scenario[key]):
                operational_errors.append(f"{label}.{key}: 未確定値を使用できません")
        _validate_provenance(
            scenario, label, valid_source_ids, artifact_roots, decision_ids, operational_errors
        )

    risks = _section_items(cfg, "risks")
    for index, risk in enumerate(risks, 1):
        label = f"risks[{index}]"
        if not isinstance(risk, dict):
            operational_errors.append(f"{label}: オブジェクトで指定してください")
            continue
        missing = [
            key for key in ("id", "impact", "probability", "mitigation", "owner", "status")
            if not _present(risk, key)
        ]
        if not any(_present(risk, key) for key in ("description", "title", "name")):
            missing.append("title/name/description")
        if missing:
            operational_errors.append(f"{label}: 必須項目が不足しています: {', '.join(missing)}")
        _validate_provenance(risk, label, valid_source_ids, artifact_roots, decision_ids, operational_errors)

    verifications = _section_items(cfg, "verification")
    verified_sc = set()
    verification_ids = set()
    verification_by_id = {}
    for index, verification in enumerate(verifications, 1):
        label = f"verification[{index}]"
        if not isinstance(verification, dict):
            functional_errors.append(f"{label}: オブジェクトで指定してください")
            continue
        verification_id = str(verification.get("id", "")).strip()
        if not verification_id or verification_id in verification_ids:
            functional_errors.append(f"{label}: idが空または重複しています")
        verification_ids.add(verification_id)
        verification_by_id[verification_id] = verification
        missing = [key for key in ("method", "expected_result") if not _present(verification, key)]
        if missing:
            functional_errors.append(f"{label}: 必須項目が不足しています: {', '.join(missing)}")
        for key in ("method", "expected_result"):
            if key in verification and _is_unresolved_value(verification[key]):
                functional_errors.append(f"{label}.{key}: 未確定値を使用できません")
        _validate_provenance(
            verification, label, valid_source_ids, artifact_roots, decision_ids, functional_errors
        )
        raw_criterion_refs = _reference_values(verification.get("source_refs"))
        raw_criterion_refs.extend(
            _reference_values(verification.get("source_id") or verification.get("criterion_id"))
        )
        for ref in raw_criterion_refs:
            verified_sc.update(re.findall(r"SC-\d+", ref.upper()))
    required_sc = {item["id"] for item in items if item.get("type") == "success-criterion"}
    missing_sc = sorted(required_sc - verified_sc)
    if missing_sc:
        functional_errors.append("Success Criteriaの検証方法がありません: " + ", ".join(missing_sc))
    for trace in cfg.get("traceability", []) or []:
        source_id = str(trace.get("source_id", "")).strip().upper()
        linked = [str(value) for value in _as_list(trace.get("verification_ids")) if str(value)]
        unknown = [verification_id for verification_id in linked if verification_id not in verification_by_id]
        if unknown:
            functional_errors.append(
                f"トレーサビリティ {source_id}: 未定義verification参照: {', '.join(unknown)}"
            )
        if source_id not in required_sc:
            continue
        if not linked:
            functional_errors.append(f"トレーサビリティ {source_id}: verification_idsがありません")
            continue
        for verification_id in linked:
            verification = verification_by_id.get(verification_id, {})
            refs = " ".join(
                _reference_values(verification.get("source_refs"))
                + _reference_values(verification.get("source_id") or verification.get("criterion_id"))
            )
            if source_id not in refs.upper():
                functional_errors.append(
                    f"トレーサビリティ {source_id}: {verification_id}から成功基準へ逆参照できません"
                )
    for scenario in scenarios:
        if not isinstance(scenario, dict):
            continue
        scenario_id = str(scenario.get("id", "")).strip()
        scenario_sc = {
            match
            for ref in _reference_values(scenario.get("source_refs"))
            for match in re.findall(r"SC-\d+", ref.upper())
        }
        linked = False
        for verification in verification_by_id.values():
            explicit = {
                str(value) for value in _as_list(
                    verification.get("quality_scenario_ids") or verification.get("scenario_ids")
                )
            }
            verification_sc = {
                match
                for ref in (
                    _reference_values(verification.get("source_refs"))
                    + _reference_values(verification.get("source_id") or verification.get("criterion_id"))
                )
                for match in re.findall(r"SC-\d+", ref.upper())
            }
            if scenario_id in explicit or (scenario_sc and scenario_sc & verification_sc):
                linked = True
                break
        if not linked:
            operational_errors.append(
                f"quality scenario {scenario_id or '(空)'} に対応するverificationがありません"
            )
    return scenarios, risks, verifications


def _nested_source_refs(value):
    refs = []
    if isinstance(value, dict):
        refs.extend(_reference_values(value.get("source_refs")))
        for key, nested in value.items():
            if key != "source_refs":
                refs.extend(_nested_source_refs(nested))
    elif isinstance(value, list):
        for nested in value:
            refs.extend(_nested_source_refs(nested))
    return list(dict.fromkeys(refs))


def _validate_design_traceability(cfg, errors):
    """Validate requirement -> design refs and the reverse source-ref chain."""
    records = {}

    def register(prefix, record, aliases=()):
        if not isinstance(record, dict) or not record.get("id"):
            return
        record_id = str(record["id"]).strip().upper()
        canonical = f"{prefix}:{record_id}".upper()
        records[canonical] = (canonical, record)
        records[record_id] = (canonical, record)
        for alias in aliases:
            records[f"{alias}:{record_id}".upper()] = (canonical, record)

    for record in _section_items(cfg, "workflows"):
        register("workflow", record)
    for record in _section_items(cfg, "state_models"):
        register("state-model", record, ("state",))
    for record in _section_items(cfg, "entities"):
        register("entity", record)
    for record in cfg.get("interfaces", []) or []:
        register("interface", record)
    for record in _section_items(cfg, "quality_scenarios"):
        register("quality-scenario", record, ("quality",))
    for record in _section_items(cfg, "risks"):
        register("risk", record)
    architecture = cfg.get("architecture") or {}
    if isinstance(architecture, dict):
        for view_key in (
            "context",
            "system_context",
            "containers",
            "container",
            "components",
            "component",
            "code",
        ):
            for record in _architecture_records(architecture.get(view_key)):
                register("architecture", record)

    trace_by_source = {
        str(entry.get("source_id", "")).strip().upper(): entry
        for entry in cfg.get("traceability", []) or []
        if isinstance(entry, dict)
    }
    supplied_by_source = {}
    for source_id, trace in trace_by_source.items():
        supplied = set()
        for raw_ref in _as_list(trace.get("design_refs")):
            normalized = str(raw_ref).strip().upper()
            if not normalized:
                continue
            target = records.get(normalized)
            if target is None:
                errors.append(f"トレーサビリティ {source_id}: 未定義design_ref: {raw_ref}")
                continue
            canonical, record = target
            supplied.add(canonical)
            normative = {
                match
                for ref in _nested_source_refs(record)
                for match in re.findall(r"(?:FR|SC|US|AC|EC|ASM|OOS|CL)-[A-Z0-9-]+", ref.upper())
            }
            if source_id not in normative:
                errors.append(
                    f"トレーサビリティ {source_id}: {raw_ref}から要求へ逆参照できません"
                )
        supplied_by_source[source_id] = supplied

    unique_records = {canonical: record for canonical, record in records.values()}
    for canonical, record in unique_records.items():
        normative = {
            match
            for ref in _nested_source_refs(record)
            for match in re.findall(r"(?:FR|SC|US|AC|EC|ASM|OOS|CL)-[A-Z0-9-]+", ref.upper())
        }
        for source_id in normative:
            if source_id in trace_by_source and canonical not in supplied_by_source.get(source_id, set()):
                errors.append(
                    f"双方向参照が不一致です: {canonical} → {source_id} "
                    "(traceability.design_refsにありません)"
                )


def _axis(status, errors=None, warnings=None, metrics=None):
    errors = list(dict.fromkeys(errors or []))
    warnings = list(dict.fromkeys(warnings or []))
    if status not in READINESS_STATUSES:
        status = "failed"
    if errors:
        status = "failed"
    return {
        "status": status,
        "blocking_error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "metrics": metrics or {},
    }


def _validate_v3_design(spec_text, config, feature_dir=None, level="auto"):
    cfg = normalize_config(config)
    items = extract_normative_items(spec_text, cfg.get("source_catalog"))
    cfg["source_catalog"] = build_source_catalog(items)
    _sync_requirement_decisions(cfg, items)
    functions = flatten_functions(cfg)

    requested_level = cfg.get("document_level") if level in (None, "", "auto") else level
    requirements_errors = []
    functional_errors = []
    contract_errors = []
    operational_errors = []
    requirements_warnings = []
    functional_warnings = []
    contract_warnings = []
    operational_warnings = []
    if feature_dir is None:
        requirements_errors.append(
            "schema_version 3の正本・fingerprint・locator検証にはfeature_dirが必要です"
        )
    if requested_level not in DOCUMENT_LEVELS:
        functional_errors.append(f"document_levelが不正です: {requested_level}")
        requested_level = "functional-design"
    cfg["document_level"] = requested_level

    artifacts, artifact_types, artifact_roots = _validate_artifacts(
        spec_text, cfg, feature_dir, requirements_errors, requirements_warnings
    )
    _validate_source_locators(cfg, artifacts, feature_dir, requirements_errors)
    design_decision_ids = {
        str(decision.get("id", "")).strip().upper()
        for decision in (cfg.get("decisions", []) or [])
        if isinstance(decision, dict)
    }
    decision_ids = {
        str(decision.get("id", "")).strip().upper()
        for decision in (cfg.get("requirement_decisions", []) or [])
        if isinstance(decision, dict)
    }
    decision_ids.update(item["id"].upper() for item in items if item.get("type") == "clarification")
    valid_source_ids = {item["id"].upper() for item in items} | decision_ids | design_decision_ids
    for _, _, _, function in functions:
        if function.get("id"):
            valid_source_ids.add(str(function["id"]).upper())
    for interface in cfg.get("interfaces", []) or []:
        if isinstance(interface, dict) and interface.get("id"):
            valid_source_ids.add(str(interface["id"]).upper())
    for key in ("workflows", "state_models", "entities", "quality_scenarios", "risks", "verification"):
        for record in _section_items(cfg, key):
            if isinstance(record, dict) and record.get("id"):
                valid_source_ids.add(str(record["id"]).upper())
    architecture = cfg.get("architecture") or {}
    if isinstance(architecture, dict):
        for view_key in (
            "context",
            "system_context",
            "containers",
            "container",
            "components",
            "component",
            "code",
            "decisions",
        ):
            for record in _architecture_records(architecture.get(view_key)):
                if isinstance(record, dict) and record.get("id"):
                    valid_source_ids.add(str(record["id"]).upper())
    source_context = (valid_source_ids, artifact_roots, decision_ids)

    compat_cfg = _v3_compatibility_view(cfg)
    _, v2_report, _ = _validate_v2_design(spec_text, compat_cfg)
    requirement_markers = (
        "規範要素",
        "トレーサビリティ",
        "双方向参照",
        "specに無いトレーサビリティ",
        "確認済み決定",
        "未確認の曖昧さ",
    )
    for error in v2_report["errors"]:
        target = requirements_errors if any(marker in error for marker in requirement_markers) else functional_errors
        target.append(error)
    functional_warnings.extend(v2_report["warnings"])

    _validate_v3_functions(
        cfg,
        valid_source_ids,
        artifact_roots,
        decision_ids,
        functional_errors,
        contract_errors,
        requested_level == "implementation-ready",
    )
    _validate_v3_questions(cfg, valid_source_ids, artifact_roots, decision_ids, functional_errors)
    entities = _section_items(cfg, "entities")
    entity_ids = _validate_entities(cfg, entities, source_context, functional_errors)
    if requested_level == "implementation-ready":
        _validate_implementation_entity_types(entities, contract_errors)
    if any(function.get("data_entities") for _, _, _, function in functions) and not entities:
        functional_errors.append("機能が業務データを参照していますがentitiesがありません")
    for _, _, _, function in functions:
        for value in _as_list(function.get("data_entities")):
            reference = str(
                (value.get("entity_id") or value.get("id") or value.get("name") or "")
                if isinstance(value, dict)
                else value
            ).strip()
            if entity_ids and reference and reference not in entity_ids:
                functional_errors.append(
                    f"機能 {function.get('id', '(空)')}: 未定義entityを参照しています: {reference}"
                )

    workflows = _section_items(cfg, "workflows")
    state_models = _section_items(cfg, "state_models")
    function_ids = {str(function.get("id", "")) for _, _, _, function in functions if function.get("id")}
    interface_ids = {
        str(interface.get("id", "")) for interface in cfg.get("interfaces", []) or [] if isinstance(interface, dict)
    }
    _validate_applicability(
        cfg,
        "workflows",
        workflows,
        _workflow_requirement_present(items, functions),
        valid_source_ids,
        artifact_roots,
        decision_ids,
        functional_errors,
    )
    _validate_applicability(
        cfg,
        "state_models",
        state_models,
        _state_requirement_present(items),
        valid_source_ids,
        artifact_roots,
        decision_ids,
        functional_errors,
    )
    _validate_workflows(cfg, workflows, function_ids, interface_ids, source_context, functional_errors)
    _validate_state_models(
        cfg,
        state_models,
        entity_ids,
        source_context,
        functional_errors,
        require_policy=True,
    )

    quality_target = operational_errors if requested_level == "implementation-ready" else functional_errors
    scenarios, risks, _ = _validate_quality_risks_verification(
        cfg, items, source_context, requirements_errors, quality_target
    )
    _validate_design_traceability(cfg, requirements_errors)

    if requested_level == "functional-design":
        future_required = {"plan", "research", "data-model", "quickstart"}
        if any(
            isinstance(interface, dict)
            and interface.get("type") in {"api", "event", "external-interface"}
            for interface in cfg.get("interfaces", []) or []
        ):
            future_required.add("contracts")
        for artifact_type in sorted(future_required - artifact_types):
            contract_warnings.append(
                f"implementation-ready評価にはsource artifact {artifact_type} が必要です"
            )
        architecture = cfg.get("architecture") or {}
        has_architecture = isinstance(architecture, dict) and any(
            architecture.get(key)
            for key in (
                "context",
                "system_context",
                "containers",
                "container",
                "components",
                "component",
                "code",
                "decisions",
                "deployment",
                "observability",
                "recovery",
            )
        )
        if has_architecture:
            if "plan" not in artifact_types:
                functional_errors.append(
                    "functional-designに技術architectureがありますがsource.artifactsにplanがありません"
                )
            _validate_architecture(
                cfg,
                source_context,
                functional_errors,
                require_core_views=False,
                validate_operational=True,
            )
        has_typed_contract = any(
            isinstance(interface, dict) and isinstance(interface.get("contract"), dict)
            for interface in cfg.get("interfaces", []) or []
        )
        if has_typed_contract:
            if "contracts" not in artifact_types:
                functional_errors.append(
                    "functional-designにtyped contractがありますがsource.artifactsにcontractがありません"
                )
            _validate_contracts(cfg, source_context, functional_errors)
        has_physical_model = any(
            isinstance(entity, dict)
            and (
                str(entity.get("kind", "")).casefold() in {"physical", "table"}
                or any(key in entity for key in ("table", "table_name", "indexes", "storage"))
            )
            for entity in entities
        )
        if has_physical_model and "data-model" not in artifact_types:
            functional_errors.append(
                "functional-designに物理データモデルがありますがsource.artifactsにdata-modelがありません"
            )

    if requested_level == "implementation-ready":
        required_artifacts = {"plan", "research", "data-model", "quickstart"}
        missing_artifacts = sorted(required_artifacts - artifact_types)
        if missing_artifacts:
            contract_errors.append(
                "implementation-readyに必要な成果物がありません: " + ", ".join(missing_artifacts)
            )
        _validate_architecture(cfg, source_context, contract_errors)
        architecture_decisions = _as_list((cfg.get("architecture") or {}).get("decisions"))
        if not architecture_decisions:
            contract_errors.append(
                "implementation-readyにはresearch.mdに基づくarchitecture.decisionsが必要です"
            )
        elif not any(
            _references_artifact(decision, {"research"})
            for decision in architecture_decisions
            if isinstance(decision, dict)
        ):
            contract_errors.append(
                "architecture.decisionsがresearch:...をsource_refsで参照していません"
            )
        _, external_present = _validate_contracts(cfg, source_context, contract_errors)
        _validate_operational_contracts(cfg, operational_errors)
        if external_present and "contracts" not in artifact_types:
            contract_errors.append("外部インターフェースがありますがsource.artifactsにcontractsがありません")
        if not scenarios:
            operational_errors.append("implementation-readyにはquality_scenariosが必要です")
        quickstart_verification = any(
            isinstance(verification, dict)
            and str(verification.get("level", "")).casefold() in {"e2e", "operational", "manual-review"}
            and any(
                str(ref).upper().startswith(
                    ("QUICKSTART:", "QUICKSTART#", "QUICKSTART>", "QUICKSTART /")
                )
                for ref in _reference_values(verification.get("source_refs"))
            )
            for verification in _section_items(cfg, "verification")
        )
        if not quickstart_verification:
            operational_errors.append(
                "quickstartを根拠にした主要E2Eまたは障害復旧verificationがありません"
            )
        if not risks:
            risk_app = _applicability(cfg, "risks", risks)
            if risk_app.get("status") == "not-applicable" and str(risk_app.get("rationale", "")).strip():
                _validate_provenance(
                    risk_app,
                    "risksのnot-applicable判断",
                    valid_source_ids,
                    artifact_roots,
                    decision_ids,
                    operational_errors,
                )
            else:
                operational_errors.append("implementation-readyにはrisksまたはnot-applicableの根拠が必要です")
        architecture = cfg.get("architecture") or {}
        for key in ("deployment", "observability", "recovery"):
            value = architecture.get(key)
            if not value:
                operational_errors.append(f"operational readinessにarchitecture.{key}が必要です")
            else:
                records = list(_architecture_records(value))
                if isinstance(value, dict) and not records and value.get("basis"):
                    records = [value]
                if not records:
                    operational_errors.append(
                        f"architecture.{key}にprovenance付きfactがありません"
                    )
                for index, fact in enumerate(records, 1):
                    _validate_provenance(
                        fact,
                        f"architecture.{key}[{index}]",
                        valid_source_ids,
                        artifact_roots,
                        decision_ids,
                        operational_errors,
                    )
                    if not _has_substantive_content(fact):
                        operational_errors.append(
                            f"architecture.{key}[{index}]に配置・監視・復旧の具体的内容がありません"
                        )
        if "tasks" in artifact_types:
            delivery = cfg.get("delivery_summary")
            if not isinstance(delivery, dict):
                operational_errors.append("tasks.mdがありますがdelivery_summaryがありません")
            else:
                missing = [
                    key for key in ("phases", "dependencies", "completed", "total") if key not in delivery
                ]
                if missing:
                    operational_errors.append(
                        "delivery_summaryの必須項目が不足しています: " + ", ".join(missing)
                    )
                _validate_provenance(
                    delivery,
                    "delivery_summary",
                    valid_source_ids,
                    artifact_roots,
                    decision_ids,
                    operational_errors,
                )
                actual_progress = _task_progress_from_artifacts(artifacts, feature_dir)
                if actual_progress is not None:
                    for key in ("completed", "total"):
                        try:
                            declared = int(delivery.get(key))
                        except (TypeError, ValueError):
                            continue
                        if declared != actual_progress[key]:
                            operational_errors.append(
                                f"delivery_summary.{key}={declared} がtasks.mdの実数 "
                                f"{actual_progress[key]} と一致しません"
                            )

    resolved = sum(
        1
        for entry in cfg.get("traceability", []) or []
        if entry.get("coverage") in {"covered", "future", "out-of-scope"}
    )
    requirements = _axis(
        "passed",
        requirements_errors,
        requirements_warnings,
        {
            "normative_total": len(items),
            "covered": resolved,
            "percent": round(resolved * 100 / len(items), 1) if items else 100.0,
        },
    )
    functional = _axis(
        "passed",
        functional_errors,
        functional_warnings,
        {"functions": len(functions), "workflows": len(workflows), "state_models": len(state_models)},
    )
    complete_contracts = sum(
        1
        for interface in cfg.get("interfaces", []) or []
        if isinstance(interface, dict) and isinstance(interface.get("contract"), dict)
    )
    contract_metrics = {"interfaces": len(cfg.get("interfaces", []) or []), "complete_contracts": complete_contracts}
    operational_metrics = {
        "quality_scenarios": len(scenarios),
        "risks": len(risks),
        "verifications": len(_section_items(cfg, "verification")),
    }
    if requested_level == "implementation-ready":
        contracts = _axis("passed", contract_errors, contract_warnings, contract_metrics)
        operations = _axis("passed", operational_errors, operational_warnings, operational_metrics)
    else:
        contracts = _axis(
            "not-evaluated",
            [],
            contract_warnings,
            contract_metrics,
        )
        operations = _axis(
            "not-evaluated",
            [],
            operational_warnings,
            operational_metrics,
        )
    readiness = {
        "requirements_coverage": requirements,
        "functional_design": functional,
        "implementation_contracts": contracts,
        "operational_readiness": operations,
    }
    required_axes = READINESS_AXES[:2] if requested_level == "functional-design" else READINESS_AXES
    blocked = any(readiness[axis]["status"] == "failed" for axis in required_axes)
    errors = list(
        dict.fromkeys(
            error
            for axis in READINESS_AXES
            for error in readiness[axis]["errors"]
        )
    )
    warnings = list(
        dict.fromkeys(
            warning
            for axis in READINESS_AXES
            for warning in readiness[axis]["warnings"]
        )
    )
    report = _report(errors, warnings, items, cfg.get("traceability", []) or [], functions)
    report.update(
        {
            "status": "failed" if blocked else "passed",
            "document_level": requested_level,
            "document_status": "blocked" if blocked else requested_level,
            "readiness": readiness,
        }
    )
    return cfg, report, items


def validate_design(spec_text, config, feature_dir=None, level="auto"):
    """Validate v2 or v3 while preserving the historical three-value return.

    ``feature_dir`` enables existence/fingerprint checks for ``source.artifacts``.
    ``level`` defaults to the v3 document's declared level and is ignored for v2.
    """
    if config.get("schema_version") == SCHEMA_VERSION:
        return _validate_v3_design(spec_text, config, feature_dir=feature_dir, level=level)
    return _validate_v2_design(spec_text, config)


def append_clarification(spec_text, question, answer, confirmed_on=None):
    """Append a dated clarification session and return (text, clarification_id)."""
    confirmed_on = confirmed_on or date.today().isoformat()
    stamp = confirmed_on.replace("-", "")
    existing = re.findall(rf"\bCL-{stamp}-(\d+)\b", spec_text)
    seq = max([int(v) for v in existing] or [0]) + 1
    clarification_id = f"CL-{stamp}-{seq:02d}"
    entry = f"- **{clarification_id}** Q: {_clean_markdown(question)} → A: {_clean_markdown(answer)}"
    session_heading = f"### Session {confirmed_on}"

    if session_heading in spec_text:
        position = spec_text.index(session_heading) + len(session_heading)
        next_heading = re.search(r"\n#{2,3}\s+", spec_text[position:])
        insertion = position + (next_heading.start() if next_heading else len(spec_text[position:]))
        prefix = spec_text[:insertion].rstrip()
        suffix = spec_text[insertion:].lstrip("\n")
        return prefix + "\n\n" + entry + "\n\n" + suffix, clarification_id

    clarification_heading = re.search(r"^##\s+Clarifications\s*$", spec_text, re.I | re.M)
    if clarification_heading:
        start = clarification_heading.end()
        next_h2 = re.search(r"\n##\s+", spec_text[start:])
        insertion = start + (next_h2.start() if next_h2 else len(spec_text[start:]))
        prefix = spec_text[:insertion].rstrip()
        suffix = spec_text[insertion:].lstrip("\n")
        block = f"{session_heading}\n\n{entry}"
        return prefix + "\n\n" + block + "\n\n" + suffix, clarification_id

    first_h2 = re.search(r"^##\s+", spec_text, re.M)
    insertion = first_h2.start() if first_h2 else len(spec_text)
    prefix = spec_text[:insertion].rstrip()
    suffix = spec_text[insertion:].lstrip("\n")
    block = f"## Clarifications\n\n{session_heading}\n\n{entry}"
    return prefix + "\n\n" + block + "\n\n" + suffix, clarification_id


def record_confirmation(spec_text, config, question_id, answer, confirmed_on=None):
    """Record an answer in spec and design, leaving it answered until design details are applied."""
    cfg = copy.deepcopy(config)
    questions = cfg.get("open_questions", []) or []
    question = next((item for item in questions if item.get("id") == question_id), None)
    if question is None:
        raise ValueError(f"質問IDが見つかりません: {question_id}")
    if question.get("status") == "resolved":
        raise ValueError(f"質問は既に解決済みです: {question_id}")
    updated_spec, clarification_id = append_clarification(
        spec_text, question.get("question", question_id), answer, confirmed_on
    )
    confirmed_on = confirmed_on or date.today().isoformat()
    decisions = cfg.setdefault("decisions", [])
    decisions = [decision for decision in decisions if decision.get("id") != clarification_id]
    decisions.append(
        {
            "id": clarification_id,
            "question": question.get("question", question_id),
            "answer": _clean_markdown(answer),
            "confirmed_on": confirmed_on,
            "source_locator": f"spec.md > Clarifications > Session {confirmed_on}",
            "source_refs": _split_refs(question.get("source_refs")),
        }
    )
    cfg["decisions"] = decisions
    question["status"] = "answered"
    question["confirmation_id"] = clarification_id
    question["answer"] = _clean_markdown(answer)
    return updated_spec, cfg, clarification_id


def mark_question_resolved(config, question_id):
    """Mark an answered question resolved after affected design records reference its CL id."""
    cfg = copy.deepcopy(config)
    question = next((item for item in cfg.get("open_questions", []) or [] if item.get("id") == question_id), None)
    if question is None:
        raise ValueError(f"質問IDが見つかりません: {question_id}")
    if question.get("status") != "answered" or not question.get("confirmation_id"):
        raise ValueError(f"回答記録前の質問は解決済みにできません: {question_id}")
    confirmation = str(question["confirmation_id"]).upper()
    records = _design_record_registry(cfg)
    affected = _as_list(
        question.get("affected_refs")
        or question.get("function_ids")
        or question.get("function_id")
        or question.get("design_refs")
    )
    if not affected:
        raise ValueError(f"影響先がない質問は解決済みにできません: {question_id}")
    unapplied = []
    for value in affected:
        raw_ref = str(value.get("id") or value.get("ref") or "") if isinstance(value, dict) else str(value)
        target = records.get(raw_ref.strip().upper())
        if target is None or confirmation not in {ref.upper() for ref in _nested_source_refs(target)}:
            unapplied.append(raw_ref or "(空)")
    if unapplied:
        raise ValueError(
            f"確認回答 {confirmation} が影響先へ未反映です: {', '.join(unapplied)}"
        )
    question["status"] = "resolved"
    return cfg
