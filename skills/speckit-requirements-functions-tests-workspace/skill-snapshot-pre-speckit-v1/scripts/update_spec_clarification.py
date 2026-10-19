# -*- coding: utf-8 -*-
"""Record and resume user-confirmed design decisions."""

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from design_quality import append_clarification, mark_question_resolved, record_confirmation  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="確認回答をspec.mdのClarificationsへ追記")
    parser.add_argument("spec", help="更新するspec.md")
    parser.add_argument("--question", help="確認した質問（designを使わない単独追記時）")
    parser.add_argument("--answer", help="ユーザーの回答")
    parser.add_argument("--date", help="確認日 YYYY-MM-DD（既定: 本日）")
    parser.add_argument("--design", help="同時更新するv2 *.design.json")
    parser.add_argument("--question-id", help="design内のopen_questions.id")
    parser.add_argument("--resolve", action="store_true", help="設計反映済みの回答をresolvedへ進める")
    args = parser.parse_args()

    path = Path(args.spec)
    if args.design:
        if not args.question_id:
            parser.error("--design使用時は--question-idが必要です")
        design_path = Path(args.design)
        cfg = json.loads(design_path.read_text(encoding="utf-8"))
        if args.resolve:
            cfg = mark_question_resolved(cfg, args.question_id)
            design_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"resolved {args.question_id} in {design_path}")
            return
        if not args.answer:
            parser.error("回答記録には--answerが必要です")
        updated, cfg, clarification_id = record_confirmation(
            path.read_text(encoding="utf-8"), cfg, args.question_id, args.answer, args.date
        )
        path.write_text(updated, encoding="utf-8")
        design_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"answered {args.question_id} ({clarification_id}); design反映後に--resolveしてください")
        return
    if not args.question or not args.answer:
        parser.error("単独追記には--questionと--answerが必要です")
    updated, clarification_id = append_clarification(path.read_text(encoding="utf-8"), args.question, args.answer, args.date)
    path.write_text(updated, encoding="utf-8")
    print(f"updated {path} ({clarification_id})")


if __name__ == "__main__":
    main()
