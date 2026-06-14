import importlib.util
import pathlib
import unittest


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "build_design_html.py"
SPEC = importlib.util.spec_from_file_location("build_design_html", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

CHECK_SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "check_design_html.py"
CHECK_SPEC = importlib.util.spec_from_file_location("check_design_html", CHECK_SCRIPT)
CHECK_MODULE = importlib.util.module_from_spec(CHECK_SPEC)
CHECK_SPEC.loader.exec_module(CHECK_MODULE)
FIXTURES = pathlib.Path(__file__).parents[1] / "evals" / "fixtures"


def config(rows, screens=None):
    return {
        "title": "テスト機能一覧",
        "screens": screens or [],
        "function_list": [
            {
                "name": "貸出管理",
                "id": "01",
                "children": [
                    {
                        "name": "データ出力",
                        "id": "01",
                        "children": [
                            {"name": "利用実績", "id": "01", "rows": rows}
                        ],
                    }
                ],
            }
        ],
    }


class BuildDesignHtmlTest(unittest.TestCase):
    def test_render_uses_width_classes_and_one_line_function_rows(self):
        cfg = config(
            [
                {
                    "機能名": "貸出履歴表示",
                    "概要": "貸出履歴を一覧表示する",
                    "業務ルール": ["管理者のみ利用できる"],
                    "画面": ["SCR-001"],
                    "FR": "FR-001",
                }
            ],
            [{"id": "SCR-001", "name": "貸出履歴画面"}],
        )

        output = MODULE.render(cfg)

        self.assertNotIn(" style=", output)
        self.assertIn('<col class="w065">', output)
        function_lines = [
            line for line in output.splitlines()
            if "<tr>" in line and "FR-001" in line
        ]
        self.assertEqual(1, len(function_lines))
        self.assertIn("</tr>", function_lines[0])

    def test_mixed_current_and_future_rows_keep_parent_categories_current(self):
        cfg = config(
            [
                {
                    "機能名": "月次実績出力",
                    "概要": "月次実績を出力する",
                    "業務ルール": ["将来バージョンで提供する"],
                    "画面": ["SCR-001"],
                    "FR": "FR-040",
                    "future": True,
                },
                {
                    "機能名": "貸出履歴出力",
                    "概要": "貸出履歴を出力する",
                    "業務ルール": ["管理者のみ利用できる"],
                    "画面": ["SCR-001"],
                    "FR": "FR-032",
                },
            ],
            [{"id": "SCR-001", "name": "貸出履歴画面"}],
        )

        output = MODULE.render(cfg)
        first_function_line = next(
            line for line in output.splitlines() if "FR-040" in line
        )

        self.assertIn('class="dai"', first_function_line)
        self.assertIn('class="chu"', first_function_line)
        self.assertIn('class="sho0"', first_function_line)
        self.assertIn('class="g future"', first_function_line)
        self.assertNotIn('class="future" rowspan', first_function_line)

    def test_screenless_automatic_processing_is_valid(self):
        cfg = config(
            [
                {
                    "機能名": "期限超過通知",
                    "概要": "期限超過を検出して通知する",
                    "業務ルール": ["1日1回送信する"],
                    "画面": ["画面なし（自動処理）"],
                    "FR": "FR-025",
                }
            ]
        )

        output = MODULE.render(cfg)

        self.assertIn("画面なし（自動処理）", output)
        broken = output.replace("画面なし（自動処理）", "全画面共通")
        errors, _ = CHECK_MODULE.check("FR-025", broken)
        self.assertTrue(any("自動処理" in error for error in errors))

    def test_legacy_row_without_screen_still_renders(self):
        cfg = config(
            [
                {
                    "細分類": "旧形式機能",
                    "機能": "旧形式の処理を実行する",
                    "概要": "旧形式の業務ルール",
                }
            ]
        )

        output = MODULE.render(cfg)

        self.assertIn("旧形式機能", output)
        self.assertIn("旧形式の処理を実行する", output)

    def test_undefined_screen_reference_is_rejected(self):
        cfg = config(
            [
                {
                    "機能名": "貸出履歴表示",
                    "概要": "貸出履歴を一覧表示する",
                    "業務ルール": ["管理者のみ利用できる"],
                    "画面": ["SCR-999"],
                    "FR": "FR-001",
                }
            ]
        )

        with self.assertRaisesRegex(ValueError, "未定義の画面ID SCR-999"):
            MODULE.render(cfg)

    def test_unreferenced_screen_is_rejected(self):
        cfg = config(
            [
                {
                    "機能名": "期限超過通知",
                    "概要": "期限超過を検出して通知する",
                    "業務ルール": ["1日1回送信する"],
                    "画面": ["画面なし（自動処理）"],
                    "FR": "FR-025",
                }
            ],
            [{"id": "SCR-001", "name": "未使用画面"}],
        )

        with self.assertRaisesRegex(ValueError, "どの機能からも参照されない画面"):
            MODULE.render(cfg)

    def test_open_question_must_be_listed_in_criteria(self):
        cfg = config(
            [
                {
                    "機能名": "代替期間案内",
                    "概要": "予約可能な代替期間を案内する",
                    "業務ルール": ["提示件数は要確認"],
                    "画面": ["SCR-001"],
                    "FR": "FR-021",
                }
            ],
            [{"id": "SCR-001", "name": "予約画面"}],
        )

        with self.assertRaisesRegex(ValueError, "要確認事項が criteria にありません"):
            MODULE.render(cfg)

        cfg["criteria"] = [
            {
                "区分": "要確認",
                "項目": "FR-021 / 代替期間案内",
                "内容": "提示件数",
            }
        ]
        output = MODULE.render(cfg)
        self.assertIn("提示件数", output)

    def test_output_checker_detects_mixed_group_marked_all_future(self):
        cfg = config(
            [
                {
                    "機能名": "月次実績出力",
                    "概要": "月次実績を出力する",
                    "業務ルール": ["将来バージョンで提供する"],
                    "画面": ["SCR-001"],
                    "FR": "FR-040",
                    "future": True,
                },
                {
                    "機能名": "貸出履歴出力",
                    "概要": "貸出履歴を出力する",
                    "業務ルール": ["管理者のみ利用できる"],
                    "画面": ["SCR-001"],
                    "FR": "FR-032",
                },
            ],
            [{"id": "SCR-001", "name": "貸出履歴画面"}],
        )
        output = MODULE.render(cfg)
        errors, warnings = CHECK_MODULE.check("FR-032\nFR-040", output)
        self.assertEqual([], errors)
        self.assertEqual([], warnings)

        broken = output.replace('class="dai"', 'class="future"', 1)
        errors, _ = CHECK_MODULE.check("FR-032\nFR-040", broken)
        self.assertTrue(any("現行行を含むのに将来対応色" in error for error in errors))

    def test_output_checker_rejects_more_than_three_rows_per_spec_fr_overall(self):
        rows = [
            {
                "機能名": f"機能{index}",
                "概要": f"処理{index}を実行する",
                "業務ルール": ["規則を適用する"],
                "画面": ["SCR-001"],
                "FR": "FR-001",
            }
            for index in range(1, 5)
        ]
        output = MODULE.render(
            config(rows, [{"id": "SCR-001", "name": "テスト画面"}])
        )

        errors, warnings = CHECK_MODULE.check("FR-001", output)

        self.assertTrue(any("3倍を超えています" in error for error in errors))
        self.assertTrue(any("4 機能行" in warning for warning in warnings))

    def test_committed_sample_html_passes_checker(self):
        spec_text = (FIXTURES / "equipment-lending-spec.md").read_text(encoding="utf-8")
        html_text = (
            FIXTURES / "備品貸出管理デモ_基本設計_機能一覧.html"
        ).read_text(encoding="utf-8")

        errors, warnings = CHECK_MODULE.check(spec_text, html_text)

        self.assertEqual([], errors)
        self.assertEqual([], warnings)


if __name__ == "__main__":
    unittest.main()
