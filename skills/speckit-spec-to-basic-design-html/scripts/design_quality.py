# -*- coding: utf-8 -*-
"""Design schema v2 normalization, Spec Kit extraction, and quality gates."""

from __future__ import annotations

import copy
import hashlib
import re
from collections import Counter, defaultdict
from datetime import date
from difflib import SequenceMatcher


SCHEMA_VERSION = 2
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
    """Return schema v2. Legacy data is preserved and marked incomplete."""
    cfg = copy.deepcopy(config)
    if cfg.get("schema_version") == SCHEMA_VERSION:
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

    cfg["schema_version"] = SCHEMA_VERSION
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


def validate_design(spec_text, config):
    """Validate schema v2 and bidirectional traceability against spec.md."""
    cfg = normalize_config(config)
    errors = []
    warnings = []
    items = extract_normative_items(spec_text, cfg.get("source_catalog"))
    item_by_id = {item["id"]: item for item in items}
    functions = flatten_functions(cfg)
    function_by_id = {}

    if config.get("schema_version") != SCHEMA_VERSION:
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
    question["status"] = "resolved"
    return cfg
