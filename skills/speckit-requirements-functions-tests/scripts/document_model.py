#!/usr/bin/env python3
"""Canonical model builder for Spec Kit requirement/function/test documents."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from update_safety import editorial_digest, retain_existing
from test_quality import missing_test_fields
from review_integrity import review_issue


SCHEMA_VERSION = 1
SPECKIT_COMPATIBILITY = "1.0.x"
TESTED_VERSIONS: list[str] = []
ARTIFACT_FILES = {
    "spec": "spec.md",
    "plan": "plan.md",
    "research": "research.md",
    "data-model": "data-model.md",
    "quickstart": "quickstart.md",
    "tasks": "tasks.md",
}
CURRENT_REQUIREMENT_KINDS = {
    "user-story",
    "acceptance-scenario",
    "functional-requirement",
    "non-functional-requirement",
    "edge-case",
    "success-criterion",
}
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u3040-\u30ff\u3400-\u9fff]{2,}")


@dataclass(frozen=True)
class Section:
    level: int
    title: str
    start_line: int
    body: list[tuple[int, str]]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slugify(value: str) -> str:
    value = re.sub(r"[^0-9A-Za-z\u3040-\u30ff\u3400-\u9fff]+", "-", value.strip())
    return value.strip("-") or "feature"


def normalize_text(value: str) -> str:
    value = re.sub(r"[`*_]", "", value)
    return re.sub(r"\s+", " ", value).strip(" :-\t")


def parse_sections(text: str) -> list[Section]:
    lines = text.splitlines()
    headings: list[tuple[int, int, str]] = []
    visible_lines: set[int] = set()
    fence: str | None = None
    for number, line in enumerate(lines, 1):
        fence_match = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fence_match:
            marker = fence_match.group(1)[0]
            fence = None if fence == marker else marker if fence is None else fence
            continue
        if fence:
            continue
        visible_lines.add(number)
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if match:
            headings.append((number, len(match.group(1)), normalize_text(match.group(2))))
    sections: list[Section] = []
    for index, (line_no, level, title) in enumerate(headings):
        end = headings[index + 1][0] if index + 1 < len(headings) else len(lines) + 1
        body = [(n, lines[n - 1]) for n in range(line_no + 1, end) if n in visible_lines]
        sections.append(Section(level, title, line_no, body))
    return sections


def section_key(title: str) -> str:
    lowered = title.casefold()
    aliases = {
        "user-stories": ("user scenarios", "user stories", "ユーザーシナリオ", "ユーザーストーリー", "利用場面と検証"),
        "requirements": ("requirements", "functional requirements", "要件", "機能要件", "必要なこと"),
        "success": ("success criteria", "成功基準", "達成基準", "達成条件"),
        "edge": ("edge cases", "edge case", "境界", "例外ケース", "例外と境界"),
        "assumption": ("assumptions", "assumption", "前提", "仮定"),
        "out-of-scope": ("out of scope", "out-of-scope", "対象外", "スコープ外"),
        "clarification": ("clarifications", "clarification", "確認事項", "明確化"),
        "entity": ("key entities", "entities", "主要エンティティ", "主要データ"),
    }
    for key, values in aliases.items():
        if any(value in lowered for value in values):
            return key
    return "unknown"


def bullet_items(section: Section) -> list[tuple[int, str]]:
    items: list[tuple[int, str]] = []
    for line_no, line in section.body:
        match = re.match(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$", line)
        if match:
            items.append((line_no, normalize_text(match.group(1))))
        elif items and line.strip() and line[:1].isspace():
            start, value = items[-1]
            items[-1] = (start, value + " " + normalize_text(line))
    return items


def explicit_item(text: str) -> tuple[str | None, str]:
    match = re.match(r"(?:\[)?((?:FR|NFR|SC|REQ|AC|EC|ASM|OOS|CL)-[A-Za-z0-9.-]+)(?:\])?\s*[:：-]?\s*(.*)", text, re.I)
    if not match:
        return None, text
    return match.group(1).upper(), normalize_text(match.group(2))


def acceptance_items(body: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Read complete list items, retaining continuation lines and start locators.

    Bold GWT tokens are item contents, not section delimiters. Unrelated prose
    terminates an item so later indented text cannot silently attach to it.
    """
    items: list[tuple[int, str]] = []
    current: tuple[int, list[str]] | None = None
    item_indent = 0
    for line_no, line in body:
        if (re.match(r"^\*\*[^*]+\*\*", line) and not re.match(r"^\*\*(?:Given|When|Then|And|But)\*\*", line, re.I)) or re.fullmatch(r"\s*(?:---+|___+|\*\*\*+)\s*", line):
            break
        match = re.match(r"^(\s*)(?:\d+[.)]|[-*+])\s+(.+)$", line)
        if match:
            indent = len(match.group(1).expandtabs(4))
            if current and indent > item_indent:
                current[1].append(line.strip())
                continue
            if current:
                items.append((current[0], normalize_text(' '.join(current[1]))))
            current = (line_no, [match[2]])
            item_indent = indent
        elif current and line.strip() and (line[:1].isspace() or re.match(r"^(?:\*\*)?(?:Given|When|Then|And|But)\b", line, re.I)):
            current[1].append(line.strip())
        elif line.strip() and current:
            items.append((current[0], normalize_text(' '.join(current[1]))))
            current = None
    if current:
        items.append((current[0], normalize_text(' '.join(current[1]))))
    return items


def make_source_ref(path: str, line: int) -> str:
    return f"{path}#L{line}"


def requirement(
    req_id: str,
    kind: str,
    statement: str,
    source_ref: str,
    *,
    status: str = "current",
    parent_id: str | None = None,
    priority: str = "unspecified",
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": req_id,
        "kind": kind,
        "statement": statement,
        "status": status,
        "priority": priority,
        "parent_id": parent_id,
        "basis": "specified",
        "source_refs": [source_ref],
    }
    if extra:
        item.update(extra)
    return item


