from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from test_quality import concrete_text, missing_test_fields


class ConcretenessTests(unittest.TestCase):
    def test_quoted_placeholder_literals_with_context_are_valid(self):
        for value in (
            '画面に「未設定」と表示される', '入力値: "TBD"', "Enter 'TBD' in the status field",
            'The screen displays “unspecified”.', 'ラベルは『要確認』である',
            'status = `TODO`', 'Display ‘TBC’ beside the order.',
            'メッセージ「未定」と「要確認」を表示する',
            'The field displays "say \\"TBD\\"".',
        ):
            with self.subTest(value=value):
                self.assertTrue(concrete_text(value))

    def test_bare_quoted_placeholders_do_not_bypass_gate(self):
        for value in ('"TBD"', "'TODO'", '`unspecified`', '「未設定」', '『要確認』',
                      '“TBC”', '‘TBD’', '「未設定」。', '"TBD" / 「未設定」', '「未設定'):
            with self.subTest(value=value):
                self.assertFalse(concrete_text(value))

    def test_unquoted_missing_information_still_blocks(self):
        for value in ('画面に「未設定」と表示される。入力値は未定',
                      'Enter "TBD"; expected result TBD', 'TODO: display "hello"',
                      '「表示」は要確認', 'The field displays "TBD', 'テストデータは後日記入'):
            with self.subTest(value=value):
                self.assertFalse(concrete_text(value))

    def test_wholly_vague_values_are_missing_in_both_languages(self):
        for value in ('適切なデータ', '正しく動作する。', '操作する', '準備済み',
                      '正常に動作する', '適切なテストデータ', 'appropriate data',
                      'Works correctly.', 'it works as expected', 'perform the operation',
                      '準備済み！', '"appropriate data"', '「正しく動作する」'):
            with self.subTest(value=value):
                self.assertFalse(concrete_text(value))

    def test_specific_examples_and_observable_results_are_not_vague(self):
        for value in ('適切なデータ: fixture orders-valid.json の注文 ID A-001',
                      '注文 ID A-001 が一覧に1件表示される', '管理者としてログイン済み',
                      '注文登録画面で送信ボタンを押す', 'The response status is 422.',
                      'Appropriate data: use fixture users.json, record alice.',
                      'Display "works correctly" in the result field.', '"alice"'):
            with self.subTest(value=value):
                self.assertTrue(concrete_text(value))

    def test_missing_fields_use_literal_aware_checks(self):
        test = dict(preconditions=['管理者としてログイン済み'], steps=['状態欄に "TBD" を入力する'],
                    test_data=['状態: "TBD"'], expected_result='画面に「未設定」と表示される')
        self.assertEqual(missing_test_fields(test), [])
        test['test_data'].append('適切なデータ')
        self.assertEqual(missing_test_fields(test), ['test_data'])

    def test_not_applicable_still_needs_reason(self):
        self.assertFalse(concrete_text('N/A', True))
        self.assertFalse(concrete_text('対象外: TBD', True))
        self.assertTrue(concrete_text('対象外: 静的な画面ラベルの確認で入力を使わない', True))


if __name__ == '__main__':
    unittest.main()
