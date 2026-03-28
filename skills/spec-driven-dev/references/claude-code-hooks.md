# Claude Code hooks 連携

spec-driven-dev の core family を親ルーター + 子 skill 群へ分割した後も、Claude Code で「reviewer OK が出るまで終わらせない」運用にしたいなら、`Stop` / `SubagentStop` hook は必須。`SKILL.md` だけでは作業手順は伝えられても、完了を強制的に止めることはできない。

## 役割分担

- 親 `spec-driven-dev` の frontmatter `Stop` hook
  - 最終メッセージに `## 最終整合性監査` と `判定:` があるかを確認する
  - 親が組み立てる最終 close out の書式崩れを減らす
- child skill (`spec-authoring` / `spec-implementation` / `spec-audit` など)
  - 自分の責務範囲の summary / findings を返す
  - reviewer 本体や最終停止判定は持たない
- `.claude/settings.json` の `Stop` / `SubagentStop` hook
  - `run_verify_stop_hook.*` reviewer を毎回実行する
  - reviewer が NG を返したら Claude Code の停止をブロックする

強制力があるのは後者。前者は補助であって、完了ブロックの本体ではない。

## 分割後も変えないこと

- 親 skill は `spec-driven-dev` のまま
- core child skill は `spec-impact-analysis`、`spec-authoring`、`spec-implementation`、`spec-audit`
- hooks / reviewer / verification scripts は `spec-driven-dev/scripts/` に集約したままにする
- `.claude/settings.json` の reviewer パスも `spec-driven-dev/scripts/run_verify_stop_hook.*` のままにする

`reverse-spec` は family 外の bootstrap skill として扱う。必要なら同じ `skills/` 階層に置くが、core child skill には含めない。

## reviewer が見る 3 条件

`run_verify_stop_hook.ps1` / `run_verify_stop_hook.sh` は次を機械的に確認する。

1. `verify_spec_consistency.py` が成功する
2. `verification.project_test_commands` が成功する
3. 最終メッセージの `## 最終整合性監査` が `判定: clean` になる

`判定: needs-user-decision` は「人間の判断待ちなので一旦止めてよい」という一時停止の印であり、完了扱いではない。これにより、修正で解ける NG と、人間確認が必要な停止を分けられる。

## なぜ `Stop` と `SubagentStop` の両方が必要か

- `Stop` が無いと、メインエージェントが最後に「終わりました」と言った時点で抜けられる
- `SubagentStop` が無いと、途中で使ったサブエージェントが review 前に抜けられる

どちらか片方だけだと抜け道が残る。完了ブロックまで含めるなら両方入れる。

## 前提

- `spec-driven-dev` がインストール済み
- 分割した子 skill を使う場合は sibling 構成で一緒に配置されている
- プロジェクトに `docs/requirements.md`、`docs/specs/`、`docs/traceability-matrix.md`、`spec-config.json` がある
- `spec-config.json` の `verification.consistency_runner` が `docker`
- `spec-config.json` の `verification.project_test_commands` が空でない
- ホストに Python 3 がある
- Docker が使える

## 最小構成

### Windows PowerShell

`.claude/settings.json` または `~/.claude/settings.json` に次を入れる。

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "shell": "powershell",
            "command": "& \"$env:USERPROFILE\\.codex\\skills\\spec-driven-dev\\scripts\\run_verify_stop_hook.ps1\" -ProjectRoot \"$env:CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "shell": "powershell",
            "command": "& \"$env:USERPROFILE\\.codex\\skills\\spec-driven-dev\\scripts\\run_verify_stop_hook.ps1\" -ProjectRoot \"$env:CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  }
}
```

### macOS / Linux

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "sh \"$HOME/.codex/skills/spec-driven-dev/scripts/run_verify_stop_hook.sh\" \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "sh \"$HOME/.codex/skills/spec-driven-dev/scripts/run_verify_stop_hook.sh\" \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  }
}
```

## NG のとき何が起きるか

- reviewer が 3 条件のどれかを満たしていないと判断すると、NG を返す
- Claude Code はそのまま止まらず、reason を次の指示として Claude に返す
- Claude は修正を続けるか、`判定: needs-user-decision` でユーザー確認に切り替える

ここで大事なのは、NG のときに「失敗したから終わる」のではなく、「失敗したから続ける」こと。

## これで防げること

- `verify_spec_consistency.py` を回さずに「終わった」と言うこと
- プロジェクト固有テストを回さずに止まること
- `最終整合性監査` を書かずに終わること
- サブエージェントだけが先に抜けること
- 親 skill で入った作業でも、子 skill で入った作業でも、共通 reviewer を経ずに完了扱いにすること

## それでも残る限界

- テストが弱ければ、`project_test_commands` が通っても意味的な欠陥は残りうる
- `判定: needs-user-decision` は一時停止であり、完了保証ではない
- product decision 自体の正しさまでは hook だけでは決められない

このため、機械ゲートは「終わる前の最低条件」を強くするものだと捉える。仕様やテストの中身そのものを良くする責任までは置き換えない。
