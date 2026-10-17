"""Regression tests for standalone, lossless review projections."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from document_model import build_model
from render_documents import rendered_files, safe_stem


class ProjectionTests(unittest.TestCase):
    def test_details_and_change_impact_are_not_lost(self):
        model = build_model(ROOT / 'evals/fixtures/spec-only')
        model['requirements'][0]['body'] = 'story-body-sentinel'
        model['functions'][0]['inputs'] = ['function-input-sentinel']
        model['test_cases'][0]['steps'] = ['test-action-sentinel']
        model['test_cases'][0]['test_data'] = ['test-data-sentinel']
        model['change_impact'] = [{'id': 'OLD', 'change': 'retired', 'source_key': 'old', 'impact': 'impact-sentinel'}]
        files = rendered_files(model, 'x')
        for content in files.values():
            self.assertIn('impact-sentinel', content)
        for marker in ('story-body-sentinel', 'function-input-sentinel', 'test-action-sentinel', 'test-data-sentinel'):
            self.assertIn(marker, files['x_レビュー.html'])
        self.assertIn('test-data-sentinel', files['x_テスト一覧.md'])
        self.assertEqual(files, rendered_files(json.loads(json.dumps(model, sort_keys=True)), 'x'))

    def test_filename_reserved_extension(self):
        self.assertTrue(safe_stem('CON.txt').startswith('feature-'))
        self.assertLessEqual(len(safe_stem('x' * 500)), 120)

    def test_reader_facing_documents_use_plain_japanese_labels(self):
        model = build_model(ROOT / 'evals/fixtures/spec-only')
        files = rendered_files(model, 'x')
        for name, content in files.items():
            if name.endswith('.json'):
                continue
            self.assertIn('未設定（要確認）', content)
            self.assertNotIn('acceptance-scenario', content)
            self.assertNotIn('> current <', content)
        requirements = files['x_要件定義書.md']
        self.assertIn('| AC-001 | 受入条件 |', requirements)
        self.assertIn('| FR-001 | 機能要件 |', requirements)
        self.assertIn('| 今回の対象 |', requirements)
        tests = files['x_テスト一覧.md']
        self.assertIn('| 正常系 |', tests)
        self.assertIn('| 異常系 |', tests)
        self.assertIn('テスト段階: 要件確認テスト（実装方式に依存しない確認）', tests)
        self.assertIn('要具体化', tests)

    def test_beginner_review_surfaces_completion_and_next_actions(self):
        model = build_model(ROOT / 'evals/fixtures/spec-only')
        files = rendered_files(model, 'x')
        for name in ('x_要件定義書.md', 'x_機能一覧.md', 'x_テスト一覧.md'):
            content = files[name]
            self.assertIn('## この資料で分かること', content)
            self.assertIn('## 現在の確認状況', content)
            self.assertNotIn('## 詳細・根拠', content)
            self.assertNotIn('traceability-review', content)
            self.assertNotIn('semantic-review', content)
        self.assertIn('元資料: spec.md 16行目', files['x_テスト一覧.md'])
        html = files['x_レビュー.html']
        self.assertIn('class="dashboard"', html)
        self.assertIn('下書き：確認が残っています', html)
        self.assertIn('要具体化', html)
        self.assertIn('確認推奨', html)
        self.assertIn('<details class="item-details">', html)
        self.assertIn('id="panel-requirements" aria-labelledby="tab-requirements" hidden', html)
        self.assertNotIn('Feature Specification:', html)

    def test_review_distinguishes_links_from_review_completion(self):
        model = build_model(ROOT / 'evals/fixtures/spec-only')
        files = rendered_files(model, 'x')
        requirements = files['x_要件定義書.md']
        html = files['x_レビュー.html']
        self.assertLess(requirements.index('| US-001 |'), requirements.index('| AC-001 |'))
        self.assertIn('>要確認</span>', html)
        self.assertNotIn('>接続済み</span>', html)
        self.assertIn('id="diagnostic-details"', html)
        self.assertIn('テストデータを具体化してください。', html)
        self.assertNotIn('concrete test operation/expectation is unresolved', html)
        self.assertIn('.tabs button span{color:#172033', html)
        self.assertIn('details:not([open])>:not(summary){display:block!important}', html)
        self.assertNotIn('独立要件', files['x_機能一覧.md'])
        self.assertNotIn('暫定機能境界', files['x_機能一覧.md'])

    def test_markdown_does_not_claim_completion_while_machine_warnings_remain(self):
        model = build_model(ROOT / 'evals/fixtures/spec-only')
        for question in model['open_questions']:
            question['status'] = 'resolved'
        for test in model['test_cases']:
            test['preconditions'] = test.get('preconditions') or ['準備済み']
            test['steps'] = ['確認操作を行う']
            test['test_data'] = ['確認用データ']
            test['expected_result'] = test.get('expected_result') or '結果を確認できる'
        requirements = rendered_files(model, 'x')['x_要件定義書.md']
        self.assertIn('**文書の段階**: レビュー中', requirements)
        self.assertNotIn('**文書の段階**: レビュー完了', requirements)

    def test_unknown_technical_diagnostic_is_hidden_but_preserved(self):
        model = build_model(ROOT / 'evals/fixtures/spec-only')
        message = 'NEW-CHECK: implementation-specific condition failed'
        model['report']['axes']['requirements_quality']['warnings'].append(message)
        from render_documents import review_html
        html = review_html(model)
        self.assertIn('利用者向けに未翻訳の技術的な指摘', html)
        self.assertIn('<summary>担当者向け技術情報</summary><code>' + message + '</code>', html)

    def test_related_ids_have_hover_and_keyboard_previews(self):
        model = build_model(ROOT / 'evals/fixtures/spec-only')
        html = rendered_files(model, 'x')['x_レビュー.html']
        self.assertIn('class="id-link" href="#node-FNC-001" data-preview="機能: 通知先を登録する"', html)
        self.assertIn('data-preview="受入条件: 事前条件: 通知先が未登録', html)
        self.assertIn('id="id-preview-tooltip" class="hover-tooltip" role="tooltip" hidden', html)
        self.assertIn("addEventListener('mouseover'", html)
        self.assertIn("addEventListener('focusin'", html)
        self.assertIn("link.setAttribute('aria-describedby',tip.id)", html)


if __name__ == '__main__':
    unittest.main()