def extract_requirements(spec_path: Path, existing: dict[str, Any] | None = None) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    text = spec_path.read_text(encoding="utf-8-sig")
    sections = parse_sections(text)
    title = next((section.title for section in sections if section.level == 1), spec_path.stem)
    context: dict[str, Any] = {"title": title, "overview": "", "key_entities": [], "unclassified_sections": []}
    requirements: list[dict[str, Any]] = []
    questions: list[dict[str, Any]] = []
    counters = {"US": 0, "AC": 0, "EC": 0, "ASM": 0, "OOS": 0, "CL": 0, "REQ": 0}
    story_by_section: dict[int, str] = {}
    existing_generated: dict[tuple[str, str], str] = {}
    reserved_requirement_ids: set[str] = set()
    if existing:
        for entry in existing.get("identity_registry", []):
            if entry.get("kind") == "requirement" and entry.get("source_key") and entry.get("lifecycle") == "active":
                existing_generated[("requirement", str(entry["source_key"]))] = str(entry.get("id"))
            if entry.get("kind") == "requirement":
                reserved_requirement_ids.add(str(entry.get("id")))
    reserved_requirement_ids.update(match.group(0).upper() for match in re.finditer(r"\b(?:FR|NFR|SC|REQ|AC|EC|ASM|OOS|CL)-[A-Za-z0-9.-]+", text))

    def generated_id(prefix: str, kind: str, statement: str, proposed: str, scope: str = "") -> str:
        source_key = f"{kind}:{hashlib.sha256((statement + scope).encode('utf-8')).hexdigest()}"
        old = existing_generated.get(("requirement", source_key))
        if old:
            return old
        if proposed not in reserved_requirement_ids:
            reserved_requirement_ids.add(proposed)
            return proposed
        numbers = [int(match.group(1)) for identity in reserved_requirement_ids if (match := re.match(rf"^{re.escape(prefix)}-(\d+)$", identity))]
        number = max(numbers, default=0) + 1
        while f"{prefix}-{number:03d}" in reserved_requirement_ids:
            number += 1
        identity = f"{prefix}-{number:03d}"
        reserved_requirement_ids.add(identity)
        return identity

    # User stories are headings in the official v1 template.
    for section in sections:
        story_match = re.search(
            r"(?:user story|ユーザーストーリー|利用場面)\s*(\d+)?\s*[-:：]?\s*(.*?)(?:\s*\(\s*(?:priority|優先度)\s*:\s*(P\d)\s*\))?$",
            section.title,
            re.I,
        )
        if not story_match or not story_match.group(1):
            continue
        counters["US"] += 1
        req_id = f"US-{int(story_match.group(1) or counters['US']):03d}"
        story_title = normalize_text(story_match.group(2)) or section.title
        priority_match = re.search(r"(?:priority|優先度)\s*:\s*(P\d)", section.title, re.I)
        priority = priority_match.group(1).upper() if priority_match else "unspecified"
        body_text = " ".join(normalize_text(line) for _, line in section.body if normalize_text(line))
        why_match = re.search(r"Why this priority\s*[:：]\s*(.*?)(?=Independent Test|$)", body_text, re.I)
        independent_match = re.search(r"(?:Independent Test|単独検証)\s*[:：]\s*(.*?)(?=Acceptance|受入|$)", body_text, re.I)
        requirements.append(requirement(
            req_id,
            "user-story",
            story_title,
            make_source_ref("spec.md", section.start_line),
            priority=priority,
            extra={
                "body": "\n".join(line for _, line in section.body),
                "why": normalize_text(why_match.group(1)) if why_match else "",
                "independent_test": normalize_text(independent_match.group(1)) if independent_match else "",
            },
        ))
        story_by_section[section.start_line] = req_id

    def nearest_story(section: Section) -> str | None:
        prior = [candidate for candidate in sections if candidate.start_line < section.start_line and candidate.start_line in story_by_section]
        if not prior:
            return None
        story_section = prior[-1]
        if story_section.level >= section.level:
            return None
        intervening = [candidate for candidate in sections if story_section.start_line < candidate.start_line < section.start_line]
        if any(candidate.level <= story_section.level for candidate in intervening):
            return None
        return story_by_section[story_section.start_line]

    seen_ids = {item["id"] for item in requirements}
    for section in sections:
        key = section_key(section.title)
        if key == "unknown":
            prior = [candidate for candidate in sections if candidate.start_line < section.start_line and candidate.level < section.level and section_key(candidate.title) != "unknown"]
            if prior:
                ancestor = prior[-1]
                intervening = [candidate for candidate in sections if ancestor.start_line < candidate.start_line < section.start_line]
                if not any(candidate.level <= ancestor.level for candidate in intervening):
                    key = section_key(ancestor.title)
        parent = nearest_story(section)
        items = bullet_items(section)
        if key == "entity":
            context["key_entities"].extend({"name": value, "source_ref": make_source_ref("spec.md", line)} for line, value in items)
            continue
        if key == "unknown":
            if section.body and section.title != title and section.start_line not in story_by_section:
                context["unclassified_sections"].append({"title": section.title, "source_ref": make_source_ref("spec.md", section.start_line), "content": "\n".join(line for _, line in section.body)})
        for line_no, value in items:
            explicit_id, statement = explicit_item(value)
            item_key = key
            if explicit_id:
                item_key = {"FR": "requirements", "NFR": "requirements", "REQ": "requirements", "SC": "success", "EC": "edge", "ASM": "assumption", "OOS": "out-of-scope", "CL": "clarification"}.get(explicit_id.split("-", 1)[0], key)
            if not statement:
                continue
            if item_key == "requirements":
                if explicit_id:
                    req_id = explicit_id
                else:
                    counters["REQ"] += 1
                    req_id = generated_id("REQ", "functional-requirement", statement, f"REQ-{counters['REQ']:03d}")
                kind = "non-functional-requirement" if req_id.startswith("NFR-") else "functional-requirement"
                status = "blocked" if "NEEDS CLARIFICATION" in value.upper() else "current"
            elif item_key == "success":
                counters["REQ"] += 1
                req_id = explicit_id or generated_id("SC", "success-criterion", statement, f"SC-{counters['REQ']:03d}")
                kind, status = "success-criterion", "current"
            elif item_key == "edge":
                counters["EC"] += 1
                req_id = explicit_id or generated_id("EC", "edge-case", statement, f"EC-{counters['EC']:03d}")
                kind, status = "edge-case", "current"
            elif item_key == "assumption":
                counters["ASM"] += 1
                req_id = explicit_id or generated_id("ASM", "assumption", statement, f"ASM-{counters['ASM']:03d}")
                kind, status = "assumption", "current"
            elif item_key == "out-of-scope":
                counters["OOS"] += 1
                req_id = explicit_id or generated_id("OOS", "out-of-scope", statement, f"OOS-{counters['OOS']:03d}")
                kind, status = "out-of-scope", "out-of-scope"
            elif item_key == "clarification":
                counters["CL"] += 1
                req_id = explicit_id or generated_id("CL", "clarification", statement, f"CL-{counters['CL']:03d}")
                kind = "clarification"
                status = "blocked" if "NEEDS CLARIFICATION" in statement.upper() or ("→" not in statement and "answer" not in statement.casefold()) else "current"
            else:
                continue
            if req_id in seen_ids:
                if explicit_id:
                    raise ValueError(f"duplicate explicit requirement ID: {req_id}")
                suffix = 2
                base = req_id
                while f"{base}-{suffix}" in seen_ids:
                    suffix += 1
                req_id = f"{base}-{suffix}"
            seen_ids.add(req_id)
            requirements.append(requirement(req_id, kind, statement, make_source_ref("spec.md", line_no), status=status, parent_id=parent))
            if status == "blocked":
                questions.append({
                    "id": f"Q-{len(questions) + 1:03d}",
                    "status": "open",
                    "question": statement,
                    "affected_ids": [req_id],
                    "source_refs": [make_source_ref("spec.md", line_no)],
                    "return_to": "speckit.clarify",
                })

    # Acceptance scenarios may be a real heading or a bold marker in the stock v1 template.
    acceptance_counts: dict[str, int] = {}
    def append_acceptance(parent: str | None, line_no: int, statement: str) -> None:
        key = parent or "US-000"
        acceptance_counts[key] = acceptance_counts.get(key, 0) + 1
        counters["AC"] += 1
        proposed = f"AC-{counters['AC']:03d}"
        req_id = generated_id("AC", "acceptance-scenario", statement, proposed, parent or "")
        if req_id in seen_ids:
            return
        seen_ids.add(req_id)
        requirements.append(requirement(req_id, "acceptance-scenario", statement, make_source_ref("spec.md", line_no), parent_id=parent))

    for section in sections:
        if "acceptance" not in section.title.casefold() and "受入" not in section.title:
            continue
        parent = nearest_story(section)
        for line_no, statement in acceptance_items(section.body):
            append_acceptance(parent, line_no, statement)
    for section in sections:
        parent = story_by_section.get(section.start_line)
        if not parent:
            continue
        active = False
        body: list[tuple[int, str]] = []
        for line_no, line in section.body:
            plain = normalize_text(line)
            if re.fullmatch(r"(?:Acceptance Scenarios|Acceptance Criteria|受入条件|受入シナリオ)\s*[:：]?", plain, re.I):
                active = True
                continue
            next_marker = re.match(r"^\*\*[^*]+\*\*", line) and not re.match(r"^\*\*(?:Given|When|Then|And|But)\*\*", line, re.I)
            separator = re.fullmatch(r"\s*(?:---+|___+|\*\*\*+)\s*", line)
            if active and (next_marker or separator):
                active = False
            if active:
                body.append((line_no, line))
            elif body:
                for start, statement in acceptance_items(body):
                    append_acceptance(parent, start, statement)
                body = []
        for start, statement in acceptance_items(body):
            append_acceptance(parent, start, statement)

    # Preserve the first free prose after the title as overview.
    for line_no, line in enumerate(text.splitlines(), 1):
        plain = normalize_text(line)
        if plain and not line.startswith("#") and not re.match(r"^\s*[-*+]", line):
            context["overview"] = plain
            break
    return context, sorted(requirements, key=lambda item: item["id"]), questions


