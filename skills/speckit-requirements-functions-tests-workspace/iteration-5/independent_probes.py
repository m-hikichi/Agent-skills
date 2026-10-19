"""Independent behavioral probes; only ephemeral copies are modified."""
from pathlib import Path
import copy
import json
import shutil
import subprocess
import sys
import tempfile

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'skills' / 'speckit-requirements-functions-tests').is_dir())
SCRIPTS = ROOT / 'skills/speckit-requirements-functions-tests/scripts'
sys.path.insert(0, str(SCRIPTS))
from document_model import build_model, evaluate_model, json_text
from review_integrity import attest_review, review_digest, review_issue
from render_documents import test_readiness
from update_safety import UpdateConflict
from test_quality import concrete_text

SAMPLE = ROOT / 'skills/speckit-requirements-functions-tests-workspace/iteration-4/eval-multi-function/with_skill/outputs'
base = json.loads((SAMPLE / 'orders_requirements-functions-tests.json').read_text(encoding='utf-8'))
results = []
def record(name, actual, expected):
    results.append(dict(probe=name, passed=actual == expected, actual=actual, expected=expected))
def attest(model):
    attest_review(model, expected_digest=review_digest(model), reviewer='independent-review diagnostic', summary='Synthetic diagnostic only, not business approval')

attest(base)
record('valid reviewed many-to-many', evaluate_model(base, SAMPLE / 'input', 'publish')['blocking_errors'], 0)
for field, mutate in [
    ('test expected result', lambda m: m['test_cases'][0].update(expected_result='different expected result')),
    ('link removal', lambda m: m['links'].pop()),
    ('source fingerprint', lambda m: m['sources'][0].update(sha256='0' * 64)),
    ('question resolution', lambda m: m['open_questions'][0].update(resolution='different conclusion')),
    ('function boundary', lambda m: m['functions'][0].update(summary='different boundary')),
]:
    m = copy.deepcopy(base)
    mutate(m)
    record('review invalidation: ' + field, bool(review_issue(m)), True)
for field, value in [('profile','draft'),('report',{}),('generation_digest','f'*64)]:
    m = copy.deepcopy(base)
    m[field] = value
    record('non-editorial review stability: ' + field, review_issue(m), None)
for value, expected in [
    ('表示は「未設定」である', True),
    ('入力値として "TBD" を設定する', True),
    ('適切なデータ', False),
    ('正しく動作する', False),
    ('準備済み', False),
    ('TODO', False),
    ('不要（入力を伴わない目視レビューのため）', True),
]:
    record('lexical specificity: ' + value, concrete_text(value, True), expected)
m = copy.deepcopy(base)
m['test_cases'][0]['expected_result'] = 'different expectation'
record('UI indicates invalidated content review', test_readiness(m['test_cases'][0],m)[0], '内容レビュー待ち')
for status in ('retired','future'):
    m = copy.deepcopy(base)
    m['functions'][0]['status'] = status
    attest(m)
    record('current requirement cannot be covered by ' + status + ' function', bool(evaluate_model(m, SAMPLE/'input','publish')['axes']['function_coverage']['errors']), True)

with tempfile.TemporaryDirectory(prefix='independent-review-') as temporary:
    work = Path(temporary)
    feature = work / 'feature'
    shutil.copytree(SAMPLE/'input', feature)
    unchanged = build_model(feature, existing=base)
    record('unchanged sources preserve tests', unchanged['test_cases'], base['test_cases'])
    record('unchanged sources preserve links', unchanged['links'], base['links'])
    record('unchanged sources preserve review', unchanged['review_record'], base['review_record'])
    changed_spec = (feature/'spec.md').read_text(encoding='utf-8') + '\nAdditional explanatory sentence.\n'
    (feature/'spec.md').write_text(changed_spec, encoding='utf-8')
    caught = False
    try:
        build_model(feature,existing=base)
    except UpdateConflict:
        caught = True
    record('changed inputs protect reviewed canonical', caught, True)
    proposal = build_model(feature, existing=base, update_proposal=True)
    record('proposal does not carry approval', proposal.get('review_record'), None)
    record('proposal requires comparison', any(q['return_to']=='update-review' and q['status']=='open' for q in proposal['open_questions']), True)

    # Actual record CLI must refuse an obsolete version without touching bytes.
    canonical = work/'review.json'
    m = copy.deepcopy(base)
    canonical.write_text(json_text(m), encoding='utf-8')
    old_digest = review_digest(m)
    m['test_cases'][0]['expected_result'] = 'different expectation'
    canonical.write_text(json_text(m), encoding='utf-8')
    before = canonical.read_bytes()
    cp = subprocess.run([sys.executable,str(SCRIPTS/'review_documents.py'),'record',str(canonical),'--feature-dir',str(SAMPLE/'input'),'--expected-digest',old_digest,'--reviewer','diagnostic','--summary','diagnostic only'],capture_output=True)
    record('stale record CLI refused',cp.returncode,2)
    record('stale record CLI preserves canonical',canonical.read_bytes()==before,True)

    m = copy.deepcopy(base)
    m.pop('review_record', None)
    canonical.write_text(json_text(m), encoding='utf-8')
    common = ['--feature-dir',str(SAMPLE/'input')]
    cp = subprocess.run([sys.executable,str(SCRIPTS/'review_documents.py'),'digest',str(canonical),*common],capture_output=True)
    digest = cp.stdout.decode().strip()
    record('normal digest CLI',cp.returncode,0)
    cp = subprocess.run([sys.executable,str(SCRIPTS/'review_documents.py'),'record',str(canonical),*common,'--expected-digest',digest,'--reviewer','independent-review diagnostic','--summary','Synthetic diagnostic case; input and six test boundaries reviewed; not business approval'],capture_output=True)
    record('normal record CLI',cp.returncode,0)
    cp = subprocess.run([sys.executable,str(SCRIPTS/'render_documents.py'),str(canonical),*common,'--output-dir',str(work/'rendered')],capture_output=True)
    record('normal render CLI after review',cp.returncode,0)
    cp = subprocess.run([sys.executable,str(SCRIPTS/'check_documents.py'),str(SAMPLE/'input'),str(canonical),'--output-dir',str(work/'rendered'),'--profile','publish'],capture_output=True)
    record('normal publish CLI after review',cp.returncode,0)
    m=json.loads(canonical.read_text(encoding='utf-8'))
    m['test_cases'][0]['expected_result']='different expectation'
    canonical.write_text(json_text(m),encoding='utf-8')
    cp = subprocess.run([sys.executable,str(SCRIPTS/'render_documents.py'),str(canonical),*common,'--output-dir',str(work/'rendered')],capture_output=True)
    record('render allowed after invalidation for review',cp.returncode,0)
    cp = subprocess.run([sys.executable,str(SCRIPTS/'check_documents.py'),str(SAMPLE/'input'),str(canonical),'--output-dir',str(work/'rendered'),'--profile','publish'],capture_output=True)
    record('edited then rerendered publish still blocked',cp.returncode,1)

summary = [{'probe': r['probe'], 'passed':r['passed']} for r in results]
print(json.dumps(summary,ensure_ascii=False,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
