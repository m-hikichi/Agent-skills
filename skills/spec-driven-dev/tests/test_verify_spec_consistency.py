import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "verify_spec_consistency.py"


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


class VerifySpecConsistencyTests(unittest.TestCase):
    def run_checker(self, root: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--project-root", str(root)],
            capture_output=True,
            text=True,
            check=False,
        )

    def make_project(self, root: Path) -> None:
        write(
            root / "spec-config.json",
            json.dumps(
                {
                    "spec_dir": "docs/specs",
                    "traceability_path": "docs/traceability-matrix.md",
                    "requirements_path": "docs/requirements.md",
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
        write(
            root / "docs" / "requirements.md",
            """
            # 要件

            ## プロダクトゴール
            - sample

            ## 対象ユーザー
            - sample

            ## MVPスコープ
            - sample

            ### 要件と仕様の対応（Traceability）
            | 要件ID | 要件概要 | 対応仕様 |
            |--------|----------|----------|
            | FC-01-01-001 | Todo を作成できる | SPEC-001 / FR-001 |

            ## MVP対象外
            - none

            ## 受け入れ基準（MVP）
            - AC-001
            """,
        )
        write(
            root / "docs" / "specs" / "SPEC-001-todo.md",
            """
            ---
            spec_id: SPEC-001
            title: Todo 作成
            status: approved
            created: 2026-03-26
            updated: 2026-03-26
            author: test
            related_specs: []
            ---

            # SPEC-001: Todo 作成

            ## 対応要件（requirements.md）

            | 要件ID | 要件概要 | 本仕様での実装機能ID |
            |--------|----------|----------------------|
            | FC-01-01-001 | Todo を作成できる | FR-001 |

            ## 機能仕様（要件実装一覧）

            - [ ] FR-001: Todo を作成できる

            ## 実装トレーサビリティ契約

            | 機能ID | 実装ファイル | シンボル種別 | シンボル名 | テストファイル | テストID | 備考 |
            |--------|--------------|--------------|------------|----------------|----------|------|
            | FR-001 | src/todos/create.py | function | create_todo | tests/test_create_todo.py | TC-001 | entrypoint |

            ## 実装完了条件

            | 機能ID | 観測可能な結果 | テストID | 自動化 | 備考 |
            |--------|----------------|----------|--------|------|
            | FR-001 | 正常な入力で Todo が作成される | TC-001 | yes | |

            ## テスト仕様

            | テストID | 対応要件 | テスト内容 | 種別 |
            |---------|---------|-----------|------|
            | TC-001 | FR-001 | Todo が作成される | 正常系 |
            """,
        )
        write(
            root / "docs" / "traceability-matrix.md",
            """
            # トレーサビリティマトリクス

            | 要件ID | 仕様ID | 機能ID(FR/NFR) | 実装ファイル | シンボル種別 | シンボル名 | テストファイル | テストID | ステータス |
            |---|---|---|---|---|---|---|---|---|
            | FC-01-01-001 | SPEC-001 | FR-001 | src/todos/create.py | function | create_todo | tests/test_create_todo.py | TC-001 | ✅ |
            """,
        )
        write(
            root / "src" / "todos" / "create.py",
            """
            def create_todo(title: str) -> dict:
                return {"title": title}
            """,
        )
        write(
            root / "tests" / "test_create_todo.py",
            """
            def test_create_todo_tc_001():
                # TC-001
                assert True
            """,
        )

    def test_checker_passes_for_consistent_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.make_project(root)
            result = self.run_checker(root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("OK: spec consistency check passed.", result.stdout)

    def test_checker_fails_for_missing_symbol(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.make_project(root)
            write(
                root / "src" / "todos" / "create.py",
                """
                def renamed_todo(title: str) -> dict:
                    return {"title": title}
                """,
            )
            result = self.run_checker(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("symbol not found in implementation", result.stdout)

    def test_checker_fails_for_missing_test_id_reference(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.make_project(root)
            write(
                root / "tests" / "test_create_todo.py",
                """
                def test_create_todo():
                    assert True
                """,
            )
            result = self.run_checker(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("test id TC-001 not found", result.stdout)

    def test_checker_fails_for_unknown_contract_feature(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.make_project(root)
            write(
                root / "docs" / "specs" / "SPEC-001-todo.md",
                """
                ---
                spec_id: SPEC-001
                title: Todo 作成
                status: approved
                created: 2026-03-26
                updated: 2026-03-26
                author: test
                related_specs: []
                ---

                # SPEC-001: Todo 作成

                ## 対応要件（requirements.md）

                | 要件ID | 要件概要 | 本仕様での実装機能ID |
                |--------|----------|----------------------|
                | FC-01-01-001 | Todo を作成できる | FR-001 |

                ## 機能仕様（要件実装一覧）

                - [ ] FR-001: Todo を作成できる

                ## 実装トレーサビリティ契約

                | 機能ID | 実装ファイル | シンボル種別 | シンボル名 | テストファイル | テストID | 備考 |
                |--------|--------------|--------------|------------|----------------|----------|------|
                | FR-999 | src/todos/create.py | function | create_todo | tests/test_create_todo.py | TC-001 | wrong |

                ## 実装完了条件

                | 機能ID | 観測可能な結果 | テストID | 自動化 | 備考 |
                |--------|----------------|----------|--------|------|
                | FR-001 | 正常な入力で Todo が作成される | TC-001 | yes | |

                ## テスト仕様

                | テストID | 対応要件 | テスト内容 | 種別 |
                |---------|---------|-----------|------|
                | TC-001 | FR-001 | Todo が作成される | 正常系 |
                """,
            )
            result = self.run_checker(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unknown feature id FR-999", result.stdout)

    def test_checker_fails_for_missing_feature_referenced_by_requirements_traceability(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.make_project(root)
            write(
                root / "docs" / "requirements.md",
                """
                # 要件

                ## プロダクトゴール
                - sample

                ## 対象ユーザー
                - sample

                ## MVPスコープ
                - sample

                ### 要件と仕様の対応（Traceability）
                | 要件ID | 要件概要 | 対応仕様 |
                |--------|----------|----------|
                | FC-01-01-001 | Todo を作成できる | SPEC-001 / FR-999 |

                ## MVP対象外
                - none

                ## 受け入れ基準（MVP）
                - AC-001
                """,
            )
            result = self.run_checker(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("requirements traceability references missing spec feature", result.stdout)

    def test_checker_fails_when_requirements_traceability_is_not_reflected_in_spec(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.make_project(root)
            write(
                root / "docs" / "specs" / "SPEC-001-todo.md",
                """
                ---
                spec_id: SPEC-001
                title: Todo 作成
                status: approved
                created: 2026-03-26
                updated: 2026-03-26
                author: test
                related_specs: []
                ---

                # SPEC-001: Todo 作成

                ## 対応要件（requirements.md）

                | 要件ID | 要件概要 | 本仕様での実装機能ID |
                |--------|----------|----------------------|
                | FC-01-01-001 | Todo を作成できる | FR-002 |

                ## 機能仕様（要件実装一覧）

                - [ ] FR-001: Todo を作成できる

                ## 実装トレーサビリティ契約

                | 機能ID | 実装ファイル | シンボル種別 | シンボル名 | テストファイル | テストID | 備考 |
                |--------|--------------|--------------|------------|----------------|----------|------|
                | FR-001 | src/todos/create.py | function | create_todo | tests/test_create_todo.py | TC-001 | entrypoint |

                ## 実装完了条件

                | 機能ID | 観測可能な結果 | テストID | 自動化 | 備考 |
                |--------|----------------|----------|--------|------|
                | FR-001 | 正常な入力で Todo が作成される | TC-001 | yes | |

                ## テスト仕様

                | テストID | 対応要件 | テスト内容 | 種別 |
                |---------|---------|-----------|------|
                | TC-001 | FR-001 | Todo が作成される | 正常系 |
                """,
            )
            result = self.run_checker(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("requirements traceability is not reflected in spec requirement table", result.stdout)


if __name__ == "__main__":
    unittest.main()
