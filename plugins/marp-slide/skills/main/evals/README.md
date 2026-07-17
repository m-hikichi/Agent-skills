# marp-slide v1 evaluation

この評価セットは、fixture付き5ケースを同一条件でv0.8とv1へ投入し、形式評価と匿名blind A/Bを分離して実施するためのものです。`evals.json` は `skill-creator` の `evals.json` schemaに合わせて、`skill_name`, `prompt`, `expected_output`, `files`, `expectations` を保持します。追加の `name` は人間が識別しやすいworkspace名にだけ使います。

高価なモデル実行は評価ハーネス自身では行いません。`init` が実行specと出力先を作り、operatorまたは独立agentが同じターンにcandidateとbaselineを起動します。

## 評価対象

| ID | Fixture | 主な検査対象 |
|---:|---|---|
| 1 | `executive-poc` | CSV由来の経営比較chart、費用仮説、90日decision gate |
| 2 | `churn-read-ahead` | 長い日本語action title、cohort忠実性、相関と因果、限界 |
| 3 | `sre-training` | 静的構造図、改変されていないlog、演習、presenter notes |
| 4 | `research-trial` | 点推定と区間、不確実性、代替説明、一般化の抑制 |
| 5 | `branded-team` | ロゴ・色・local visual・alt・asset provenance |

まず定義とfixtureを検査します。

```powershell
skills/main/evals/scripts/run-eval.ps1 validate
```

```sh
skills/main/evals/scripts/run-eval.sh validate
```

launcherはhost Nodeを優先し、なければ固定済み`marp-mcp-server` Docker imageを使います。Docker fallbackでは、plugin snapshotと評価workspaceを現在ディレクトリ配下に置いてください。

## 1. v0.8 / v1 workspaceを固定する

v0.8 plugin全体を編集前の読み取り専用snapshotとして残します。candidateもiterationごとにcopyされるため、実行途中のskill変更が結果へ混ざりません。workspaceはcandidate pluginとbaseline pluginの外側に置きます。

```powershell
plugins/marp-slide/skills/main/evals/scripts/run-eval.ps1 init `
  --workspace marp-slide-eval-workspace `
  --baseline-plugin marp-slide-v0.8-snapshot `
  --candidate-plugin plugins/marp-slide `
  --iteration 1
```

生成される主要構造は`skill-creator`の改善評価形式に合わせています。

```text
marp-slide-eval-workspace/
├── skill-snapshot/                 # immutable v0.8 plugin
├── candidate-snapshot-1/           # immutable v1 plugin for this iteration
├── _private/                        # reviewerへ渡さない対応表
└── iteration-1/
    ├── run-manifest.json
    ├── eval-01-.../
    │   ├── eval_metadata.json       # prompt + assertions
    │   ├── inputs/
    │   ├── with_skill/
    │   │   └── run-1/
    │   │       ├── run-spec.json
    │   │       ├── formal-results.json
    │   │       ├── timing.json
    │   │       ├── grading.json
    │   │       └── outputs/
    │   └── without_skill/
    │       └── run-1/...
    └── eval-05-.../
```

各`run-spec.json`には、固定plugin path、skill path、prompt、staged fixture、出力先が入ります。5ケースすべてについて`with_skill`と`without_skill`を同じターンに起動します。ここで`without_skill`は無skillではなく、benchmark viewerのconfiguration契約に合わせた**v0.8 snapshot**です。片側だけ先に実行したり、片側だけprompt・fixture・rendererを変えたりしません。

## 2. 共通出力契約

両configurationは次の表示用成果物を同じ名前で保存します。

```text
outputs/
├── deck.pdf
├── contact-sheet.png
├── page-001.png
├── ...
└── evidence/
    ├── source, theme, assets
    ├── render-manifest.json
    ├── machine-qa.json
    ├── review.json
    └── revision history
```

v1は全ページ2x PNG、contact sheet、QA、rubric v3、render iteration 2以上、具体的な改善履歴、統合fingerprintを`evidence/`に保存します。v0.8は生成可能な同等証跡を残し、欠けているv1固有artifactを後から捏造しません。

独立graderは[`grading-guide.md`](grading-guide.md)に従い、各runの`formal-results.json`をfixtureと実ファイルから埋めます。`passed`はboolean、`evidence`は検査した値・ページ・ファイルを特定できる文にします。`grading.json`は`skill-creator`の厳密な`text / passed / evidence`形式、`timing.json`はexecutor完了通知のtoken数と所要時間を使います。

## 3. 匿名blind A/B

両側の表示成果物が揃ったらpackageを作ります。

```powershell
plugins/marp-slide/skills/main/evals/scripts/run-eval.ps1 blind `
  --workspace marp-slide-eval-workspace `
  --iteration 1
```

