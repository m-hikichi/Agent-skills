import copy
import hashlib
import importlib.util
import json
import pathlib
import re
import sys
import unittest


ROOT = pathlib.Path(__file__).parents[1]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "evals" / "fixtures"
FEATURE_DIR = FIXTURES / "api-order-feature"
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


def api_spec_text():
    return (FIXTURES / "api-order-spec.md").read_text(encoding="utf-8")


def api_v2_design():
    return json.loads((FIXTURES / "api-order-design.json").read_text(encoding="utf-8"))


def migrated_api_design():
    return MIGRATE.migrate(api_spec_text(), api_v2_design(), "api-order-design.json")


def implementation_ready_api_design():
    return json.loads(
        (FEATURE_DIR / "api-order-v3.design.json").read_text(encoding="utf-8")
    )


def fact(text, source_ref="FR-001", **extra):
    return {
        "text": text,
        "basis": "specified",
        "source_refs": [source_ref],
        **extra,
    }


def complete_render_config():
    function = {
        "id": "FNC-001",
        "name": "注文登録",
        "summary": "注文を受け付けて受付番号を返す",
        "actors": {
            "initiators": ["外部EC"],
            "processors": ["注文API"],
            "recipients": ["外部EC"],
            "operators": [],
        },
        "trigger": fact("注文登録APIを呼び出す"),
        "execution": {"type": "api", "refs": ["API-001"]},
        "inputs": [
            {
                "name": "注文要求",
                "type": "UNIQUE-ORDER-REQUEST-TYPE",
                "required": True,
                "description": "注文登録の型付き入力",
                "basis": "specified",
                "source_refs": ["FR-001"],
            }
        ],
        "outputs": [fact("受付番号")],
        "preconditions": [fact("クライアントが認証済みである")],
        "postconditions": [fact("注文が保存される")],
        "business_rules": [fact("同じ冪等キーでは注文を重複作成しない")],
        "exceptions": [
            {
                "condition": "要求形式が不正",
                "behavior": "400を返して保存しない",
                "basis": "specified",
                "source_refs": ["FR-001"],
            }
        ],
        "data_entities": [
            {
                "name": "注文",
                "entity_id": "ENT-ORDER",
                "basis": "specified",
                "source_refs": ["FR-001"],
            }
        ],
        "source_refs": ["FR-001"],
        "status": "current",
    }
    passed_axes = {
        axis: {"status": "passed", "errors": [], "warnings": [], "metrics": {}}
        for axis in (
            "requirements_coverage",
            "functional_design",
            "implementation_contracts",
            "operational_readiness",
        )
    }
    return {
        "schema_version": 3,
        "document_level": "implementation-ready",
        "title": "注文連携 v3基本設計",
        "source": {
            "artifacts": [
                {
                    "type": "spec",
                    "path": "spec.md",
                    "locator": "文書全体",
                    "fingerprint": "0" * 64,
                }
            ]
        },
        "function_list": [
            {
                "id": "01",
                "name": "注文受付",
                "children": [
                    {
                        "id": "01",
                        "name": "API受付",
                        "children": [{"id": "01", "name": "登録", "rows": [function]}],
                    }
                ],
            }
        ],
        "architecture": {
            "context": {
                "title": "注文連携 System Context",
                "elements": [
                    {"id": "EXT-EC", "name": "外部EC", "type": "external-system"},
                    {"id": "SYS-ORDER", "name": "注文連携", "type": "system"},
                ],
                "relationships": [{"from": "EXT-EC", "to": "SYS-ORDER", "label": "注文登録"}],
            },
            "containers": {
                "title": "注文連携 Containers",
                "elements": [
                    {"id": "APP-API", "name": "注文API", "type": "application"},
                    {"id": "DB-ORDER", "name": "注文DB", "type": "database"},
                ],
                "relationships": [{"from": "APP-API", "to": "DB-ORDER", "label": "保存"}],
            },
        },
        "workflows": [
            {
                "id": "WF-001",
                "name": "注文受付シーケンス",
                "type": "sequence",
                "participants": [
                    {"id": "EXT-EC", "name": "外部EC"},
                    {"id": "APP-API", "name": "注文API"},
                ],
                "steps": [{"id": "STEP-001", "from": "EXT-EC", "to": "APP-API", "action": "注文登録"}],
            }
        ],
        "state_models": [
            {
                "id": "STM-001",
                "name": "注文状態",
                "entity": "ENT-ORDER",
                "states": [
                    {"id": "accepted", "name": "受付済み", "initial": True},
                    {"id": "delivered", "name": "配送済み", "terminal": True},
                ],
                "transitions": [{"from": "accepted", "to": "delivered", "trigger": "配送完了"}],
            }
        ],
        "entities": [
            {
                "id": "ENT-ORDER",
                "name": "注文",
                "description": "受け付けた注文",
                "attributes": [{"name": "order_id", "type": "UUID", "required": True}],
            }
        ],
        "interfaces": [
            {
                "id": "API-001",
                "type": "api",
                "name": "注文登録API",
                "actors": ["外部EC"],
                "status": "current",
                "contract": {
                    "method": "POST",
                    "path": "/orders",
                    "auth": "OAuth2",
                    "request": {"schema_ref": "#/CreateOrderRequest"},
                    "responses": [{"status": 201, "schema_ref": "#/OrderAccepted"}],
                    "errors": [{"status": 400, "code": "INVALID_REQUEST"}],
                    "idempotency": "Idempotency-Key",
                },
            }
        ],
        "quality_scenarios": [
            {
                "id": "QS-001",
                "category": "performance",
                "scenario": "注文を登録する",
                "response": "受付結果を返す",
                "measure": "2秒以内",
            }
        ],
        "risks": [
            {
                "id": "RSK-001",
                "title": "外部連携停止",
                "impact": "high",
                "probability": "medium",
                "mitigation": "復旧手順を実行する",
                "status": "open",
            }
        ],
        "verification": [
            {
                "id": "VER-001",
                "source_id": "SC-001",
                "level": "e2e",
                "method": "注文登録E2E試験",
                "expected_result": "受付番号が返る",
                "status": "planned",
            }
        ],
        "traceability": [
            {
                "source_id": "FR-001",
                "function_ids": ["FNC-001"],
                "design_refs": ["workflow:WF-001", "interface:API-001"],
                "verification_ids": ["VER-001"],
                "coverage": "covered",
                "rationale": "注文登録機能とE2E試験で充足する",
            },
            {
                "source_id": "SC-001",
                "function_ids": [],
                "design_refs": [],
                "verification_ids": ["VER-001"],
                "coverage": "covered",
                "rationale": "E2E試験で検証する",
            },
        ],
        "source_catalog": [
            {"id": "FR-001", "type": "functional-requirement", "text": "注文を登録する"},
            {"id": "SC-001", "type": "success-criterion", "text": "注文を登録できる"},
        ],
        "delivery_summary": {
            "phases": [{"name": "注文受付", "completed": 1, "total": 2}],
            "dependencies": ["基盤 → 注文受付"],
            "completed": 1,
            "total": 2,
        },
        "quality": {
            "status": "passed",
            "document_status": "implementation-ready",
            "readiness": passed_axes,
            "errors": [],
            "warnings": [],
        },
        "open_questions": [],
        "decisions": [],
        "requirement_decisions": [],
    }