def tokens(value: str) -> set[str]:
    return {match.group(0).casefold() for match in TOKEN_RE.finditer(value)}


def similarity(left: str, right: str) -> int:
    return len(tokens(left) & tokens(right))


def semantic_similarity(left: str, right: str) -> int:
    shared = semantic_tokens(left) & semantic_tokens(right)
    return len(shared - {"system", "システム", "the", "must", "shall", "should", "will", "can", "able", "user"})


def association_is_supported(requirement_text: str, capability_text: str, score: int) -> bool:
    """Reject weak Japanese grammar overlap while retaining explicit action matches."""
    shared = semantic_tokens(requirement_text) & semantic_tokens(capability_text)
    if any(token.startswith("action:") for token in shared):
        return True
    if re.search(r"[\u3040-\u30ff\u3400-\u9fff]", requirement_text + capability_text):
        return score >= 3
    return score > 0


class IdentityAllocator:
    def __init__(self, existing: dict[str, Any] | None):
        self.by_key: dict[tuple[str, str], str] = {}
        self.used: set[str] = set()
        self.active_keys: set[tuple[str, str]] = set()
        self.questions: list[dict[str, Any]] = []
        self.max_number: dict[str, int] = {"function": 0, "test-case": 0}
        if existing:
            for entry in existing.get("identity_registry", []):
                kind = str(entry.get("kind", ""))
                source_key = str(entry.get("source_key", ""))
                identity = str(entry.get("id", ""))
                if kind and source_key and identity:
                    if entry.get("lifecycle", "active") == "active":
                        self.by_key[(kind, source_key)] = identity
                    self.used.add(identity)
                    match = re.search(r"-(\d+)$", identity)
                    if match and kind in self.max_number:
                        self.max_number[kind] = max(self.max_number[kind], int(match.group(1)))

    def allocate(self, kind: str, source_key: str, legacy_keys: Iterable[str] = ()) -> str:
        self.active_keys.add((kind, source_key))
        existing = self.by_key.get((kind, source_key))
        if not existing:
            for legacy_key in legacy_keys:
                existing = self.by_key.get((kind, legacy_key))
                if existing:
                    self.by_key[(kind, source_key)] = existing
                    break
        if existing:
            self.used.add(existing)
            return existing
        prefix = "FNC" if kind == "function" else "TST"
        number = self.max_number[kind] + 1
        while f"{prefix}-{number:03d}" in self.used:
            number += 1
        identity = f"{prefix}-{number:03d}"
        self.max_number[kind] = number
        self.used.add(identity)
        self.by_key[(kind, source_key)] = identity
        return identity