`iteration-1/blind-review/`だけをvisual evaluatorへ渡します。candidateがA/Bの片側へ偏らないよう5ケースを2対3に割り当てます。各caseの`task.json`には共通promptと期待成果だけが入り、A/B対応は`_private/blind-map.iteration-1.json`へ分離されてblind packageには入りません。PNGは表示に影響しないtext/time/EXIF chunkを除去し、中立名へ変更します。元PDFは配布せず、同じ匿名化済みpage PNGからInfo/XMP/Authorを持たないimage-only PDFを再構成するため、ファイルpropertyから版を推測できません。

評価者はMarkdownやsourceを見ず、最初にcontact sheetで全体のリズム・反復・密度を比較し、その後全ページPNGとPDFで次を1〜5点評価します。

- audience / goal fit
- visual semantics（図表から意図した結論を読めるか）
- readability
- deck cohesion
- professional polish

各caseの`review.json`へreviewer ID、A/B/TIE、両側の点数、具体的理由、必要なpage noteを記録します。対応表を見られるoperatorとblind evaluatorを同じ人物・同じagent contextにしません。

## 4. 受入判定

`acceptance-policy.json`が単一の判定policyです。blind reviewと独立graderのformal resultsが完成した後に集計します。

```powershell
plugins/marp-slide/skills/main/evals/scripts/run-eval.ps1 acceptance `
  --workspace marp-slide-eval-workspace `
  --iteration 1
```

passには以下をすべて満たす必要があります。

- 5件中4件以上でv1が総合選好される
- evidence fidelity、must-include coverage、export successが各caseでv0.8から後退しない
- v1のoverflow、asset、chart尺度、informative alt、artifact bundleのhard gateがすべてpass
- data caseに実データchart、long-title caseに可読見出し、technical caseに構造図とnotes、research caseに不確実性visual、brand caseにlocal visualとbrand制約の証跡がある

結果は`iteration-1/acceptance-report.json`へ保存されます。未採点、証拠なし、TIEの多発、hard gate failはpassになりません。

## 5. skill-creator viewer

assertion grading後、公式viewerを使います。独自HTMLへ置き換えません。

```sh
cd /path/to/skill-creator
python -m scripts.aggregate_benchmark /absolute/path/marp-slide-eval-workspace/iteration-1 --skill-name main
python eval-viewer/generate_review.py \
  /absolute/path/marp-slide-eval-workspace/iteration-1 \
  --skill-name main \
  --benchmark /absolute/path/marp-slide-eval-workspace/iteration-1/benchmark.json \
  --static /absolute/path/marp-slide-eval-workspace/iteration-1/review.html
```

viewerの定量benchmarkでは`with_skill`を`without_skill`より先に並べます。blind総合選好は対応表を使うため、viewerの非blind gradingと混ぜず、`acceptance-report.json`で集計します。

使用中の`aggregate_benchmark.py`が`runs_per_configuration`を固定値で出す版では、`benchmark.json`のmetadataを実際のrun数（この手順では1）へ補正します。存在しないrun-2/3を作ったり、片側だけ追加runを足したりしません。

## 6. Gold deck visual regression

対象は`gold-decks.json`に固定したexecutive decision、analytical read-ahead、technical trainingの各8ページです。3 deckを同じ固定rendererで次の形へrenderします。

承認済みの基準値は同じdirectoryの`gold-baseline.json`に保存します。

```text
gold-current/
├── executive-decision/
│   ├── render-manifest.json
│   ├── contact-sheet.png
│   └── rendered-pages/page-001.png ... page-008.png
├── analytical-read-ahead/
└── technical-training/
```

承認済み環境で初回baseline manifestを記録します。

```powershell
plugins/marp-slide/skills/main/evals/scripts/run-eval.ps1 gold-record `
  --render-root gold-current `
  --output gold-baseline.json
```

以降は同じ24ページ、3 contact sheet、render environment、source/theme/assets fingerprintを比較します。

```powershell
plugins/marp-slide/skills/main/evals/scripts/run-eval.ps1 gold-compare `
  --baseline gold-baseline.json `
  --render-root gold-current
```

比較はvolatile PNG metadataを除いた厳密SHA-256と寸法で行います。Marp CLI/Core、Chromium、font、theme、gold source/assetsの変更は意図どおり必ずfailします。fail時はcontact sheetと2xページを目視し、意図した差分だけであることを確認してから、明示的な`gold-record --replace`でbaselineを更新します。環境更新とbaseline更新を無審査で同時に通しません。

## 再現性上の注意

- anonymization seedは対応表にhashだけを残し、生seedをreview packageへ保存しません。テストで再現が必要な場合だけ`blind --seed <secret>`を使います。
- `_private/`、snapshot、生成deckは評価workspaceの成果物でありpluginへcommitしません。commit対象はfixture、policy、catalog、harness、承認済みgold baseline manifestだけです。
- subjective design qualityはMarkdownやlintではなく、contact sheetとfull-resolution pagesで判定します。
- model、token、所要時間、renderer environmentはrunごとに記録し、片側だけ再実行した結果を同一pairとして扱いません。
