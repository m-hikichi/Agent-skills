import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from document_model import build_model


class MultilineAcceptanceTest(unittest.TestCase):
    def test_nested_conditions_and_notes_stay_within_their_boundaries(self):
        for marker in ['**Acceptance Scenarios**:', '#### Acceptance Scenarios']:
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp)
                (path / 'spec.md').write_text(f'''# Feature
### User Story 1 - View (Priority: P1)
{marker}
1. Given A, When B, Then verify:
   - success message appears
   - balance equals 10
2. Given X, When Y, Then Z.
**Notes**:
1. Deployment reminder only.
''', encoding='utf-8')
                model = build_model(path)
                scenarios = [r for r in model['requirements'] if r['kind'] == 'acceptance-scenario']
                self.assertEqual(len(scenarios), 2)
                self.assertIn('success message appears', scenarios[0]['statement'])
                self.assertIn('balance equals 10', scenarios[0]['statement'])
                self.assertNotIn('Deployment', str(scenarios))

    def test_all_scenarios_keep_continuations_and_test_expectations(self):
        for marker in ['**Acceptance Scenarios**:', '#### Acceptance Scenarios', '**受入条件**:']:
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as tmp:
                lines = ['# Feature', '## User Scenarios & Testing']
                expected = []
                for story, count in enumerate([4, 7, 9], 1):
                    lines += [f'### User Story {story} - Story {story} (Priority: P1)', marker, '']
                    for n in range(count):
                        start = len(lines) + 1
                        lines += [f'{n+1}. **Given** input {story}-{n}, **When** operation {n},',
                                  f'   **Then** result {story}-{n}', '   remains visible', '']
                        expected.append((f'US-{story:03}', start, f'result {story}-{n} remains visible'))
                path = Path(tmp)
                (path / 'spec.md').write_text('\n'.join(lines), encoding='utf-8')
                model = build_model(path)
                actual = sorted((r for r in model['requirements'] if r['kind'] == 'acceptance-scenario'), key=lambda r: int(r['source_refs'][0].split('#L')[1]))
                self.assertEqual(len(actual), 20)
                tests = {t['id']: t for t in model['test_cases']}
                for req, (parent, line, outcome) in zip(actual, expected):
                    self.assertEqual(req['parent_id'], parent)
                    self.assertEqual(req['source_refs'], [f'spec.md#L{line}'])
                    self.assertTrue(req['statement'].endswith(outcome))
                    linked = [tests[l['to_id']] for l in model['links'] if l['type'] == 'requirement-to-test' and l['from_id'] == req['id']]
                    self.assertEqual(len(linked), 1)
                    self.assertEqual(linked[0]['expected_result'], outcome)
                    self.assertTrue(linked[0]['preconditions'])
                    self.assertNotEqual(linked[0]['steps'], ['unspecified'])

    def test_bold_next_section_and_fenced_examples_are_not_scenarios(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'spec.md').write_text('''# Feature
### User Story 1 - View (Priority: P1)
**Acceptance Scenarios**:
1. **Given** input,
   **When** opened,
   **Then** displayed.

```md
2. Given fake, When fake, Then fake.
```
**Notes**:
1. Not an acceptance scenario.
   Must not attach.
''', encoding='utf-8')
            model = build_model(path)
            scenarios = [r for r in model['requirements'] if r['kind'] == 'acceptance-scenario']
            self.assertEqual(len(scenarios), 1)
            self.assertEqual(scenarios[0]['statement'], 'Given input, When opened, Then displayed.')


if __name__ == '__main__':
    unittest.main()