class V3DesignIntegrationTest(unittest.TestCase):
    def test_functional_spec_only_keeps_technical_axes_unassessed_and_omits_empty_tabs(self):
        spec_text = api_spec_text()
        cfg = migrated_api_design()

        html_text, report = BUILD.render(
            cfg,
            spec_text,
            allow_draft=True,
            feature_dir=FIXTURES,
            level="functional-design",
        )

        self.assertEqual("functional-design", report["document_level"])
        self.assertNotEqual("implementation-ready", report["document_status"])
        self.assertEqual("not-evaluated", report["readiness"]["implementation_contracts"]["status"])
        self.assertEqual("not-evaluated", report["readiness"]["operational_readiness"]["status"])
        self.assertNotIn('id="panel-architecture"', html_text)
        self.assertNotIn('id="panel-flows"', html_text)
        self.assertNotIn('id="panel-delivery"', html_text)
        self.assertIn("<strong>システム構成:</strong> 未確定", html_text)
        self.assertIn("実装準備完了を意味しません", html_text)

    def test_spec_only_functional_design_blocks_any_unbacked_technical_architecture(self):
        spec_text = api_spec_text()
        cfg = migrated_api_design()
        cfg["architecture"] = {
            "components": {
                "elements": [
                    {
                        "id": "CMP-INVENTED",
                        "name": "Invented",
                        "type": "nonsense",
                        "description": "specにない技術要素",
                    }
                ],
                "relationships": [],
            }
        }

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FIXTURES,
            level="functional-design",
        )

        errors = report["readiness"]["functional_design"]["errors"]
        self.assertTrue(any("source.artifactsにplanがありません" in error for error in errors), errors)
        self.assertTrue(any("typeが不正" in error for error in errors), errors)
        self.assertTrue(any("basis が不正" in error for error in errors), errors)

    def test_complete_v3_render_is_deterministic_and_has_accessible_diagrams_and_tables(self):
        cfg = complete_render_config()

        first, _ = BUILD.render(cfg, allow_draft=True)
        second, _ = BUILD.render(copy.deepcopy(cfg), allow_draft=True)

        self.assertEqual(first, second)
        controls = re.findall(r'aria-controls="(panel-[^"]+)"', first)
        self.assertEqual(
            [
                "panel-review",
                "panel-architecture",
                "panel-functions",
                "panel-details",
                "panel-flows",
                "panel-data",
                "panel-interfaces",
                "panel-quality",
                "panel-traceability",
                "panel-delivery",
            ],
            controls,
        )
        svg_blocks = re.findall(r"<svg\b.*?</svg>", first, re.S)
        self.assertEqual(5, len(svg_blocks))
        self.assertTrue(all('role="img"' in svg and "aria-labelledby=" in svg for svg in svg_blocks))
        self.assertTrue(all("<title" in svg and "<desc>" in svg for svg in svg_blocks))
        self.assertGreaterEqual(first.count('class="aux diagram-table"'), len(svg_blocks))
        self.assertIn("UNIQUE-ORDER-REQUEST-TYPE", first)
        self.assertIn("注文登録の型付き入力", first)
        self.assertNotRegex(first, r"\sstyle\s*=")
        self.assertNotRegex(first, r'<(?:link|script|img)\b[^>]*(?:src|href)=["\']https?://')
        errors, _ = CHECK.check_html_structure(first, require_v3=True, config=cfg)
        self.assertEqual([], errors)

    def test_incomplete_state_model_blocks_functional_readiness(self):
        spec_text = api_spec_text()
        cfg = migrated_api_design()
        entity_id = cfg["entities"][0]["id"]
        cfg["state_models"] = [
            {
                "id": "STM-GAP",
                "name": "不完全な注文状態",
                "entity": entity_id,
                "states": [
                    {"id": "accepted", "name": "受付済み", "initial": True, "basis": "specified", "source_refs": ["FR-010"]},
                    {"id": "delivered", "name": "配送済み", "terminal": True, "basis": "specified", "source_refs": ["FR-010"]},
                ],
                "transitions": [],
                "basis": "specified",
                "source_refs": ["FR-010"],
            }
        ]
        cfg["applicability"]["state_models"] = {"status": "required"}

        _, report, _ = QUALITY.validate_design(
            spec_text, cfg, feature_dir=FIXTURES, level="functional-design"
        )

        errors = report["readiness"]["functional_design"]["errors"]
        self.assertEqual("failed", report["readiness"]["functional_design"]["status"])
        self.assertTrue(any("transitionsがありません" in error for error in errors), errors)

    def test_missing_success_criterion_verification_blocks_requirements_readiness(self):
        spec_text = api_spec_text()
        cfg = migrated_api_design()

        _, report, _ = QUALITY.validate_design(
            spec_text, cfg, feature_dir=FIXTURES, level="functional-design"
        )

        errors = report["readiness"]["requirements_coverage"]["errors"]
        self.assertEqual("failed", report["readiness"]["requirements_coverage"]["status"])
        verification_error = next(
            error for error in errors if "Success Criteriaの検証方法がありません" in error
        )
        self.assertIn("SC-002", verification_error)
        self.assertIn("SC-003", verification_error)

    def test_typed_api_event_batch_screen_and_manual_contracts_are_accepted(self):
        def contract(**values):
            return {"basis": "specified", "source_refs": ["CONTRACT#test"], **values}

        cfg = {
            "interfaces": [
                {
                    "id": "API-001",
                    "type": "api",
                    "contract": contract(
                        method="POST",
                        path="/orders",
                        auth="OAuth2",
                        request="CreateOrderRequest",
                        responses="201 OrderAccepted",
                        errors="400 INVALID_REQUEST",
                        idempotency={
                            "key": "Idempotency-Key",
                            "scope": "external client",
                            "duplicate_behavior": "最初の結果を返す",
                            "retention": "24時間",
                        },
                        transaction="注文と冪等キーを同一境界で保存",
                        concurrency="同じ冪等キーは一意制約で競合検出",
                    ),
                },
                {
                    "id": "EVT-001",
                    "type": "event",
                    "contract": contract(
                        producer="order-api",
                        consumers=["notifier"],
                        trigger="注文状態変更",
                        payload="OrderChanged",
                        schema="OrderChangedEvent",
                        version="v1",
                        delivery="at-least-once",
                        ordering="注文ID単位",
                        deduplication="event ID",
                        retry={
                            "max_attempts": 3,
                            "interval": "1分、5分、15分",
                            "on_exhaustion": "dead-letterへ隔離",
                        },
                        recovery={
                            "notification": "運用担当へ通知",
                            "manual_recovery": "同じevent IDで手動再送",
                        },
                    ),
                },
                {
                    "id": "BAT-001",
                    "type": "batch",
                    "contract": contract(
                        schedule="0 2 * * *",
                        timezone="Asia/Tokyo",
                        initiator="scheduler",
                        input="対象日",
                        output="照合結果",
                        target_range="前日分",
                        overlap_policy="多重起動を拒否",
                        transaction="注文単位",
                        retry="失敗時1回",
                        recovery={"restart": "同じ対象日で再実行", "evidence": "実行履歴"},
                        monitoring="失敗時に運用通知",
                    ),
                },
                {
                    "id": "SCR-001",
                    "type": "screen",
                    "contract": contract(
                        input="注文番号",
                        output="注文詳細",
                        validation="UUID形式",
                        route="/orders/:id",
                        actions="検索から詳細",
                        auth="orders.read",
                        errors="対象なしを画面表示",
                    ),
                },
                {
                    "id": "MAN-001",
                    "type": "manual",
                    "contract": contract(
                        initiator="運用担当",
                        preconditions="原因が解消済み",
                        steps="dead-letterを再送する",
                        procedure="dead-letterを特定し、原因解消後に再送する",
                        evidence="再送履歴",
                        approval="当番責任者",
                        failure="失敗時は未解決を維持",
                        completion_record="インシデントへ完了記録",
                        roles="運用担当",
                        input="event ID",
                        output="再送結果",
                        recovery="失敗原因を解消後に再実行",
                    ),
                },
            ]
        }
        errors = []

        interface_ids, external_present = QUALITY._validate_contracts(
            cfg, ({"FR-001"}, {"CONTRACT"}, set()), errors
        )

        self.assertEqual(
            {"API-001", "EVT-001", "BAT-001", "SCR-001", "MAN-001"},
            interface_ids,
        )
        self.assertTrue(external_present)
        self.assertEqual([], errors)

    def test_v2_migration_preserves_function_ids_classification_order_and_text(self):
        legacy = api_v2_design()
        before = [
            (
                major.get("id"),
                major.get("name"),
                middle.get("id"),
                middle.get("name"),
                minor.get("id"),
                minor.get("name"),
                function.get("id"),
                function.get("name"),
                function.get("summary"),
            )
            for major, middle, minor, function in QUALITY.flatten_functions(legacy)
        ]

        migrated = MIGRATE.migrate(api_spec_text(), legacy, "api-order-design.json")
        after = [
            (
                major.get("id"),
                major.get("name"),
                middle.get("id"),
                middle.get("name"),
                minor.get("id"),
                minor.get("name"),
                function.get("id"),
                function.get("name"),
                function.get("summary"),
            )
            for major, middle, minor, function in QUALITY.flatten_functions(migrated)
        ]

        self.assertEqual(3, migrated["schema_version"])
        self.assertEqual("functional-design", migrated["document_level"])
        self.assertEqual(before, after)
        self.assertEqual([f"FNC-{index:03d}" for index in range(1, 8)], [row[6] for row in after])

    def test_stale_html_is_rejected_until_regenerated_from_changed_json(self):
        spec_text = api_spec_text()
        original = api_v2_design()
        original_html, _ = BUILD.render(original, spec_text, allow_draft=False)
        changed = copy.deepcopy(original)
        changed["title"] += " v3監査版"

        stale_errors = CHECK.check_html_freshness(spec_text, changed, original_html)
        regenerated, _ = BUILD.render(changed, spec_text, allow_draft=False)
        fresh_errors = CHECK.check_html_freshness(spec_text, changed, regenerated)

        self.assertTrue(any("再生成結果と一致しません" in error for error in stale_errors))
        self.assertEqual([], fresh_errors)

    def test_spec_clarifications_are_synchronized_to_requirement_decisions(self):
        spec_text = api_spec_text()
        items = QUALITY.extract_normative_items(spec_text)

        synced = CHECK._sync_requirement_decisions(
            {"schema_version": 3, "requirement_decisions": []}, items
        )
        decisions = synced["requirement_decisions"]

        self.assertGreaterEqual(len(decisions), 2)
        self.assertTrue(all(decision["id"].startswith("CL-") for decision in decisions))
        self.assertTrue(all(decision.get("question") for decision in decisions))
        self.assertTrue(all(decision.get("answer") for decision in decisions))
        self.assertTrue(all("Clarifications" in decision.get("source_locator", "") for decision in decisions))
        html_text, _ = BUILD.render(
            {**complete_render_config(), "requirement_decisions": decisions}, allow_draft=True
        )
        self.assertIn("同じ冪等キーの注文を再送した場合は？", html_text)
        self.assertIn("最初の受付結果を返し、注文を重複作成しない。", html_text)

    def test_artifact_fingerprint_mismatch_is_blocking(self):
        spec_path = FEATURE_DIR / "spec.md"
        correct = hashlib.sha256(spec_path.read_bytes()).hexdigest()
        cfg = {
            "source": {
                "artifacts": [
                    {
                        "type": "spec",
                        "path": "spec.md",
                        "locator": "文書全体",
                        "fingerprint": "0" * 64,
                    }
                ]
            }
        }

        mismatch_errors = CHECK._validate_artifact_files(cfg, FEATURE_DIR)
        cfg["source"]["artifacts"][0]["fingerprint"] = correct
        valid_errors = CHECK._validate_artifact_files(cfg, FEATURE_DIR)

        self.assertTrue(any("fingerprintが一致しません" in error for error in mismatch_errors))
        self.assertEqual([], valid_errors)

    def test_write_report_initializes_missing_fingerprint_but_never_rebaselines_mismatch(self):
        cfg = {
            "source": {
                "artifacts": [
                    {
                        "type": "spec",
                        "path": "spec.md",
                        "locator": "文書全体",
                        "fingerprint": "f" * 64,
                    }
                ]
            }
        }

        preserved = CHECK._with_artifact_fingerprints(cfg, FEATURE_DIR)
        self.assertEqual("f" * 64, preserved["source"]["artifacts"][0]["fingerprint"])
        self.assertTrue(any("fingerprintが一致しません" in error for error in CHECK._validate_artifact_files(preserved, FEATURE_DIR)))

        cfg["source"]["artifacts"][0]["fingerprint"] = "0" * 64
        initialized = CHECK._with_artifact_fingerprints(cfg, FEATURE_DIR)
        expected = hashlib.sha256((FEATURE_DIR / "spec.md").read_bytes()).hexdigest()
        self.assertEqual(expected, initialized["source"]["artifacts"][0]["fingerprint"])

    def test_v3_artifact_locator_with_spaces_is_one_source_reference(self):
        self.assertEqual(
            ["plan:System Context"],
            QUALITY._reference_values(["plan:System Context"]),
        )
        self.assertEqual(
            ["FR-001", "FR-002"],
            QUALITY._reference_values("FR-001, FR-002"),
        )

    def test_source_reference_locators_must_exist_in_markdown_and_openapi(self):
        cfg = implementation_ready_api_design()
        probe = {
            "facts": [
                {"source_refs": ["PLAN#DOES-NOT-EXIST"]},
                {"source_refs": ["CONTRACT#/paths/~1missing/post"]},
            ]
        }
        errors = []

        QUALITY._validate_source_locators(
            probe,
            cfg["source"]["artifacts"],
            FEATURE_DIR,
            errors,
        )

        self.assertEqual(2, len(errors), errors)
        self.assertTrue(all("locatorが正本に存在しません" in error for error in errors))

    def test_state_gate_rejects_missing_guard_side_effect_unreachable_cycle_and_terminal_exit(self):
        def state(state_id, *, initial=False, terminal=False):
            return {
                "id": state_id,
                "name": state_id,
                "initial": initial,
                "terminal": terminal,
                "basis": "specified",
                "source_refs": ["FR-010"],
            }

        def transition(source, target, trigger, **extra):
            return {
                "from": source,
                "to": target,
                "trigger": trigger,
                "condition": "常に許可",
                "action": "状態を記録する",
                "basis": "specified",
                "source_refs": ["FR-010"],
                **extra,
            }

        model = {
            "id": "STM-GRAPH",
            "name": "到達性テスト",
            "entity": "ENT-ORDER",
            "states": [
                state("start", initial=True),
                state("done", terminal=True),
                state("isolated-a"),
                state("isolated-b"),
            ],
            "transitions": [
                transition("start", "done", "完了", condition="", action=""),
                transition("done", "start", "再開"),
                transition("isolated-a", "isolated-b", "次へ"),
                transition("isolated-b", "isolated-a", "戻る"),
            ],
            "unlisted_transitions": "表にない遷移は拒否する",
            "basis": "specified",
            "source_refs": ["FR-010"],
        }
        errors = []

        QUALITY._validate_state_models(
            {},
            [model],
            {"ENT-ORDER"},
            ({"FR-010"}, set(), set()),
            errors,
            require_policy=True,
        )

        self.assertTrue(any("conditionが空" in error for error in errors), errors)
        self.assertTrue(any("actionが空" in error for error in errors), errors)
        self.assertTrue(any("終端状態 done から遷移" in error for error in errors), errors)
        self.assertTrue(any("到達できない状態" in error for error in errors), errors)

    def test_http_status_code_does_not_require_a_business_state_model(self):
        transport_only = [
            {
                "id": "FR-HTTP",
                "type": "functional-requirement",
                "text": "正常時はHTTPステータスコード201を返す",
            },
            {
                "id": "AC-HTTP",
                "type": "acceptance-scenario",
                "text": "レスポンス状態コードが400である",
            },
        ]
        business_state = [
            {
                "id": "FR-STATE",
                "type": "functional-requirement",
                "text": "注文を受付済みから配送済みに遷移する",
            }
        ]

        self.assertFalse(QUALITY._state_requirement_present(transport_only))
        self.assertTrue(QUALITY._state_requirement_present(business_state))

    def test_implementation_ready_requires_typed_entity_attributes(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        cfg["entities"][0]["attributes"][0].pop("type", None)
        cfg["entities"][0]["attributes"][0].pop("required", None)

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        errors = report["readiness"]["implementation_contracts"]["errors"]
        self.assertEqual("failed", report["readiness"]["implementation_contracts"]["status"])
        self.assertTrue(any("typeが必要" in error for error in errors), errors)
        self.assertTrue(any("requiredを真偽値" in error for error in errors), errors)

    def test_implementation_ready_contracts_and_decisions_must_reference_their_canonical_artifacts(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        for interface in cfg["interfaces"]:
            if interface.get("type") in {"api", "event", "external-interface"}:
                interface["contract"]["source_refs"] = ["PLAN#Interfaces"]
        for decision in cfg["architecture"]["decisions"]:
            decision["source_refs"] = ["PLAN#Architecture"]

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        errors = report["readiness"]["implementation_contracts"]["errors"]
        self.assertEqual("failed", report["readiness"]["implementation_contracts"]["status"])
        self.assertTrue(any("外部契約の正本" in error for error in errors), errors)
        self.assertTrue(any("research:..." in error for error in errors), errors)

    def test_post_validation_html_error_blocks_persisted_report(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        merged = CHECK._merge_report_findings(
            report,
            ["HTMLがdesign.jsonの再生成結果と一致しません"],
            [],
        )

        self.assertEqual("failed", merged["status"])
        self.assertEqual("blocked", merged["document_status"])
        self.assertEqual("failed", merged["readiness"]["functional_design"]["status"])

    def test_operational_architecture_facts_make_architecture_tab_applicable(self):
        cfg = {
            "architecture": {
                "deployment": [
                    {
                        "text": "単一リージョンへ配置する",
                        "basis": "specified",
                        "source_refs": ["plan:Deployment"],
                    }
                ]
            }
        }

        self.assertTrue(BUILD._has_architecture_view(cfg))
        self.assertTrue(CHECK._v3_panel_has_data(cfg, "architecture"))

    def test_implementation_ready_rejects_empty_architecture_shells(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        cfg["architecture"]["context"] = {"summary": "不明"}
        cfg["architecture"]["containers"] = {"summary": "不明"}
        for key in ("deployment", "observability", "recovery"):
            cfg["architecture"][key] = {
                "basis": "specified",
                "source_refs": ["PLAN#Operational Design"],
            }

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        contract_errors = report["readiness"]["implementation_contracts"]["errors"]
        operational_errors = report["readiness"]["operational_readiness"]["errors"]
        self.assertTrue(any("context.elementsがありません" in error for error in contract_errors), contract_errors)
        self.assertTrue(any("containers.elementsがありません" in error for error in contract_errors), contract_errors)
        self.assertEqual(3, sum("具体的内容がありません" in error for error in operational_errors))

    def test_explicit_component_and_code_views_are_validated_and_rendered(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        evidence = {"basis": "specified", "source_refs": ["PLAN#Project Structure"]}
        cfg["architecture"]["components"] = {
            "title": "Order API Components",
            "elements": [
                {
                    "id": "CMP-HANDLER",
                    "name": "Handler",
                    "type": "component",
                    "basis": "specified",
                    "source_refs": ["PLAN#Project Structure", "FR-001"],
                },
                {"id": "CMP-REPO", "name": "Repository", "type": "repository", **evidence},
            ],
            "relationships": [
                {
                    "from": "CMP-HANDLER",
                    "to": "CMP-REPO",
                    "label": "保存を依頼",
                    **evidence,
                }
            ],
        }
        cfg["architecture"]["code"] = {
            "title": "Idempotency Code View",
            "elements": [
                {"id": "CLS-SERVICE", "name": "IdempotencyService", "type": "class", **evidence},
                {"id": "IF-STORE", "name": "IdempotencyStore", "type": "interface", **evidence},
            ],
            "relationships": [
                {
                    "from": "CLS-SERVICE",
                    "to": "IF-STORE",
                    "label": "uses",
                    **evidence,
                }
            ],
        }
        next(
            item for item in cfg["traceability"] if item["source_id"] == "FR-001"
        )["design_refs"].append("architecture:CMP-HANDLER")

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )
        html_text, _ = BUILD.render(
            cfg,
            spec_text,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        self.assertEqual("passed", report["readiness"]["implementation_contracts"]["status"])
        self.assertIn("Order API Components", html_text)
        self.assertIn("Idempotency Code View", html_text)

    def test_architecture_element_ids_are_unique_across_all_views(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        duplicate_id = cfg["architecture"]["context"]["elements"][0]["id"]
        cfg["architecture"]["components"] = {
            "elements": [
                {
                    "id": duplicate_id,
                    "name": "Duplicate component",
                    "type": "component",
                    "basis": "specified",
                    "source_refs": ["PLAN#Project Structure"],
                }
            ],
            "relationships": [],
        }

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        errors = report["readiness"]["implementation_contracts"]["errors"]
        self.assertTrue(any("architecture element id" in error and "重複" in error for error in errors), errors)

    def test_tasks_summary_excludes_explicitly_deferred_work(self):
        cfg = implementation_ready_api_design()
        progress = QUALITY._task_progress_from_artifacts(
            cfg["source"]["artifacts"], FEATURE_DIR
        )

        self.assertEqual({"completed": 2, "total": 22}, progress)

    def test_function_io_requires_type_and_boolean_required(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        first_input = cfg["function_list"][0]["children"][0]["children"][0]["rows"][0]["inputs"][0]
        first_input.pop("type")
        first_input.pop("required")

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        functional_errors = report["readiness"]["functional_design"]["errors"]
        contract_errors = report["readiness"]["implementation_contracts"]["errors"]
        self.assertTrue(any("typeが空" in error for error in functional_errors), functional_errors)
        self.assertTrue(any("requiredをboolean" in error for error in functional_errors), functional_errors)
        self.assertTrue(any("typeが空" in error for error in contract_errors), contract_errors)
        self.assertTrue(any("requiredをboolean" in error for error in contract_errors), contract_errors)

    def test_undetermined_io_type_is_only_allowed_in_functional_design(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        first_input = cfg["function_list"][0]["children"][0]["children"][0]["rows"][0]["inputs"][0]
        first_input["type"] = "undetermined"

        _, functional_report, _ = QUALITY.validate_design(
            spec_text,
            copy.deepcopy(cfg),
            feature_dir=FEATURE_DIR,
            level="functional-design",
        )
        _, implementation_report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        self.assertFalse(
            any("typeを確定" in error for error in functional_report["errors"]),
            functional_report["errors"],
        )
        contract_errors = implementation_report["readiness"]["implementation_contracts"]["errors"]
        self.assertTrue(any("typeを確定" in error for error in contract_errors), contract_errors)

    def test_workflow_participants_require_identity_role_and_membership(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        cfg["workflows"][0]["participants"] = []

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        errors = report["readiness"]["functional_design"]["errors"]
        self.assertTrue(any("participantsは役割付きで2件以上" in error for error in errors), errors)
        self.assertTrue(any("participantsを参照していません" in error for error in errors), errors)

    def test_implementation_contract_gate_matches_kind_specific_schema(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        for interface in cfg["interfaces"]:
            contract = interface["contract"]
            if interface["type"] == "api":
                contract.pop("transaction", None)
                contract.pop("concurrency", None)
            elif interface["type"] == "event":
                for key in ("trigger", "ordering", "deduplication", "schema", "version"):
                    contract.pop(key, None)
            elif interface["type"] == "batch":
                for key in (
                    "initiator",
                    "input",
                    "output",
                    "target_range",
                    "overlap_policy",
                    "transaction",
                    "retry",
                ):
                    contract.pop(key, None)
            elif interface["type"] == "manual":
                for key in (
                    "initiator",
                    "preconditions",
                    "evidence",
                    "approval",
                    "failure",
                    "completion_record",
                ):
                    contract.pop(key, None)

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        errors = report["readiness"]["implementation_contracts"]["errors"]
        combined = "\n".join(errors)
        for field in (
            "transaction",
            "concurrency",
            "trigger",
            "ordering",
            "deduplication",
            "schema",
            "version",
            "initiator",
            "target_range",
            "overlap_policy",
            "evidence",
            "approval",
            "completion_record",
        ):
            self.assertIn(field, combined)

    def test_unresolved_sentinels_cannot_satisfy_implementation_readiness(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        cfg["entities"][0]["attributes"][0]["type"] = "undetermined"
        cfg["interfaces"][0]["contract"]["method"] = "TBD"
        cfg["state_models"][0]["transitions"][0]["trigger"] = "要確認"
        cfg["verification"][0]["method"] = "未確定"
        cfg["quality_scenarios"][0]["measure"] = "TBD"

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        self.assertTrue(
            any("typeを確定" in error for error in report["readiness"]["implementation_contracts"]["errors"])
        )
        self.assertTrue(
            any("未確定値" in error for error in report["readiness"]["implementation_contracts"]["errors"])
        )
        self.assertTrue(
            any("triggerが未確定" in error for error in report["readiness"]["functional_design"]["errors"])
        )
        self.assertTrue(
            any("verification" in error and "未確定値" in error for error in report["readiness"]["requirements_coverage"]["errors"])
        )
        self.assertTrue(
            any("quality_scenarios" in error and "未確定値" in error for error in report["readiness"]["operational_readiness"]["errors"])
        )

    def test_v3_requires_feature_root_and_exact_canonical_spec_content(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()

        _, no_root_report, _ = QUALITY.validate_design(
            spec_text,
            copy.deepcopy(cfg),
            feature_dir=None,
            level="implementation-ready",
        )
        changed_spec = spec_text.replace(
            "注文を重複作成しない",
            "新しい注文を作成する",
            1,
        )
        _, wrong_spec_report, _ = QUALITY.validate_design(
            changed_spec,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        self.assertTrue(any("feature_dirが必要" in error for error in no_root_report["errors"]))
        self.assertTrue(any("正本と一致しません" in error for error in wrong_spec_report["errors"]))

    def test_workflow_and_entity_enums_are_enforced(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        cfg["workflows"][0]["type"] = "invented"
        cfg["workflows"][0]["steps"][0]["status"] = "maybe"
        cfg["entities"][0]["relationships"][0].pop("type")
        cfg["entities"][0]["attributes"].append(copy.deepcopy(cfg["entities"][0]["attributes"][0]))

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        errors = report["readiness"]["functional_design"]["errors"]
        self.assertTrue(any("workflow[1]: typeが不正" in error for error in errors), errors)
        self.assertTrue(any("statusが不正" in error for error in errors), errors)
        self.assertTrue(any("relationship typeが不正" in error for error in errors), errors)
        self.assertTrue(any("attribute nameが重複" in error for error in errors), errors)

    def test_resolved_question_requires_confirmation_applied_to_every_affected_record(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        question = {
            "id": "Q-APPLY-001",
            "question": "System Contextへ確認回答を反映したか",
            "severity": "blocking",
            "status": "resolved",
            "confirmation_id": "CL-20260624-02",
            "affected_refs": ["architecture:CTX-EC"],
            "return_to": "/speckit.analyze",
            "source_refs": ["FR-020"],
        }
        cfg["open_questions"] = [question]

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        errors = report["readiness"]["functional_design"]["errors"]
        self.assertTrue(any("確認済み決定 CL-20260624-02 を参照していません" in error for error in errors), errors)

        answered = copy.deepcopy(cfg)
        answered["open_questions"][0]["status"] = "answered"
        with self.assertRaisesRegex(ValueError, "影響先へ未反映"):
            QUALITY.mark_question_resolved(answered, "Q-APPLY-001")
        answered["architecture"]["context"]["elements"][0]["source_refs"].append("CL-20260624-02")
        resolved = QUALITY.mark_question_resolved(answered, "Q-APPLY-001")
        self.assertEqual("resolved", resolved["open_questions"][0]["status"])

    def test_technical_decision_cannot_impersonate_user_confirmation(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()
        cfg["decisions"].append(
            {
                "id": "ADR-FAKE",
                "decision": "技術判断をユーザー回答として扱う",
                "basis": "specified",
                "source_refs": ["RESEARCH#Decision 1"],
            }
        )
        manual = next(interface for interface in cfg["interfaces"] if interface["id"] == "MAN-001")
        manual["contract"]["confirmation"] = "ADR-FAKE"
        manual["contract"]["source_refs"] = [
            ref for ref in manual["contract"]["source_refs"] if not ref.startswith("CL-")
        ] + ["ADR-FAKE"]

        _, report, _ = QUALITY.validate_design(
            spec_text,
            cfg,
            feature_dir=FEATURE_DIR,
            level="implementation-ready",
        )

        errors = report["readiness"]["implementation_contracts"]["errors"]
        self.assertTrue(any("confirmationが確認済み決定を参照していません" in error for error in errors), errors)

    def test_full_feature_fixture_is_implementation_ready_and_fresh(self):
        spec_text = (FEATURE_DIR / "spec.md").read_text(encoding="utf-8")
        cfg = implementation_ready_api_design()

        validated, report, items = QUALITY.validate_design(
            spec_text,
            copy.deepcopy(cfg),
            feature_dir=FEATURE_DIR,
            level="auto",
        )

        self.assertEqual("passed", report["status"])
        self.assertEqual("implementation-ready", report["document_status"])
        self.assertEqual(
            {
                "requirements_coverage": "passed",
                "functional_design": "passed",
                "implementation_contracts": "passed",
                "operational_readiness": "passed",
            },
            {axis: result["status"] for axis, result in report["readiness"].items()},
        )
        self.assertEqual(38, len(items))
        self.assertEqual(38, len(validated["traceability"]))
        self.assertEqual([], CHECK._validate_artifact_files(cfg, FEATURE_DIR))
        for artifact in cfg["source"]["artifacts"]:
            source_path = FEATURE_DIR / artifact["path"]
            self.assertEqual(
                hashlib.sha256(source_path.read_bytes()).hexdigest(),
                artifact["fingerprint"],
                artifact["path"],
            )

        first, first_report = BUILD.render(
            copy.deepcopy(cfg),
            spec_text,
            feature_dir=FEATURE_DIR,
            level="auto",
        )
        second, second_report = BUILD.render(
            copy.deepcopy(cfg),
            spec_text,
            feature_dir=FEATURE_DIR,
            level="auto",
        )

        self.assertEqual("implementation-ready", first_report["document_status"])
        self.assertEqual(first_report, second_report)
        self.assertEqual(first, second)
        self.assertEqual(
            [
                "panel-review",
                "panel-architecture",
                "panel-functions",
                "panel-details",
                "panel-flows",
                "panel-data",
                "panel-interfaces",
                "panel-quality",
                "panel-traceability",
                "panel-delivery",
            ],
            re.findall(r'aria-controls="(panel-[^"]+)"', first),
        )
        structure_errors, structure_warnings = CHECK.check_html_structure(
            first, require_v3=True, config=validated
        )
        self.assertEqual([], structure_errors)
        self.assertEqual([], structure_warnings)
        self.assertIn("P1: 5件", first)
        self.assertIn("P2: 1件", first)
        self.assertIn('class="aux diagram-table participant-table"', first)
        self.assertIn("data-store", first)
        self.assertEqual(
            [],
            CHECK.check_html_freshness(
                spec_text,
                cfg,
                first,
                feature_dir=FEATURE_DIR,
                level="auto",
            ),
        )


if __name__ == "__main__":
    unittest.main()
