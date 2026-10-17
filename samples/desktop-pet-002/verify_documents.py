"""Read-only source verification and update-safety probes on temporary copies."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from build_documents import HERE, ROOT, FEATURE, STEM, save
from document_model import build_model

SCRIPTS = ROOT / 'skills/speckit-requirements-functions-tests/scripts'
OUT = HERE / 'review-draft'
CANON = f'{STEM}_requirements-functions-tests.json'


def hashes(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob('*') if p.is_file()}


def run(script, *args):
    result = subprocess.run([sys.executable, str(SCRIPTS / script), *map(str, args)], capture_output=True, text=True, encoding='utf-8', env={**os.environ, 'PYTHONUTF8': '1'})
    return result.returncode, result.stdout, result.stderr


def main():
    before = hashes(FEATURE)
    model = json.loads((OUT / CANON).read_text(encoding='utf-8'))
    fresh = build_model(FEATURE)
    recovered = {r['source_refs'][0]: r for r in model['requirements'] if r['kind'] == 'acceptance-scenario'}
    extracted = {r['source_refs'][0]: r for r in fresh['requirements'] if r['kind'] == 'acceptance-scenario'}
    assert recovered.keys() == extracted.keys()
    for source, req in recovered.items():
        assert req['statement'] == extracted[source]['statement'], source
        assert req['parent_id'] == extracted[source]['parent_id'], source
    source_checks = {s['path']: before[s['path']] == s['sha256'] for s in model['sources']}
    assert all(source_checks.values())
    records = {}
    records['fresh_automatic_extraction_matches_20_reconstructed_scenarios'] = True
    for profile, expected in [('draft', 0), ('publish', 1)]:
        code, stdout, stderr = run('check_documents.py', FEATURE, OUT / CANON, '--output-dir', OUT, '--profile', profile)
        assert code == expected, (code, stdout, stderr)
        records[profile] = {'exit_code': code, 'report': json.loads(stdout)}
    # Only copies are mutated. No app startup/build/test is part of this probe.
    with tempfile.TemporaryDirectory(prefix='desktop-pet-doc-check-') as tmp:
        tmp = Path(tmp)
        source = tmp / 'feature'
        target = tmp / 'documents'
        shutil.copytree(FEATURE, source)
        shutil.copytree(OUT, target)
        original = hashes(target)
        args = [source, '--output-dir', target, '--name', STEM, '--profile', 'draft', '--extra-artifacts', HERE / 'extra-artifacts.json']
        code, stdout, stderr = run('generate_documents.py', *args)
        assert code == 0, (stdout, stderr)
        assert original == hashes(target), 'same-input regeneration altered reviewed documents'
        records['same_input_preserved'] = True
        spec = source / 'spec.md'
        spec.write_text(spec.read_text(encoding='utf-8') + '\n<!-- update-safety probe: temporary copy only -->\n', encoding='utf-8')
        code, stdout, stderr = run('generate_documents.py', *args)
        assert code == 1, (stdout, stderr)
        assert original == hashes(target), 'changed input overwrote edited documents'
        records['changed_input_refused'] = {'exit_code': code, 'original_files_unchanged': True}
        code, stdout, stderr = run('generate_documents.py', *args, '--update-proposal')
        assert code == 0, (stdout, stderr)
        assert all(hashes(target)[key] == value for key, value in original.items())
        proposal = target / f'{STEM}_update-proposal_requirements-functions-tests.json'
        assert proposal.exists()
        records['separate_update_proposal'] = True
    assert before == hashes(FEATURE), 'external source changed during verification'
    records['external_source_unchanged_during_verification'] = True
    records['source_hashes_match_initial_generation'] = source_checks
    records['acceptance_count'] = sum(r['kind'] == 'acceptance-scenario' for r in model['requirements'])
    assert records['acceptance_count'] == 20
    for r in model['requirements']:
        if r['kind'] == 'acceptance-scenario':
            assert all(word in r['statement'] for word in ['Given ', 'When ', 'Then '])
    current = {r['id'] for r in model['requirements'] if r['status'] == 'current' and r['kind'] not in {'assumption', 'clarification', 'out-of-scope', 'other'}}
    linked = {l['from_id'] for l in model['links'] if l['type'] == 'requirement-to-test'}
    assert current <= linked
    records['linked_current_requirements'] = len(current)
    records['counts'] = {key: len(model[key]) for key in ['requirements', 'functions', 'test_cases', 'open_questions']}
    records['not_executed'] = ['desktop-pet application tests', 'browser interaction/visual check', 'final independent semantic review']
    save(HERE / 'verification.json', records)
    print(json.dumps({k: v for k, v in records.items() if k not in {'draft', 'publish', 'source_hashes_match_initial_generation'}}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