def derive_functions(requirements: list[dict[str, Any]], allocator: IdentityAllocator) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Derive business capabilities, then attach requirements and constraints to them."""
    functions: list[dict[str, Any]] = []
    links: list[dict[str, str]] = []
    mapping: dict[str, str] = {}
    capability_evidence: dict[str, str] = {}

    def create(req: dict[str, Any], key: str) -> str:
        identity = allocator.allocate("function", key)
        functions.append({
            "id": identity, "name": req["statement"], "summary": req["statement"],
            "status": "current", "priority": req.get("priority", "unspecified"),
            "actors": [], "trigger": "unspecified", "inputs": [], "outputs": [],
            "preconditions": [], "postconditions": [], "business_rules": [], "exceptions": [],
            "basis": "derived", "rationale": "利用者の目的または独立した業務上の振る舞いを、仮の機能境界として採用した",
            "source_refs": req["source_refs"],
        })
        capability_evidence[identity] = " ".join(str(req.get(field, "")) for field in ("statement", "body", "why", "independent_test"))
        return identity

    current = [req for req in requirements if req["kind"] in CURRENT_REQUIREMENT_KINDS and req["status"] == "current"]
    current.sort(key=lambda req: (req["kind"] != "user-story", req["id"]))

    # Without stories, only an explicit shared capability label or same-function
    # declaration justifies grouping. Generic verbs such as create/register do
    # not demonstrate that two requirements describe the same business function.
    anchors = [req for req in current if req["kind"] == "user-story"]
    no_stories = not anchors
    if not anchors:
        anchors = [req for req in current if req["kind"] == "functional-requirement"]
    if not anchors and current:
        anchors = [current[0]]
    labelled_capabilities: dict[str, str] = {}
    for req in anchors:
        label = re.search(r"\[(?:Capability|機能)\s*[:：]\s*([^\]]+)\]", req["statement"], re.I) if no_stories else None
        explicit_targets = sorted({target for identity, target in mapping.items()
                                   if re.search(r"(?:same (?:capability|function) as\s+|同一機能\s*[:：]\s*)" + re.escape(identity) + r"(?![A-Za-z0-9.-])", req["statement"], re.I)}) if no_stories else []
        label_key = normalize_text(label.group(1)).casefold() if label else ""
        target = labelled_capabilities.get(label_key) if label_key else None
        if not target and len(explicit_targets) == 1:
            target = explicit_targets[0]
        if not target:
            target = create(req, ("story:" if req["kind"] == "user-story" else "requirement:") + req["id"])
            if no_stories:
                allocator.questions.append({
                    "status": "open", "question": "User Storyのない入力から機能候補を作成しました。独立した業務責務か、他要件と統合・分割すべきか確認してください。",
                    "affected_ids": [req["id"], target], "source_refs": req["source_refs"],
                    "return_to": "traceability-review",
                })
        if label_key:
            labelled_capabilities[label_key] = target
        mapping[req["id"]] = target
        links.append({"type": "requirement-to-function", "from_id": req["id"], "to_id": target})

    for req in current:
        if req["id"] in mapping:
            continue
        parent = mapping.get(req.get("parent_id"))
        if parent:
            targets = [parent]
        else:
            candidates = sorted(
                ((semantic_similarity(req["statement"], capability_evidence.get(fn["id"], fn["name"])), fn["id"]) for fn in functions),
                key=lambda pair: (-pair[0], pair[1]),
            )
            supported = [(score, identity) for score, identity in candidates if association_is_supported(req["statement"], capability_evidence.get(identity, ""), score)]
            best = supported[0][0] if supported else 0
            targets = [identity for score, identity in supported if score == best]
            uncertain = False
            if not targets and len(functions) == 1 and req["kind"] != "functional-requirement":
                targets = [functions[0]["id"]]
            elif not targets and req["kind"] in {"non-functional-requirement", "edge-case", "success-criterion", "acceptance-scenario"}:
                targets = [fn["id"] for fn in functions]
                uncertain = len(targets) > 1
            elif not targets:
                targets = [create(req, "requirement:" + req["id"])]
                uncertain = True
            elif len(targets) > 1:
                uncertain = True
            if uncertain:
                allocator.questions.append({
                    "status": "open",
                    "question": "この要件が複数機能に共通するか、特定機能だけに属するか確認してください。候補: "
                                + (", ".join(targets) or "なし"),
                    "affected_ids": [req["id"], *targets],
                    "source_refs": req["source_refs"], "return_to": "traceability-review",
                })
        mapping[req["id"]] = targets[0]
        links.extend({"type": "requirement-to-function", "from_id": req["id"], "to_id": target} for target in targets)

    # Enrich each capability with all of its supporting evidence. This makes the
    # function useful as a review unit instead of a copy of one requirement.
    by_id = {req["id"]: req for req in current}
    for function in functions:
        related = [by_id[req_id] for req_id in linked_requirements(function["id"], links)]
        refs = {ref for req in related for ref in req.get("source_refs", [])}
        function["source_refs"] = sorted(refs, key=lambda ref: ((match.group(1), int(match.group(2))) if (match := re.fullmatch(r"(.+)#L(\d+)", ref)) else (ref, 0)))
        function["business_rules"] = [req["statement"] for req in related if req["kind"] == "functional-requirement" and req["statement"] != function["name"]]
        function["exceptions"] = [req["statement"] for req in related if req["kind"] == "edge-case"]
        function["rationale"] = f"{len(related)}件の要件を、同じ利用者目的・業務上の振る舞いとしてまとめた仮の機能境界"
    return sorted(functions, key=lambda item: item["id"]), dedupe_links(links)


def linked_requirements(function_id: str, links: list[dict[str, str]]) -> list[str]:
    return sorted(link["from_id"] for link in links if link["type"] == "requirement-to-function" and link["to_id"] == function_id)


def derive_tests(
    requirements: list[dict[str, Any]], functions: list[dict[str, Any]],
    links: list[dict[str, str]], allocator: IdentityAllocator, enriched: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    from design_evidence import gwt_scenarios

    tests: list[dict[str, Any]] = []
    added: list[dict[str, str]] = []
    current = [req for req in requirements if req["kind"] in CURRENT_REQUIREMENT_KINDS and req["status"] == "current"]
    for req in sorted(current, key=lambda item: item["id"]):
        req_id = req["id"]
        function_ids = sorted(link["to_id"] for link in links if link["type"] == "requirement-to-function" and link["from_id"] == req_id)
        statement = req["statement"]
        scenarios = gwt_scenarios(statement)
        primary = next((fn for fn in functions if fn["id"] == function_ids[0]), None) if function_ids else None
        for position, scenario in enumerate(scenarios or [{"preconditions": [], "steps": ["unspecified"], "test_data": [], "expected_result": statement}]):
            evidence = " ".join([*scenario["preconditions"], *scenario["steps"], scenario["expected_result"]])
            negative_words = ("reject", "error", "invalid", "denied", "fail", "拒否", "エラー", "無効", "失敗", "保存されない")
            category = "nfr" if req["kind"] in {"success-criterion", "non-functional-requirement"} else "boundary" if req["kind"] == "edge-case" else "negative" if any(word in evidence.casefold() for word in negative_words) else "positive"
            legacy_keys = [source_key for (kind, source_key) in allocator.by_key if kind == "test-case" and source_key.endswith(f":{category}:{req_id}")]
            key = f"requirement:{category}:{req_id}"
            if len(scenarios) > 1:
                fingerprint = hashlib.sha256(json.dumps(scenario, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
                key += ":scenario:" + fingerprint
                # A previous undivided test cannot safely identify one branch.
                legacy_keys = []
            test_id = allocator.allocate("test-case", key, legacy_keys)
            if any(test["id"] == test_id for test in tests):
                continue
            tests.append({
                "id": test_id, "title": f"{primary['name'] if primary else req_id} — {req_id}" + (f" / 条件{position + 1}" if len(scenarios) > 1 else ""),
                "type": category, "level": "logical-acceptance", "status": "planned",
                "priority": req.get("priority", "unspecified"), **scenario,
                "automation_status": "unspecified", "basis": "derived",
                "rationale": f"{req_id}の入力記述にある条件・操作・期待結果を検証対象として保持する",
                "source_refs": req["source_refs"],
            })
            if not scenarios:
                allocator.questions.append({
                    "status": "open", "question": f"{req_id}の試験操作・事前条件・観測可能な期待結果を入力資料で具体化してください。",
                    "affected_ids": [req_id, test_id], "source_refs": req["source_refs"],
                    "return_to": "speckit.clarify",
                })
            added.append({"type": "requirement-to-test", "from_id": req_id, "to_id": test_id})
            added.extend({"type": "function-to-test", "from_id": function_id, "to_id": test_id} for function_id in function_ids)
    return sorted(tests, key=lambda item: item["id"]), dedupe_links(links + added)


def semantic_tokens(value: str) -> set[str]:
    lowered = value.casefold()
    result = tokens(value)
    compact = re.sub(r"[^\u3040-\u30ff\u3400-\u9fff]", "", value)
    result.update(compact[index:index + 2] for index in range(max(0, len(compact) - 1)))
    groups = {
        "action:create": ("create", "register", "登録", "作成", "受け付け"),
        "action:state": ("status", "state", "transition", "更新", "状態", "遷移"),
        "action:event": ("event", "notify", "notification", "通知", "イベント"),
        "action:retry": ("retry", "resend", "再送", "復旧"),
        "action:duplicate": ("duplicate", "idempoten", "重複", "冪等"),
        "action:performance": ("p95", "percentile", "性能", "応答時間", "秒以内", "分以内"),
    }
    for token, aliases in groups.items():
        if any(alias in lowered for alias in aliases):
            result.add(token)
    return result


def enrich_tests_from_plan(
    feature_dir: Path, requirements: list[dict[str, Any]], functions: list[dict[str, Any]],
    tests: list[dict[str, Any]], links: list[dict[str, str]], allocator: IdentityAllocator,
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[dict[str, Any]]]:
    """Keep unsupported design evidence visible; never guess its requirement identity."""
    from design_evidence import extract_design_scenarios

    reqs = {req["id"]: req for req in requirements if req["status"] == "current"}
    unclassified: list[dict[str, Any]] = []
    paths = [feature_dir / name for name in ("plan.md", "research.md", "data-model.md", "quickstart.md")]
    contracts = feature_dir / "contracts"
    if contracts.is_dir():
        paths.extend(sorted(path for path in contracts.rglob("*") if path.is_file()))
    for path in paths:
        if not path.is_file():
            continue
        relative = path.relative_to(feature_dir).as_posix()
        content = path.read_text(encoding="utf-8-sig")
        scenarios, consumed = extract_design_scenarios(content, set(reqs), contract=relative.startswith("contracts/"))
        unresolved = any(number not in consumed and line.strip() and not line.lstrip().startswith("#")
                         for number, line in enumerate(content.splitlines(), 1))
        for scenario in scenarios:
            explicit = scenario["requirement_ids"]
            parts = {key: scenario[key] for key in ("preconditions", "steps", "test_data", "expected_result")}
            fingerprint = hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
            # The scenario, not each (requirement, function) pair, owns the ID.
            test_id = allocator.allocate("test-case", f"enriched:{relative}:scenario:{fingerprint}")
            source_refs = sorted({*[make_source_ref(relative, number) for number in scenario["line_numbers"]],
                                  *[ref for req_id in explicit for ref in reqs[req_id]["source_refs"]]})
            existing_test = next((test for test in tests if test["id"] == test_id), None)
            if existing_test:
                existing_test["source_refs"] = sorted(set(existing_test["source_refs"] + source_refs))
            else:
                tests.append({
                    "id": test_id, "title": f"{relative} — {', '.join(explicit)}", "type": "contract" if relative.startswith("contracts/") else "state" if scenario["kind"] == "state" or path.name == "data-model.md" else "nfr" if any(reqs[identity]["kind"] in {"success-criterion", "non-functional-requirement"} for identity in explicit) else "positive",
                    "level": "contract" if relative.startswith("contracts/") else "e2e" if path.name == "quickstart.md" else "integration",
                    "status": "planned", "priority": reqs[explicit[0]].get("priority", "unspecified"),
                    **parts, "automation_status": "unspecified", "basis": "derived",
                    "rationale": "明示要件IDと設計資料の条件・操作・期待結果から導出（不足情報は推測しない）",
                    "source_refs": source_refs,
                })
            targets = sorted({link["to_id"] for link in links if link["type"] == "requirement-to-function" and link["from_id"] in explicit})
            links.extend({"type": "function-to-test", "from_id": fn_id, "to_id": test_id} for fn_id in targets)
            links.extend({"type": "requirement-to-test", "from_id": req_id, "to_id": test_id} for req_id in explicit)
        if unresolved:
            candidates = sorted(
                ((semantic_similarity(content, fn["name"]), fn["id"]) for fn in functions),
                key=lambda pair: (-pair[0], pair[1]),
            )
            unclassified.append({
                "kind": "test-evidence", "title": relative, "source_ref": make_source_ref(relative, 1),
                "content": content, "reason": "自動抽出できない設計記述を保存。候補機能は未確認: "
                    + (", ".join(identity for score, identity in candidates if score > 0) or "なし"),
            })
            allocator.questions.append({
                "status": "open", "question": f"{relative}の契約・状態・試験条件をレビューし、要件IDと操作・期待結果を入力資料へ明示してください。",
                "affected_ids": [], "source_refs": [make_source_ref(relative, 1)],
                "return_to": "speckit.plan",
            })
    return sorted(tests, key=lambda item: item["id"]), dedupe_links(links), unclassified


def dedupe_links(links: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    keyed = {(item["type"], item["from_id"], item["to_id"]): item for item in links}
    return [keyed[key] for key in sorted(keyed)]


def discover_sources(feature_dir: Path, extra_manifest: Path | None = None) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for role, relative in ARTIFACT_FILES.items():
        path = feature_dir / relative
        if path.is_file():
            sources.append({"type": role, "path": relative, "locator": "*", "sha256": sha256_file(path), "authority": "normative" if role == "spec" else "design" if role in {"plan", "research", "data-model"} else "evidence"})
    contracts = feature_dir / "contracts"
    if contracts.is_dir():
        for path in sorted(item for item in contracts.rglob("*") if item.is_file()):
            sources.append({"type": "contract", "path": path.relative_to(feature_dir).as_posix(), "locator": "*", "sha256": sha256_file(path), "authority": "design"})
    checklists = feature_dir / "checklists"
    if checklists.is_dir():
        for path in sorted(item for item in checklists.rglob("*.md") if item.is_file()):
            sources.append({"type": "checklist", "path": path.relative_to(feature_dir).as_posix(), "locator": "*", "sha256": sha256_file(path), "authority": "quality"})
    if extra_manifest:
        manifest = json.loads(extra_manifest.read_text(encoding="utf-8"))
        entries = manifest.get("extra_artifacts", manifest.get("artifacts", []))
        for item in entries:
            relative = Path(item["path"])
            path = (feature_dir / relative).resolve()
            if feature_dir.resolve() not in path.parents:
                raise ValueError(f"extra artifact escapes feature directory: {relative}")
            if not path.is_file():
                raise ValueError(f"extra artifact does not exist: {relative}")
            authority = item.get("authority") or ({"supplemental": "evidence"}.get(item.get("role")))
            if authority not in {"normative", "design", "evidence", "quality"}:
                raise ValueError(f"invalid extra artifact authority: {authority}")
            sources.append({"type": item.get("type", item.get("role", "extension")), "path": relative.as_posix(), "locator": item.get("locator", "*"), "sha256": sha256_file(path), "authority": authority, "explicit": True})
    return sorted(sources, key=lambda item: (item["type"], item["path"]))


def checklist_issues(feature_dir: Path) -> list[str]:
    issues: list[str] = []
    directory = feature_dir / "checklists"
    if not directory.is_dir():
        return issues
    for path in sorted(directory.glob("*.md")):
        for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
            if re.match(r"^\s*-\s*\[ \]", line):
                issues.append(f"{path.relative_to(feature_dir).as_posix()}#L{number}: unchecked quality item")
    return issues


def build_model(
    feature_dir: Path,
    *,
    mode: str = "auto",
    profile: str = "draft",
    existing: dict[str, Any] | None = None,
    extra_manifest: Path | None = None,
    update_proposal: bool = False,
) -> dict[str, Any]:
    if mode not in {"auto", "spec-only", "plan-enriched"}:
        raise ValueError(f"invalid mode: {mode}")
    if profile not in {"draft", "publish"}:
        raise ValueError(f"invalid profile: {profile}")
    if existing and existing.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"existing canonical schema_version must be {SCHEMA_VERSION}")
    spec_path = feature_dir / "spec.md"
    if not spec_path.is_file():
        raise ValueError(f"spec.md is required: {spec_path}")
    sources = discover_sources(feature_dir, extra_manifest)
    context, requirements, questions = extract_requirements(spec_path, existing)
    source_types = {item["type"] for item in sources}
    enriched = mode == "plan-enriched" or (mode == "auto" and {"plan", "research", "data-model", "quickstart"}.issubset(source_types))
    retained = retain_existing(existing, sources, "plan-enriched" if enriched else "spec-only", profile, update_proposal)
    if retained is not None:
        retained["report"] = evaluate_model(retained, feature_dir, profile)
        return retained
    allocator = IdentityAllocator(existing)
    functions, links = derive_functions(requirements, allocator)
    tests, links = derive_tests(requirements, functions, links, allocator, enriched)
    unclassified = list(context.pop("unclassified_sections", []))
    if enriched:
        tests, links, enrichment_unclassified = enrich_tests_from_plan(feature_dir, requirements, functions, tests, links, allocator)
        unclassified.extend(enrichment_unclassified)
    for source in sources:
        if source.get("explicit") and source.get("type") not in {"spec", "plan", "research", "data-model", "quickstart", "tasks", "contract", "checklist"}:
            extra_path = feature_dir / source["path"]
            unclassified.append({
                "kind": "extra-artifact",
                "title": source["type"],
                "source_ref": make_source_ref(source["path"], 1),
                "content": extra_path.read_text(encoding="utf-8-sig"),
                "reason": "未知種別のため既知成果物へ自動変換しない",
            })
    registry: list[dict[str, Any]] = []
    for (kind, source_key), identity in sorted(allocator.by_key.items(), key=lambda item: item[1]):
        if (kind, source_key) not in allocator.active_keys:
            continue
        registry.append({"id": identity, "kind": kind, "source_key": source_key, "lifecycle": "active", "aliases": []})
    for req in requirements:
        identity_text = req["statement"] + ((req.get("parent_id") or "") if req["kind"] == "acceptance-scenario" else "")
        source_key = f"{req['kind']}:{hashlib.sha256(identity_text.encode('utf-8')).hexdigest()}"
        if any(entry.get("source_key") == source_key and entry.get("kind") == "requirement" for entry in registry):
            source_key += ":" + req["id"]
        registry.append({"id": req["id"], "kind": "requirement", "source_key": source_key, "lifecycle": "active", "aliases": []})
    if existing:
        active = {entry["id"] for entry in registry}
        for old in existing.get("identity_registry", []):
            if old.get("id") not in active:
                retired = dict(old)
                retired["lifecycle"] = "retired"
                if any(entry.get("kind") == retired.get("kind") and entry.get("source_key") == retired.get("source_key") for entry in registry):
                    retired["source_key"] = str(retired.get("source_key")) + ":retired:" + str(retired.get("id"))
                registry.append(retired)
    for question in allocator.questions:
        question["id"] = f"Q-{len(questions) + 1:03d}"
        questions.append(question)
    change_impact: list[dict[str, Any]] = []
    if existing:
        old_requirement_entries = [entry for entry in existing.get("identity_registry", []) if entry.get("kind") == "requirement" and entry.get("lifecycle", "active") == "active"]
        current_requirement_ids = {item["id"] for item in requirements}
        removed = [entry for entry in old_requirement_entries if entry.get("id") not in current_requirement_ids]
        old_ids = {entry.get("id") for entry in old_requirement_entries}
        added = [item for item in requirements if item["id"] not in old_ids]
        for entry in removed:
            change_impact.append({"id": entry.get("id"), "change": "retired", "source_key": entry.get("source_key"), "impact": "対応する機能・テストの再確認が必要"})
        if removed and added:
            questions.append({
                "id": f"Q-{len(questions) + 1:03d}",
                "status": "open",
                "question": "未付番要素の削除と追加を検出しました。rename/moveか別要素か確認してください。",
                "affected_ids": sorted([str(item.get("id")) for item in removed] + [item["id"] for item in added]),
                "source_refs": ["spec.md#L1"],
                "return_to": "identity-review",
            })
    model: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "speckit_compatibility": SPECKIT_COMPATIBILITY,
        "tested_versions": TESTED_VERSIONS,
        "title": context["title"],
        "mode": "plan-enriched" if enriched else "spec-only",
        "profile": profile,
        "sources": sources,
        "identity_registry": sorted(registry, key=lambda item: item["id"]),
        "context": context,
        "requirements": requirements,
        "functions": functions,
        "test_cases": tests,
        "links": links,
        "unclassified": unclassified,
        "open_questions": questions,
        "change_impact": change_impact,
        "report": {},
    }
    questions.append({"id": f"Q-{len(questions) + 1:03d}", "status": "open", "question": "入力資料と全要件・機能・テストの意味対応を独立レビューし、根拠と判断を記録してください。", "affected_ids": [], "source_refs": ["spec.md#L1"], "return_to": "semantic-review"})
    if existing:
        old_requirements = {item["id"]: item for item in existing["requirements"]}
        for item in requirements:
            previous = old_requirements.get(item["id"])
            if previous and previous != item:
                change_impact.append({"id": item["id"], "change": "modified", "impact": "要件本文・属性・根拠位置が変更されています。対応する機能・テストを再確認してください。"})
        if update_proposal:
            questions.append({"id": f"Q-{len(questions) + 1:03d}", "status": "open", "question": "これは更新案です。既存JSONの機能分割、リンク、具体化したテスト、解決済み判断を比較し、必要な修正を引き継いでください。旧資料は変更していません。", "affected_ids": [], "source_refs": ["spec.md#L1"], "return_to": "update-review"})
    model["generation_digest"] = editorial_digest(model)
    model["report"] = evaluate_model(model, feature_dir, profile)
    return model


def evaluate_model(model: dict[str, Any], feature_dir: Path | None = None, profile: str = "draft") -> dict[str, Any]:
    if profile not in {"draft", "publish"}:
        raise ValueError(f"invalid profile: {profile}")
    axes = {name: {"status": "passed", "errors": [], "warnings": [], "metrics": {}} for name in (
        "source_integrity",
        "requirements_quality",
        "function_coverage",
        "test_coverage",
        "cross_artifact_consistency",
        "render_reproducibility",
    )}
    raw_requirements = model.get("requirements", [])
    raw_functions = model.get("functions", [])
    raw_tests = model.get("test_cases", [])
    reqs = {item.get("id"): item for item in raw_requirements}
    funcs = {item.get("id"): item for item in raw_functions}
    tests = {item.get("id"): item for item in raw_tests}
    if model.get("schema_version") != SCHEMA_VERSION:
        axes["source_integrity"]["errors"].append(f"schema_version must be {SCHEMA_VERSION}")
    if model.get("speckit_compatibility") != SPECKIT_COMPATIBILITY:
        axes["source_integrity"]["errors"].append(f"speckit_compatibility must be {SPECKIT_COMPATIBILITY}")
    if len([item for item in model.get("sources", []) if item.get("type") == "spec"]) != 1:
        axes["source_integrity"]["errors"].append("exactly one spec source is required")
    if feature_dir:
        root = feature_dir.resolve()
        for source in model.get("sources", []):
            path = (root / str(source.get("path", ""))).resolve()
            if root not in path.parents and path != root:
                axes["source_integrity"]["errors"].append(f"source escapes feature directory: {source.get('path')}")
            elif not path.is_file():
                axes["source_integrity"]["errors"].append(f"source missing: {source.get('path')}")
            elif sha256_file(path) != source.get("sha256"):
                axes["source_integrity"]["errors"].append(f"source fingerprint is stale: {source.get('path')}")
    ids = [item.get("id") for item in raw_requirements + raw_functions + raw_tests]
    if len(ids) != len(set(ids)) or None in ids:
        axes["source_integrity"]["errors"].append("IDs must be present and globally unique")
    registry = model.get("identity_registry", [])
    registry_ids = [item.get("id") for item in registry]
    registry_keys = [(item.get("kind"), item.get("source_key")) for item in registry]
    if len(registry_ids) != len(set(registry_ids)) or len(registry_keys) != len(set(registry_keys)):
        axes["source_integrity"]["errors"].append("identity_registry IDs and source keys must be unique")
    for entry in registry:
        if entry.get("kind") not in {"requirement", "function", "test-case"} or entry.get("lifecycle") not in {"active", "retired"}:
            axes["source_integrity"]["errors"].append(f"invalid identity_registry entry: {entry.get('id')}")
    expected_registry = {(item["id"], kind) for collection, kind in (
        (raw_requirements, "requirement"), (raw_functions, "function"), (raw_tests, "test-case")
    ) for item in collection}
    active_registry = {(entry.get("id"), entry.get("kind")) for entry in registry if entry.get("lifecycle") == "active"}
    if expected_registry != active_registry:
        axes["source_integrity"]["errors"].append("active identity_registry must match all requirement/function/test IDs and kinds")
    req_kinds = {"user-story", "acceptance-scenario", "functional-requirement", "non-functional-requirement", "edge-case", "success-criterion", "assumption", "clarification", "out-of-scope", "other"}
    req_statuses = {"current", "future", "out-of-scope", "retired", "blocked"}
    bases = {"specified", "derived", "confirmed"}
    for req in reqs.values():
        if req.get("kind") not in req_kinds or req.get("status") not in req_statuses or req.get("basis") not in bases:
            axes["requirements_quality"]["errors"].append(f"{req.get('id')}: invalid kind/status/basis")
        if not req.get("statement") or not req.get("source_refs"):
            axes["requirements_quality"]["errors"].append(f"{req.get('id')}: statement/source_refs required")
        if req.get("status") == "blocked":
            message = f"{req.get('id')}: unresolved requirement"
            (axes["requirements_quality"]["errors"] if profile == "publish" else axes["requirements_quality"]["warnings"]).append(message)
        if req.get("kind") == "success-criterion" and not re.search(r"\d|以内|以上|以下|measur|percent|率|秒|分|件", req.get("statement", ""), re.I):
            axes["requirements_quality"]["warnings"].append(f"{req.get('id')}: success criterion may not be measurable")
            if profile == "publish":
                axes["requirements_quality"]["errors"].append(f"{req.get('id')}: success criterion is not measurable")
    for item in model.get("unclassified", []):
        axes["requirements_quality"]["warnings"].append(f"unclassified section: {item.get('title')} ({item.get('source_ref')})")
    if any(question.get("status", "open") == "open" for question in model.get("open_questions", [])):
        axes["requirements_quality"]["errors" if profile == "publish" else "warnings"].append("open questions must be resolved before publish")
    for question in model.get("open_questions", []):
        resolution = question.get("resolution")
        if question.get("status") == "resolved" and (not isinstance(resolution, str) or not resolution.strip() or not question.get("source_refs")):
            axes["requirements_quality"]["errors" if profile == "publish" else "warnings"].append(f"{question.get('id')}: resolved question requires resolution and source_refs")
    if not any(question.get("return_to") == "semantic-review" for question in model.get("open_questions", [])):
        axes["requirements_quality"]["errors" if profile == "publish" else "warnings"].append("independent semantic review record is required before publish")
    review_problem = review_issue(model)
    if review_problem:
        axes["requirements_quality"]["errors" if profile == "publish" else "warnings"].append(review_problem)
    req_to_fn = {(item.get("from_id"), item.get("to_id")) for item in model.get("links", []) if item.get("type") == "requirement-to-function"}
    fn_to_test = {(item.get("from_id"), item.get("to_id")) for item in model.get("links", []) if item.get("type") == "function-to-test"}
    req_to_test = {(item.get("from_id"), item.get("to_id")) for item in model.get("links", []) if item.get("type") == "requirement-to-test"}
    current_req_ids = {identity for identity, req in reqs.items() if req.get("kind") in CURRENT_REQUIREMENT_KINDS and req.get("status") == "current"}
    current_fn_ids = {identity for identity, fn in funcs.items() if fn.get("status") == "current"}
    for req in reqs.values():
        if req["id"] in current_req_ids and not any(left == req["id"] and right in current_fn_ids for left, right in req_to_fn):
            axes["function_coverage"]["errors"].append(f"{req['id']}: no function coverage")
    for fn in funcs.values():
        if fn.get("status") not in {"current", "future", "retired"} or fn.get("basis") not in bases:
            axes["function_coverage"]["errors"].append(f"{fn.get('id')}: invalid status/basis")
        if fn.get("status") == "current" and fn.get("basis") == "derived":
            axes["function_coverage"]["errors" if profile == "publish" else "warnings"].append(f"{fn.get('id')}: derived function boundary requires confirmation")
        linked_req_ids = {left for left, right in req_to_fn if right == fn["id"]}
        if not linked_req_ids:
            axes["function_coverage"]["errors"].append(f"{fn['id']}: orphan function")
        if fn.get("status") == "current" and not linked_req_ids.intersection(current_req_ids):
            axes["function_coverage"]["errors"].append(f"{fn['id']}: current function has no current requirement")
        if len(linked_req_ids) == 1 and len(current_req_ids) > 1 and fn.get("basis") == "derived":
            only_req = reqs.get(next(iter(linked_req_ids)), {})
            if normalize_text(str(fn.get("name", ""))) == normalize_text(str(only_req.get("statement", ""))):
                message = f"{fn['id']}: derived function mirrors a single requirement"
                axes["function_coverage"]["errors" if profile == "publish" else "warnings"].append(message)
        if not any(left == fn["id"] for left, _ in fn_to_test):
            axes["test_coverage"]["errors"].append(f"{fn['id']}: no test coverage")
    for test in tests.values():
        if test.get("type") not in {"positive", "alternative", "negative", "boundary", "nfr", "contract", "state", "normal"} or test.get("level") not in {"logical-acceptance", "unit", "integration", "contract", "e2e", "performance", "security", "operational", "manual-review"} or test.get("basis") not in bases:
            axes["test_coverage"]["errors"].append(f"{test.get('id')}: invalid type/level/basis")
        if not test.get("expected_result") or not test.get("steps"):
            axes["test_coverage"]["errors"].append(f"{test.get('id')}: steps/expected_result required")
        missing_fields = missing_test_fields(test)
        if missing_fields:
            axes["test_coverage"]["errors" if profile == "publish" else "warnings"].append(f"{test.get('id')}: concrete test operation/expectation is unresolved ({', '.join(missing_fields)})")
        if not any(right == test["id"] for _, right in fn_to_test):
            axes["test_coverage"]["errors"].append(f"{test['id']}: orphan test")
        if not any(right == test["id"] for _, right in req_to_test):
            axes["test_coverage"]["errors"].append(f"{test['id']}: no direct requirement link")
    for req in reqs.values():
        if req.get("kind") in CURRENT_REQUIREMENT_KINDS and req.get("status") == "current" and not any(left == req["id"] for left, _ in req_to_test):
            axes["test_coverage"]["errors"].append(f"{req['id']}: current requirement has no direct test")
        if req["id"] in current_req_ids:
            related_current_functions = {fn_id for req_id, fn_id in req_to_fn if req_id == req["id"] and fn_id in current_fn_ids}
            related_tests = {test_id for req_id, test_id in req_to_test if req_id == req["id"]}
            if not any(fn_id in related_current_functions and test_id in related_tests for fn_id, test_id in fn_to_test):
                axes["test_coverage"]["errors"].append(f"{req['id']}: no test through a current function")
    raw_links = model.get("links", [])
    link_keys = [(item.get("type"), item.get("from_id"), item.get("to_id")) for item in raw_links]
    if len(link_keys) != len(set(link_keys)):
        axes["cross_artifact_consistency"]["errors"].append("duplicate links are not allowed")
    for link in raw_links:
        left, right, kind = link.get("from_id"), link.get("to_id"), link.get("type")
        valid = (kind == "requirement-to-function" and left in reqs and right in funcs) or (kind == "function-to-test" and left in funcs and right in tests) or (kind == "requirement-to-test" and left in reqs and right in tests)
        if not valid:
            axes["cross_artifact_consistency"]["errors"].append(f"invalid link: {kind} {left} -> {right}")
        if left == right:
            axes["cross_artifact_consistency"]["errors"].append(f"self link is not allowed: {left}")
    for collection_name, collection in (("requirements", raw_requirements), ("functions", raw_functions), ("test_cases", raw_tests)):
        for item in collection:
            if item.get("basis") == "derived" and not item.get("rationale"):
                axes["cross_artifact_consistency"]["errors"].append(f"{item.get('id')}: derived item requires rationale")
            if not item.get("source_refs"):
                axes["source_integrity"]["errors"].append(f"{item.get('id')}: source_refs required")
            if feature_dir:
                declared_sources = {str(source.get("path", "")) for source in model.get("sources", [])}
                feature_root = feature_dir.resolve()
                for source_ref in item.get("source_refs", []):
                    match = re.fullmatch(r"([^#]+)#L([1-9]\d*)", source_ref)
                    if not match:
                        axes["source_integrity"]["errors"].append(f"{item.get('id')}: invalid source locator {source_ref}")
                        continue
                    source_path = (feature_dir / match.group(1)).resolve()
                    if match.group(1) not in declared_sources:
                        axes["source_integrity"]["errors"].append(f"{item.get('id')}: source locator is not declared {source_ref}")
                    elif feature_root not in source_path.parents or not source_path.is_file() or int(match.group(2)) > len(source_path.read_text(encoding="utf-8-sig").splitlines()):
                        axes["source_integrity"]["errors"].append(f"{item.get('id')}: unresolved source locator {source_ref}")
    for test_id in tests:
        target_functions = {fn_id for fn_id, linked_test in fn_to_test if linked_test == test_id}
        test_requirements = {req_id for req_id, linked_test in req_to_test if linked_test == test_id}
        upstream_requirements = {req_id for req_id, linked_fn in req_to_fn if linked_fn in target_functions}
        if not test_requirements.issubset(upstream_requirements):
            axes["cross_artifact_consistency"]["errors"].append(f"{test_id}: requirement link is inconsistent with target functions")
        for fn_id in sorted(target_functions):
            fn_requirements = {req_id for req_id, linked_fn in req_to_fn if linked_fn == fn_id}
            if not test_requirements.intersection(fn_requirements):
                axes["cross_artifact_consistency"]["errors"].append(f"{test_id}: requirement link is inconsistent with {fn_id}")
    if model.get("mode") == "plan-enriched":
        types = {item.get("type") for item in model.get("sources", [])}
        missing = sorted({"plan", "research", "data-model", "quickstart"} - types)
        if missing:
            axes["cross_artifact_consistency"]["errors"].append("plan-enriched sources missing: " + ", ".join(missing))
    if feature_dir:
        for issue in checklist_issues(feature_dir):
            axes["requirements_quality"]["warnings"].append(issue)
            if profile == "publish":
                axes["requirements_quality"]["errors"].append(issue)
    for axis in axes.values():
        axis["metrics"] = {"errors": len(axis["errors"]), "warnings": len(axis["warnings"])}
        if axis["errors"]:
            axis["status"] = "failed"
    blocking = sum(len(axis["errors"]) for axis in axes.values())
    return {"status": "blocked" if blocking else "draft-ready" if profile == "draft" else "publishable", "profile": profile, "axes": axes, "blocking_errors": blocking}


def json_text(model: dict[str, Any]) -> str:
    return json.dumps(model, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
