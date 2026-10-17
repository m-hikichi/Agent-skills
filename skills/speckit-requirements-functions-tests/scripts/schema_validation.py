"""Validate the bundled JSON Schema subset and fingerprinted source locators.

This deliberately supports only keywords used by canonical.schema.json. Unknown
validation keywords fail closed so schema changes cannot silently weaken checks.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "references" / "canonical.schema.json"
KEYWORDS = {"$schema", "$id", "$defs", "$ref", "title", "description", "type", "const", "enum", "allOf", "required", "properties", "additionalProperties", "items", "minItems", "uniqueItems", "minLength", "pattern", "minimum"}


def validate_schema(model: Any) -> list[str]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors: list[str] = []

    def equal(a: Any, b: Any) -> bool:
        return type(a) is type(b) and a == b

    def visit(value: Any, rule: dict[str, Any], location: str) -> None:
        unknown = set(rule) - KEYWORDS
        if unknown:
            raise ValueError("unsupported schema keywords: " + ", ".join(sorted(unknown)))
        if "$ref" in rule:
            reference = rule["$ref"]
            if not reference.startswith("#/"):
                raise ValueError("only local schema references are supported")
            target = schema
            for component in reference[2:].split("/"):
                target = target[component.replace("~1", "/").replace("~0", "~")]
            visit(value, target, location)
        for child in rule.get("allOf", []):
            visit(value, child, location)
        types = rule.get("type", [])
        types = [types] if isinstance(types, str) else types
        matches = {"object": isinstance(value, dict), "array": isinstance(value, list), "string": isinstance(value, str), "boolean": isinstance(value, bool), "integer": type(value) is int, "number": type(value) in (int, float), "null": value is None}
        if types and not any(matches.get(kind, False) for kind in types):
            errors.append(f"{location}: expected {'/'.join(types)}")
            return
        if "const" in rule and not equal(value, rule["const"]):
            errors.append(f"{location}: invalid constant")
        if "enum" in rule and not any(equal(value, choice) for choice in rule["enum"]):
            errors.append(f"{location}: invalid enum value")
        if isinstance(value, dict):
            for key in rule.get("required", []):
                if key not in value:
                    errors.append(f"{location}.{key}: required")
            properties = rule.get("properties", {})
            for key, child in value.items():
                if key in properties:
                    visit(child, properties[key], f"{location}.{key}")
                elif rule.get("additionalProperties") is False:
                    errors.append(f"{location}.{key}: unexpected property")
                elif isinstance(rule.get("additionalProperties"), dict):
                    visit(child, rule["additionalProperties"], f"{location}.{key}")
        if isinstance(value, list):
            if len(value) < rule.get("minItems", 0):
                errors.append(f"{location}: too few items")
            if rule.get("uniqueItems") and len({json.dumps(item, sort_keys=True) for item in value}) != len(value):
                errors.append(f"{location}: duplicate items")
            for index, item in enumerate(value):
                if "items" in rule:
                    visit(item, rule["items"], f"{location}[{index}]")
        if isinstance(value, str):
            if len(value) < rule.get("minLength", 0):
                errors.append(f"{location}: empty string")
            if "pattern" in rule and re.search(rule["pattern"], value) is None:
                errors.append(f"{location}: invalid pattern")
        if type(value) in (int, float) and "minimum" in rule and value < rule["minimum"]:
            errors.append(f"{location}: below minimum")

    visit(model, schema, "$")
    return errors


def validate_source_refs(model: dict[str, Any], feature_dir: Path) -> list[str]:
    root = feature_dir.resolve()
    errors: list[str] = []
    declared: dict[str, Path] = {}
    for source in model.get("sources", []):
        name = source.get("path", "")
        path = (root / name).resolve()
        if not name or Path(name).is_absolute() or root not in path.parents:
            errors.append(f"source escapes feature directory: {name}")
            continue
        if name in declared:
            errors.append(f"duplicate source path: {name}")
        declared[name] = path
        if not path.is_file():
            errors.append(f"source missing: {name}")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != source.get("sha256"):
            errors.append(f"source fingerprint is stale: {name}")

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            raw_refs = value.get("source_refs", [])
            if not isinstance(raw_refs, list):
                errors.append("source_refs must be an array")
                raw_refs = []
            references = list(raw_refs)
            if "source_ref" in value:
                references.append(value["source_ref"])
            for reference in references:
                match = re.fullmatch(r"([^#]+)#L([1-9]\d*)", reference) if isinstance(reference, str) else None
                if not match:
                    errors.append(f"invalid source locator: {reference}")
                    continue
                name, line = match.groups()
                path = declared.get(name)
                if path is None:
                    errors.append(f"source locator is not in fingerprinted sources: {reference}")
                elif path.is_file() and int(line) > len(path.read_text(encoding="utf-8-sig").splitlines()):
                    errors.append(f"unresolved source locator: {reference}")
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(model)
    return sorted(set(errors))


def require_valid_model(model: Any, feature_dir: Path | None = None) -> None:
    errors = validate_schema(model)
    if not errors and feature_dir is not None:
        errors.extend(validate_source_refs(model, feature_dir))
    if errors:
        raise ValueError("invalid canonical model: " + "; ".join(errors))
