"""Reproducible fixture/CLI matrix; not a semantic or performance benchmark."""
import json
import argparse
from pathlib import Path
import subprocess
import sys

WORKSPACE = Path(__file__).resolve().parents[3]
SKILL = WORKSPACE / "skills/speckit-requirements-functions-tests"
parser = argparse.ArgumentParser()
parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "matrix")
OUTPUT = parser.parse_args().output_dir.resolve()
results = []
for name in ("complete-feature", "japanese-custom-headings", "spec-only", "tasks-no-tests", "unknown-extra", "unresolved-quality"):
    feature = SKILL / "evals/fixtures" / name
    output = OUTPUT / name
    command = [sys.executable, "-X", "utf8", str(SKILL / "scripts/generate_documents.py"), str(feature), "--output-dir", str(output), "--name", name]
    if (feature / "extra-artifacts.json").exists():
        command += ["--extra-artifacts", str(feature / "extra-artifacts.json")]
    generated = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
    if generated.returncode:
        raise RuntimeError(generated.stderr)
    canonical = output / f"{name}_requirements-functions-tests.json"
    for profile, expected in (("draft", 0), ("publish", 1)):
        checked = subprocess.run([sys.executable, "-X", "utf8", str(SKILL / "scripts/check_documents.py"), str(feature), str(canonical), "--output-dir", str(output), "--profile", profile], capture_output=True, text=True, encoding="utf-8")
        assert checked.returncode == expected, (name, profile, checked.stdout, checked.stderr)
        report = json.loads(checked.stdout)
        results.append({"fixture": name, "profile": profile, "exit_code": checked.returncode, "expected_exit_code": expected, "status": report["status"], "blocking_errors": report["blocking_errors"]})
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"PASS: {len(results)} CLI checks; unknown-extra uses its manifest. Results: {OUTPUT / 'results.json'}")
