"""Validate decided documents without asserting app tests or human approval."""
import json
import subprocess
import sys
from build_documents import HERE, ROOT, FEATURE, STEM, save
from document_model import evaluate_model
from render_documents import write_rendered
from schema_validation import require_valid_model

out = HERE / 'decision-reviewed'
canonical = out / f'{STEM}_requirements-functions-tests.json'
model = json.loads(canonical.read_text(encoding='utf-8'))
require_valid_model(model, FEATURE)
model['report'] = evaluate_model(model, FEATURE, 'draft')
save(canonical, model)
write_rendered(model, out, STEM, FEATURE)
results = {}
for profile, expected in [('draft', 0), ('publish', 1)]:
    run = subprocess.run([sys.executable, str(ROOT / 'skills/speckit-requirements-functions-tests/scripts/check_documents.py'), str(FEATURE), str(canonical), '--output-dir', str(out), '--profile', profile], capture_output=True, text=True, encoding='utf-8')
    assert run.returncode == expected, (run.stdout, run.stderr)
    results[profile] = {'exit_code': run.returncode, 'report': json.loads(run.stdout)}
save(out / 'verification.json', results)
print(json.dumps({'draft_errors':results['draft']['report']['blocking_errors'], 'publish_errors':results['publish']['report']['blocking_errors'], 'open_questions':[q['id'] for q in model['open_questions'] if q['status']!='resolved']}, ensure_ascii=False))
