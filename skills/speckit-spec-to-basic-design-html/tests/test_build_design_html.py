import copy
import importlib.util
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).parents[1]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "evals" / "fixtures"
sys.path.insert(0, str(SCRIPTS))


def load(name):
    path = SCRIPTS / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


QUALITY = load("design_quality")
BUILD = load("build_design_html")
CHECK = load("check_design_html")
MIGRATE = load("migrate_design")


def valid_config(spec_text):
    items = QUALITY.extract_normative_items(spec_text)
    current = [i["id"] for i in items if i["source_status"] == "current"]
    future = [i["id"] for i in items if i["source_status"] == "future"]
    excluded = [i["id"] for i in items if i["source_status"] == "out-of-scope"]
    first_current = next(i for i in current if i.startswith("FR-"))
    first_future = next((i for i in future if i.startswith("FR-")), future[0] if future else first_current)

    rows = [
        {
            "id": "FNC-001",
            "name": "備品貸出管理",
            "summary": "現行要件に基づいて備品の利用を管理する",
            "actors": ["利用者", "管理者"],
            "trigger": "利用者または管理者が操作を開始する",
            "execution": {"type": "screen", "refs": ["SCR-001"]},
            "inputs": ["操作内容"],
            "outputs": ["処理結果"],
            "preconditions": ["認証済みである"],
            "postconditions": ["処理結果が保存される"],
            "business_rules": [
                {
                    "id": "BR-001-01",
                    "text": "specに定義された現行要件を満たす",
                    "basis": "specified",
                    "source_refs": [first_current],
                }
            ],
            "exceptions": [
                {"condition": "入力不正", "behavior": "処理を中止する", "basis": "specified", "source_refs": [first_current]}
            ],
            "data_entities": ["備品", "予約", "貸出"],
            "source_refs": current,
            "status": "current",
        }
    ]
    if future:
        rows.append(
            {
                "id": "FNC-002",
                "name": "将来レポート出力",
                "summary": "将来提供する利用実績を出力する",
                "actors": ["管理者"],
                "trigger": "管理者が出力を要求する",
                "execution": {"type": "screen", "refs": ["SCR-002"]},
                "inputs": ["対象月"],
                "outputs": ["CSVファイル"],
                "preconditions": ["管理者である"],
                "postconditions": ["CSVが出力される"],
                "business_rules": [
                    {
                        "id": "BR-002-01",
                        "text": "将来要件に従って出力する",
                        "basis": "specified",
                        "source_refs": [first_future],
                    }
                ],
                "exceptions": [],
                "data_entities": ["利用実績"],
                "source_refs": future,
                "status": "future",
            }
        )

    traceability = []
    for item in items:
        if item["id"] in current:
            coverage, function_ids = "covered", ["FNC-001"]
        elif item["id"] in future:
            coverage, function_ids = "future", ["FNC-002"]
        else:
            coverage, function_ids = "out-of-scope", []
        traceability.append(
            {
                "source_id": item["id"],
                "function_ids": function_ids,
                "coverage": coverage,
                "rationale": "テスト用の対応根拠",
            }
        )
    return {
        "schema_version": 2,
        "source": {"spec": "spec.md"},
        "title": "備品貸出管理 機能一覧",
        "meta": {"作成日": "2026-06-01", "更新日": "2026-07-05"},
        "interfaces": [
            {"id": "SCR-001", "type": "screen", "name": "備品管理画面", "summary": "備品を操作する", "actors": ["利用者", "管理者"], "status": "current"},
            {"id": "SCR-002", "type": "screen", "name": "レポート画面", "summary": "CSVを出力する", "actors": ["管理者"], "status": "future"},
        ],
        "function_list": [
            {
                "name": "備品利用",
                "id": "01",
                "children": [
                    {
                        "name": "貸出管理",
                        "id": "01",
                        "children": [{"name": "業務処理", "id": "01", "rows": rows}],
                    }
                ],
            }
        ],
        "traceability": traceability,
        "decisions": [],
        "open_questions": [],
    }


class DesignQualityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec_text = (FIXTURES / "equipment-lending-spec.md").read_text(encoding="utf-8")

    def test_extracts_all_normative_types_including_bold_acceptance_heading(self):
        items = QUALITY.extract_normative_items(self.spec_text)
        types = {item["type"] for item in items}
        self.assertTrue(
            {
                "functional-requirement",
                "user-story",
                "acceptance-scenario",
                "edge-case",
                "clarification",
                "assumption",
                "success-criterion",
                "out-of-scope",
            }.issubset(types)
        )
        self.assertEqual(13, sum(item["type"] == "functional-requirement" for item in items))
        self.assertGreaterEqual(sum(item["type"] == "acceptance-scenario" for item in items), 5)

    def test_valid_v2_design_passes_and_reports_full_coverage(self):
        cfg = valid_config(self.spec_text)
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertEqual([], report["errors"])
        self.assertEqual("passed", report["status"])
        self.assertTrue(all(v["percent"] == 100.0 for v in report["coverage"].values()))

    def test_missing_traceability_is_blocking(self):
        cfg = valid_config(self.spec_text)
        missing = cfg["traceability"].pop()
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertTrue(any(missing["source_id"] in error and "未追跡" in error for error in report["errors"]))

    def test_rule_without_source_is_blocking(self):
        cfg = valid_config(self.spec_text)
        cfg["function_list"][0]["children"][0]["children"][0]["rows"][0]["business_rules"][0]["source_refs"] = []
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertTrue(any("業務ルール1に根拠がありません" in error for error in report["errors"]))

    def test_derived_rule_requires_rationale(self):
        cfg = valid_config(self.spec_text)
        rule = cfg["function_list"][0]["children"][0]["children"][0]["rows"][0]["business_rules"][0]
        rule["basis"] = "derived"
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertTrue(any("rationale" in error for error in report["errors"]))

    def test_exception_requires_basis_and_derived_rationale(self):
        cfg = valid_config(self.spec_text)
        exception = cfg["function_list"][0]["children"][0]["children"][0]["rows"][0]["exceptions"][0]
        exception.pop("basis")
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertTrue(any("例外1のbasis" in error for error in report["errors"]))
        exception["basis"] = "derived"
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertTrue(any("導出した例外1にrationale" in error for error in report["errors"]))

    def test_open_question_blocks_final_design(self):
        cfg = valid_config(self.spec_text)
        cfg["open_questions"] = [{"id": "Q-001", "severity": "blocking", "question": "上限値は？"}]
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertTrue(any("ユーザー確認" in error for error in report["errors"]))

    def test_execution_type_must_match_interface(self):
        cfg = valid_config(self.spec_text)
        function = cfg["function_list"][0]["children"][0]["children"][0]["rows"][0]
        function["execution"]["type"] = "api"
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertTrue(any("type=api" in error for error in report["errors"]))

    def test_current_function_cannot_only_reference_future_requirement(self):
        cfg = valid_config(self.spec_text)
        current = cfg["function_list"][0]["children"][0]["children"][0]["rows"][0]
        future = cfg["function_list"][0]["children"][0]["children"][0]["rows"][1]
        current["source_refs"] = future["source_refs"]
        current["business_rules"][0]["source_refs"] = [future["source_refs"][0]]
        _, report, _ = QUALITY.validate_design(self.spec_text, cfg)
        self.assertTrue(any("将来・対象外の根拠だけ" in error for error in report["errors"]))

    def test_confirmation_is_appended_and_reextractable(self):
        updated, clarification_id = QUALITY.append_clarification(
            self.spec_text, "通知時刻はいつか", "毎日09:00", "2026-07-05"
        )
        self.assertIn("### Session 2026-07-05", updated)
        self.assertIn(clarification_id, updated)
        items = QUALITY.extract_normative_items(updated)
        self.assertIn(clarification_id, {item["id"] for item in items})

    def test_api_event_fixture_distinguishes_future_and_out_of_scope(self):
        spec_text = (FIXTURES / "api-order-spec.md").read_text(encoding="utf-8")
        items = {item["id"]: item for item in QUALITY.extract_normative_items(spec_text)}
        self.assertEqual("future", items["FR-040"]["source_status"])
        out_items = [item for item in items.values() if item["type"] == "out-of-scope"]
        self.assertTrue(any(item["source_status"] == "out-of-scope" for item in out_items))
        self.assertTrue(any(item["source_status"] == "future" for item in out_items))

    def test_ambiguous_fixture_contains_normative_items_that_require_design_review(self):
        spec_text = (FIXTURES / "ambiguous-approval-spec.md").read_text(encoding="utf-8")
        items = QUALITY.extract_normative_items(spec_text)
        edge_text = " ".join(item["text"] for item in items if item["type"] == "edge-case")
        self.assertIn("代理承認者", edge_text)
        self.assertIn("適切に再送", edge_text)
        findings = QUALITY.detect_ambiguities(items)
        reasons = {finding["reason"] for finding in findings}
        self.assertIn("代理者の決定方法", reasons)
        self.assertIn("再送回数・間隔・終了条件", reasons)
        cfg = valid_config(spec_text)
        _, report, _ = QUALITY.validate_design(spec_text, cfg)
        self.assertTrue(any("未確認の曖昧さ" in error for error in report["errors"]))

    def test_multiline_requirements_and_acceptance_are_joined(self):
        spec = """# Feature Specification: 複数行
## User Scenarios & Testing
### User Story 1 - 登録する
**Acceptance Scenarios**:
1. Given 正常な入力、When 登録する、
   Then 受付番号が返る。
## Requirements
- **FR-001 (MUST)**: 利用者は複数行にわたる
  要求を登録できなければならない。
"""
        items = {item["id"]: item for item in QUALITY.extract_normative_items(spec)}
        self.assertIn("受付番号が返る", items["AC-001-01"]["text"])
        self.assertIn("複数行にわたる 要求", items["FR-001"]["text"])

    def test_source_catalog_preserves_ids_when_item_is_inserted(self):
        original = """# Feature Specification: ID安定性
### Edge Cases
- 既存ケースA
- 既存ケースB
"""
        first = QUALITY.extract_normative_items(original)
        catalog = QUALITY.build_source_catalog(first)
        changed = original.replace("- 既存ケースA", "- 新規ケース\n- 既存ケースA")
        second = QUALITY.extract_normative_items(changed, catalog)
        by_text = {item["text"]: item["id"] for item in second}
        self.assertEqual("EC-001", by_text["既存ケースA"])
        self.assertEqual("EC-002", by_text["既存ケースB"])
        self.assertEqual("EC-003", by_text["新規ケース"])

    def test_answered_question_blocks_until_design_references_confirmation(self):
        cfg = valid_config(self.spec_text)
        cfg["open_questions"] = [
            {"id": "Q-001", "severity": "blocking", "function_ids": ["FNC-001"], "question": "通知時刻はいつか"}
        ]
        updated_spec, answered, clarification_id = QUALITY.record_confirmation(
            self.spec_text, cfg, "Q-001", "毎日09:00", "2026-07-05"
        )
        _, report, _ = QUALITY.validate_design(updated_spec, answered)
        self.assertTrue(any("ユーザー確認" in error for error in report["errors"]))

        function = QUALITY.flatten_functions(answered)[0][3]
        function["source_refs"].append(clarification_id)
        answered["traceability"].append(
            {"source_id": clarification_id, "function_ids": ["FNC-001"], "coverage": "covered", "rationale": "確認回答を反映"}
        )
        resolved = QUALITY.mark_question_resolved(answered, "Q-001")
        _, report, _ = QUALITY.validate_design(updated_spec, resolved)
        self.assertEqual([], report["errors"])

    def test_hand_authored_api_design_has_expected_semantic_mapping(self):
        spec_text = (FIXTURES / "api-order-spec.md").read_text(encoding="utf-8")
        cfg = __import__("json").loads((FIXTURES / "api-order-design.json").read_text(encoding="utf-8"))
        _, report, _ = QUALITY.validate_design(spec_text, cfg)
        self.assertEqual([], report["errors"])
        functions = {row[3]["id"]: row[3] for row in QUALITY.flatten_functions(cfg)}
        self.assertEqual(
            {
                "FNC-001": "api",
                "FNC-002": "api",
                "FNC-003": "event",
                "FNC-004": "external-interface",
                "FNC-005": "batch",
                "FNC-006": "batch",
                "FNC-007": "api",
            },
            {fid: function["execution"]["type"] for fid, function in functions.items()},
        )
        trace = {entry["source_id"]: set(entry["function_ids"]) for entry in cfg["traceability"]}
        self.assertEqual({"FNC-002"}, trace["FR-002"])
        self.assertEqual({"FNC-003"}, trace["FR-010"] | trace["FR-011"])
        self.assertEqual({"FNC-004", "FNC-005"}, trace["FR-021"])
        self.assertEqual({"FNC-006"}, trace["FR-030"])
        self.assertEqual("future", functions["FNC-007"]["status"])


class RenderAndCompatibilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec_text = (FIXTURES / "equipment-lending-spec.md").read_text(encoding="utf-8")

    def test_v2_render_has_five_accessible_panels_and_is_deterministic(self):
        cfg = valid_config(self.spec_text)
        first, report = BUILD.render(cfg, self.spec_text, allow_draft=False)
        second, _ = BUILD.render(cfg, self.spec_text, allow_draft=False)
        self.assertEqual(first, second)
        self.assertEqual("passed", report["status"])
        for panel in CHECK.REQUIRED_V2_PANELS:
            self.assertIn(f'id="{panel}"', first)
        self.assertIn('role="tablist"', first)
        self.assertIn('aria-controls="panel-details"', first)
        self.assertIn('id="detail-FNC-001"', first)
        self.assertNotIn(" style=", first)
        errors, _ = CHECK.check_html_structure(first, require_v2=True)
        self.assertEqual([], errors)

    def test_v1_normalization_assigns_ids_and_blocking_questions(self):
        legacy = {
            "screens": [{"id": "SCR-001", "name": "貸出画面"}],
            "function_list": [
                {
                    "name": "貸出",
                    "id": "01",
                    "children": [
                        {
                            "name": "受付",
                            "id": "01",
                            "children": [
                                {
                                    "name": "処理",
                                    "id": "01",
                                    "rows": [
                                        {"機能名": "貸出登録", "概要": "貸出を登録する", "業務ルール": ["認証済み"], "画面": ["SCR-001"], "FR": "FR-001"}
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ],
        }
        cfg = QUALITY.normalize_config(legacy)
        function = QUALITY.flatten_functions(cfg)[0][3]
        self.assertEqual(2, cfg["schema_version"])
        self.assertEqual("FNC-001", function["id"])
        self.assertEqual("screen", function["execution"]["type"])
        self.assertTrue(cfg["open_questions"])

    def test_committed_legacy_html_migrates_without_losing_rows(self):
        html_text = (FIXTURES / "備品貸出管理デモ_基本設計_機能一覧.html").read_text(encoding="utf-8")
        cfg = MIGRATE.migrate(self.spec_text, html_text, "sample.html")
        self.assertEqual(13, len(QUALITY.flatten_functions(cfg)))
        first = QUALITY.flatten_functions(cfg)[0][3]
        self.assertEqual("FNC-001", first["id"])
        self.assertEqual("利用者認証", first["name"])
        self.assertTrue(cfg["traceability"])
        self.assertTrue(cfg["open_questions"])
        self.assertLess(len(cfg["open_questions"]), 13)

    def test_legacy_sample_still_passes_compatibility_checker(self):
        html_text = (FIXTURES / "備品貸出管理デモ_基本設計_機能一覧.html").read_text(encoding="utf-8")
        errors, warnings = CHECK.check(self.spec_text, html_text)
        self.assertEqual([], errors)
        self.assertEqual([], warnings)


if __name__ == "__main__":
    unittest.main()
