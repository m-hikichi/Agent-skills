# Independent grading guide

`formal-results.json`はdeck作成者ではなく、fixture、生成source、静的asset、rendered pagesを読める独立graderが記入します。render manifestやreviewの自己申告だけを根拠にせず、数値は元fixtureとchart SVG、must-includeは全ページとnotesを照合します。

## 共通check

| Check | Pass条件 |
|---|---|
| `evidence_fidelity` | 実績claim、数値、期間、単位、母数がfixtureと一致し、fixtureにない値は仮説・要確認として区別される |
| `must_include_coverage` | promptとbriefの必須項目が、読める本文・図表・notesとしてすべて存在する |
| `export_success` | PDFが開け、全2x PNGが連番で存在し、PDFページ数・PNG数・slide数が一致する |
| `overflow_free` | machine QAがpassし、2x PNGの目視でもclip、重なり、孤立改行、読めない縮小がない |
| `assets_complete` | 参照assetが存在し、manifestのhash・provenanceと一致する |
| `chart_scales_clear` | chartがある場合は軸、単位、期間、source、比較可能な尺度を持つ。chartがなければその事実をevidenceに書く |
| `informative_alt_complete` | 意味を伝える画像すべてに具体的altがあり、装飾画像と区別される |
| `artifact_bundle_complete` | source、theme、asset、2x PNG、contact sheet、QA、revision、review、fingerprintが揃い、v1はrender iteration 2以上 |

`passed: true`のevidenceは「確認した」だけでは不足です。例: `page-004 chart SVGの配送確認=1480、period=2026-04_to_2026-06をCSV 2行目と照合`のように、page/file/valueを特定します。該当しないcheckは`true`へ自動変換せず、なぜ非該当でも品質gateを満たすかを書きます。

## Case 1 — executive PoC

- 承認対象は90日、上限3,000,000円、配送確認・契約変更・請求。自動返信と個人情報回答は対象外。
- 実績期間は`2026-04_to_2026-06`。CSVの件数は配送確認1,480、契約変更920、請求760、製品操作620、その他600。
- success gateは一次回答時間50%短縮、再問い合わせ率を悪化させない、週次更新2時間以下。
- production rollout金額はfixtureにないため確定値にできない。
- `real_data_chart`はCSVから生成された静的chartで、軸・件・期間・sourceを持つ場合だけpass。

## Case 2 — churn read-ahead

- 必須action titleは「契約後7日以内に初期設定を完了できなかった顧客では、全契約月で90日継続率が低かった」。意味を短縮した別見出しでは代用しない。
- 90日継続率は、2026-01が78.0%対54.1%、02が76.0%対52.2%、03が76.8%対50.8%。各母数もCSVと照合する。
- event data欠損31件をprimary comparisonから除外し、観察研究であることを開示する。
- `long_japanese_title_readable`は2x PNGでclip、極端な縮小、1文字だけの孤立行がない場合だけpass。

## Case 3 — SRE training

- 10:02:11Zのcheckout 2.8.0 deploy後、10:05:03Zにp95 4217ms / status 504とpayment timeoutが観測される。時間的近接だけでroot cause確定にしない。
- service比較はcheckout 220→4200ms、search 175→182ms、profile 198→205ms。
- 90秒演習に回答形式があり、presenter notesに進め方または模範観点がある。
- `structure_diagram`は提供`architecture.svg`または根拠を保った派生静的図を実際に使用した場合、`presenter_notes`はexportされたnotesでも確認できる場合だけpass。

## Case 4 — research trial

- 12週間、volunteer 48名、final survey 42名、baseline 4週対trial 9〜12週。対照群はない。
- intervalはfocus `0.8 [0.2, 1.4]`、weekly output `0.4 [-0.3, 1.1]`、after-hours `-1.6 [-2.4, -0.8]`、defects `-0.2 [-1.0, 0.6]`。
- selection bias、release時期と季節性、自己申告、欠損6名、expectancy effectの少なくとも主要な限界を開示する。
- `uncertainty_visual`は点推定だけでなく区間、zero reference、単位、12週間、sourceを読める静的visualで示した場合だけpass。

## Case 5 — branded team

- 色はprimary `#143B5D`、signal `#F28C52`、canvas `#F5F1E8`、ink `#17212B`。signalは強調に使い、装飾として乱用しない。
- logoをrecolor、stretch、rotateせず、Nの高さ以上のclear spaceを確保し、busy imageへ重ねない。
- 外部素材を追加せず、提供`logo.svg`と`team-workspace.svg`のprovenance・hash・altをmanifestで追える。
- `meaningful_local_visual`は提供workspace visualが内容を担う形でrenderされている場合、`brand_constraints`はguideの色・logo・tone・画像処理を2x PNGで確認できる場合だけpass。

## skill-creator grading.json

各`expectations`要素は次の3 fieldを使います。

```json
{
  "text": "cohort chartの値と母数がCSVに一致する",
  "passed": true,
  "evidence": "page-003の6値とnをchurn-cohorts.csv全6行へ照合した"
}
```

summaryの`passed / failed / total / pass_rate`は配列から再計算し、`timing.json`と矛盾させません。designの好みをformal passへ混ぜず、見た目の総合判断は匿名blind reviewへ残します。
