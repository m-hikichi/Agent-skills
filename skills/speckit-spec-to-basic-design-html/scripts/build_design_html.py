# -*- coding: utf-8 -*-
"""基本設計書(機能一覧) HTML ジェネレータ。

JSON 設計データを受け取り、社内 Excel テンプレート（○○_基本設計_機能一覧.xlsx）と
同じ「雰囲気」の **自己完結 HTML** を 1 ファイルで生成する。

ねらいは 2 つを 1 つの成果物で両立すること:
  1. 誰でも見やすい資料 … ブラウザで開けば Excel と同じ見え方（大→中→小の
     セル結合・テーマ色の塗り分け・游ゴシック・タイトル/メタ枠）。Excel に複数シートが
     あったのと同じく、画面下部の **シートタブ**（機能一覧／画面一覧／ユーザーストーリー／
     成功基準ほか／データエンティティ）で切り替えられる。印刷すれば全シートを通しで PDF 化。
     CSS/JS 内蔵・外部依存なしなのでメール添付や社内共有もそのまま。
  2. git で差分が追える … インライン style を使わず CSS クラスで色付けし、
     1 機能行 = HTML 1 行（<tr> を 1 行に収める）で出力する。これにより
     「概要を 1 か所直した」→「diff も 1 行だけ」になり、何が変わったかを
     日本語のまま PR/コミットで確認できる。

機能一覧の列（レビューしやすいよう「機能」と「要件」を分離 + 画面紐付けを追加）:
    大分類 / (ID) / 中分類 / (ID) / 小分類 / (ID) /
    機能名 / 概要 / 業務ルール / 画面 / 要求ID

使い方:
    python build_design_html.py design.json
    python build_design_html.py design.json -o 出力.html

JSON スキーマとサンプルは references/format_spec.md を参照。
"""
import argparse
import html
import json
import re
import sys
from datetime import datetime

# ── Excel テンプレートの実テーマ色（Office 既定: accent5=teal / accent6=orange）を
#    そのまま採用。中/小分類は Excel の「明るく 40%/80%」相当。雰囲気を完全一致させる。
HEADER_BG = "#C6D9F1"   # ヘッダ行（テンプレート実値）
DAI_BG = "#4BACC6"      # 大分類 = Aqua, Accent 5
CHU_BG = "#92CDDC"      # 中分類 = Aqua, Accent 5, 明るく 40%
SHO_BG = ["#DAEEF3", "#FDE9D9"]  # 小分類 = accent5/accent6 明るく 80%（隣接で交互）
FUTURE_BG = "#EFEFEF"   # 将来対応（将来バージョンで提供予定）の行（淡色で控えめに区別）
GRID = "#BFBFBF"        # 罫線

# 機能一覧の列見出しと相対幅（合計 100%、table-layout:fixed + 折返し）。
HEADERS = ["大分類", "大分類ID", "中分類", "中分類ID", "小分類", "小分類ID",
           "機能名", "概要", "業務ルール", "画面", "要求ID"]
COL_WIDTHS = ["6.5%", "2.5%", "6.5%", "2.5%", "6.5%", "2.5%",
              "9%", "16%", "29.5%", "13%", "5.5%"]
WIDTH_CLASSES = {
    "2.5%": "w025", "5.5%": "w055", "6%": "w060", "6.5%": "w065",
    "9%": "w090", "10%": "w100", "13%": "w130", "16%": "w160",
    "18%": "w180", "22%": "w220", "24%": "w240", "26%": "w260",
    "29.5%": "w295", "44%": "w440", "72%": "w720", "78%": "w780",
}


def esc(v):
    """セル値を HTML エスケープし、改行は <br> に。None/数値も安全に文字列化。"""
    if v is None:
        v = ""
    return html.escape(str(v)).replace("\n", "<br>")


def _is_future(r):
    """行/画面が『将来対応』（将来バージョンで提供予定）か。
    推奨キーは future。将来 / out_v1 / 対象外 も後方互換で受け付ける。"""
    return bool(r.get("future") or r.get("将来") or r.get("out_v1") or r.get("対象外"))


def _fmt_date(v):
    """YYYY-MM-DD / YYYY/MM/DD を『YYYY年MM月DD日』へ。それ以外は素通し。"""
    if isinstance(v, str):
        for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                d = datetime.strptime(v, fmt)
                return f"{d.year}年{d.month:02d}月{d.day:02d}日"
            except ValueError:
                continue
    return v


def _as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _colgroup(widths):
    """列幅を CSS class で指定し、style 属性を成果物へ出さない。"""
    if not widths:
        return ""
    try:
        cols = "".join(f'<col class="{WIDTH_CLASSES[w]}">' for w in widths)
    except KeyError as exc:
        raise ValueError(f"未定義の列幅です: {exc.args[0]}") from exc
    return f"<colgroup>{cols}</colgroup>"


def validate_config(cfg):
    """新スキーマの必須品質と画面参照を、描画前に検証する。"""
    errors = []
    function_list = cfg.get("function_list")
    if not isinstance(function_list, list) or not function_list:
        errors.append("function_list は1件以上の配列で指定してください")
        function_list = []

    screens = cfg.get("screens", []) or []
    screen_ids = [str(s.get("id", "")).strip() for s in screens]
    defined_screen_ids = {sid for sid in screen_ids if sid}
    for index, screen in enumerate(screens, 1):
        if not str(screen.get("id", "")).strip():
            errors.append(f"画面 {index}: 画面IDが空です")
        if not str(screen.get("name", "")).strip():
            errors.append(f"画面 {index}: 画面名が空です")
    if len(defined_screen_ids) != len([sid for sid in screen_ids if sid]):
        errors.append("screens の画面IDが重複しています")

    referenced_screen_ids = set()
    question_rows = []
    row_count = 0
    for dai in function_list:
        for chu in dai.get("children", []):
            for sho in chu.get("children", []):
                for row in sho.get("rows", []):
                    row_count += 1
                    name = str(row.get("機能名") or row.get("細分類") or "").strip()
                    is_new = any(k in row for k in ("機能名", "業務ルール", "画面"))
                    if not name:
                        errors.append(f"機能行 {row_count}: 機能名が空です")
                    if not is_new:
                        continue
                    if not str(row.get("概要", "")).strip():
                        errors.append(f"機能行 {row_count} ({name}): 概要が空です")
                    rules = [str(x).strip() for x in _as_list(row.get("業務ルール")) if str(x).strip()]
                    if not rules:
                        errors.append(f"機能行 {row_count} ({name}): 業務ルールが空です")
                    elif any("要確認" in rule for rule in rules):
                        question_rows.append((name, set(re.findall(r"FR-\d+", str(row.get("FR", ""))))))
                    row_screens = [str(x).strip() for x in _as_list(row.get("画面")) if str(x).strip()]
                    if not row_screens:
                        errors.append(f"機能行 {row_count} ({name}): 画面が空です")
                    for screen in row_screens:
                        if screen.startswith("SCR-"):
                            referenced_screen_ids.add(screen)
                            if screen not in defined_screen_ids:
                                errors.append(
                                    f"機能行 {row_count} ({name}): 未定義の画面ID {screen} を参照しています"
                                )
                    if not str(row.get("FR") or row.get("由来FR") or "").strip():
                        errors.append(f"機能行 {row_count} ({name}): 要求IDが空です")

    unused_screen_ids = defined_screen_ids - referenced_screen_ids
    if unused_screen_ids:
        errors.append("どの機能からも参照されない画面があります: " + ", ".join(sorted(unused_screen_ids)))
    question_entries = [
        f'{item.get("項目", "")} {item.get("内容", "")}'
        for item in (cfg.get("criteria", []) or [])
        if item.get("区分") == "要確認"
    ]
    for name, fr_ids in question_rows:
        if not any(name in entry or any(fr_id in entry for fr_id in fr_ids) for entry in question_entries):
            errors.append(f"機能行 ({name}): 業務ルールの要確認事項が criteria にありません")
    if row_count == 0:
        errors.append("function_list に機能行がありません")
    if errors:
        raise ValueError("設計データの検証に失敗しました:\n- " + "\n- ".join(errors))


def normalize_row(r):
    """機能行を (機能名, 概要, 業務ルール[list], 画面[list], 要求ID) に正規化。

    新スキーマ（業務ルール/画面 あり）と旧スキーマ（機能/概要 のみ）の両対応:
      - 新: 概要=概要, 業務ルール=業務ルール
      - 旧: 概要=機能（動作説明）, 業務ルール=[概要]（旧概要を1ルールに退避）
    これにより旧Excel版の design.json もそのまま描画できる。
    """
    name = r.get("機能名") or r.get("細分類") or ""
    if "業務ルール" in r or "画面" in r:          # 新スキーマ
        gaiyo = r.get("概要", "")
        rules = _as_list(r.get("業務ルール"))
    else:                                          # 旧スキーマ（後方互換）
        gaiyo = r.get("機能", "")
        rules = [r["概要"]] if r.get("概要") else []
    screens = _as_list(r.get("画面"))
    fr = r.get("FR") or r.get("由来FR") or ""
    return name, gaiyo, rules, screens, fr


def _rules_html(rules):
    """業務ルールを箇条書き（・）に。1 行に収め diff を安定させる。"""
    rules = [str(x).strip() for x in rules if str(x).strip()]
    if not rules:
        return '<span class="muted">—</span>'
    return "<br>".join(f"・{esc(x)}" for x in rules)


def _screens_html(screens, screen_names):
    """画面参照を『SCR-020 予約入力画面』形式に解決。SCR id は淡色バッジ表示。"""
    screens = [str(x).strip() for x in screens if str(x).strip()]
    if not screens:
        return '<span class="muted">—</span>'
    out = []
    for s in screens:
        if s in screen_names:
            out.append(f'<span class="scr">{esc(s)}</span> {esc(screen_names[s])}')
        else:
            out.append(esc(s))   # 「全画面共通」等の自由記述はそのまま
    return "<br>".join(out)


def build_function_rows(cfg, screen_names):
    """機能一覧 tbody の <tr> 群を 1 行 = 1 機能行 で生成（diff 安定のため）。"""
    lines = []
    sho_idx = 0
    for dai in cfg["function_list"]:
        dai_rows = [r for c in dai["children"] for s in c["children"] for r in s["rows"]]
        dai_n = len(dai_rows)
        dai_fut = dai_n > 0 and all(_is_future(r) for r in dai_rows)
        dai_done = False
        for chu in dai["children"]:
            chu_rows = [r for s in chu["children"] for r in s["rows"]]
            chu_n = len(chu_rows)
            chu_fut = chu_n > 0 and all(_is_future(r) for r in chu_rows)
            chu_done = False
            for sho in chu["children"]:
                sho_cls = f"sho{sho_idx % 2}"
                sho_idx += 1
                sho_n = len(sho["rows"])
                sho_fut = sho_n > 0 and all(_is_future(r) for r in sho["rows"])
                sho_done = False
                for r in sho["rows"]:
                    fut = _is_future(r)
                    name, gaiyo, rules, screens, fr = normalize_row(r)
                    name = esc(name)
                    if fut and name:
                        name = '<span class="ftag">将来対応</span> ' + name
                    cells = []
                    if not dai_done:
                        c = "future" if dai_fut else "dai"
                        cells.append(f'<td class="{c}" rowspan="{dai_n}">{esc(dai["name"])}</td>')
                        cells.append(f'<td class="{c} c" rowspan="{dai_n}">{esc(dai.get("id", ""))}</td>')
                        dai_done = True
                    if not chu_done:
                        c = "future" if chu_fut else "chu"
                        cells.append(f'<td class="{c}" rowspan="{chu_n}">{esc(chu["name"])}</td>')
                        cells.append(f'<td class="{c} c" rowspan="{chu_n}">{esc(chu.get("id", ""))}</td>')
                        chu_done = True
                    if not sho_done:
                        c = "future" if sho_fut else sho_cls
                        cells.append(f'<td class="{c}" rowspan="{sho_n}">{esc(sho["name"])}</td>')
                        cells.append(f'<td class="{c} c" rowspan="{sho_n}">{esc(sho.get("id", ""))}</td>')
                        sho_done = True
                    f = ' future' if fut else ''
                    cells.append(f'<td class="g{f}">{name}</td>')                          # 機能名
                    cells.append(f'<td class="g{f}">{esc(gaiyo)}</td>')                     # 概要
                    cells.append(f'<td class="g rule{f}">{_rules_html(rules)}</td>')        # 業務ルール
                    cells.append(f'<td class="g scrcol{f}">{_screens_html(screens, screen_names)}</td>')  # 画面
                    cells.append(f'<td class="g frcol c{f}">{esc(fr)}</td>')                # 要求ID
                    lines.append("      <tr>" + "".join(cells) + "</tr>")
    return lines


def _table(title, headers, rows, center_cols=(), col_widths=None, anchor="", row_future=None):
    """補助セクション用の素直な表。1 行 = HTML 1 行。row_future(i)->bool で淡色化。"""
    out = []
    a = f' id="{anchor}"' if anchor else ""
    out.append(f'    <h2{a}>{esc(title)}</h2>')
    cg = _colgroup(col_widths)
    out.append(f'    <table class="aux">{cg}')
    out.append("      <thead><tr>" + "".join(f'<th>{esc(h)}</th>' for h in headers) + "</tr></thead>")
    out.append("      <tbody>")
    for i, row in enumerate(rows):
        f = ' future' if (row_future and row_future(i)) else ''
        tds = []
        for j, v in enumerate(row):
            cls = "c" if j in center_cols else ""
            cls = (cls + f).strip()
            attr = f' class="{cls}"' if cls else ""
            tds.append(f'<td{attr}>{esc(v)}</td>')
        out.append("      <tr>" + "".join(tds) + "</tr>")
    out.append("      </tbody>")
    out.append("    </table>")
    return out


CSS = """
:root{ --grid:%(grid)s; --hdr:%(hdr)s; --dai:%(dai)s; --chu:%(chu)s;
       --sho0:%(sho0)s; --sho1:%(sho1)s; --future:%(future)s; }
*{ box-sizing:border-box; }
body{ font-family:"游ゴシック","Yu Gothic",YuGothic,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif;
      font-size:13px; color:#222; margin:0; padding:24px; background:#fff; line-height:1.5; }
.titlebar{ display:flex; align-items:flex-end; justify-content:space-between;
           gap:24px; margin:4px 0 16px; flex-wrap:wrap; }
.title{ font-size:26px; font-weight:700; margin:0; letter-spacing:.04em; }
table.meta{ border-collapse:collapse; font-size:12px; }
table.meta td{ border:1px solid var(--grid); padding:3px 10px; white-space:nowrap; }
table.meta td.k{ background:var(--hdr); text-align:center; }
h2{ font-size:16px; margin:6px 0 8px; padding-left:8px; border-left:6px solid var(--dai); }
table{ border-collapse:collapse; width:100%%; table-layout:fixed; }
col.w025{ width:2.5%%; } col.w055{ width:5.5%%; } col.w060{ width:6%%; }
col.w065{ width:6.5%%; } col.w090{ width:9%%; } col.w100{ width:10%%; }
col.w130{ width:13%%; } col.w160{ width:16%%; } col.w180{ width:18%%; }
col.w220{ width:22%%; } col.w240{ width:24%%; } col.w260{ width:26%%; }
col.w295{ width:29.5%%; } col.w440{ width:44%%; } col.w720{ width:72%%; }
col.w780{ width:78%%; }
th,td{ border:1px solid var(--grid); padding:5px 7px; vertical-align:top;
       word-break:break-word; overflow-wrap:anywhere; }
thead th{ background:var(--hdr); text-align:center; vertical-align:middle;
          position:sticky; top:46px; z-index:2; }  /* タブバー(上部固定)の下に貼り付く */
td.c{ text-align:center; }
td.dai,td.chu,td.sho0,td.sho1{ vertical-align:middle; font-weight:600; }
td.dai{ background:var(--dai); }
td.chu{ background:var(--chu); }
td.sho0{ background:var(--sho0); }
td.sho1{ background:var(--sho1); }
td.g{ background:#fff; }
td.rule{ font-size:12.5px; }
td.frcol{ font-size:12px; color:#555; white-space:nowrap; }
.scr{ font-size:11px; color:#1f6f86; font-weight:700;
      background:#eaf4f8; border:1px solid #c7e2ea; border-radius:3px; padding:0 3px; }
.muted{ color:#aaa; }
/* 将来対応（将来バージョンで提供予定）: 淡色＋「将来対応」バッジで控えめに示す（取消線は使わない） */
td.future{ background:var(--future); color:#888; }
td.dai.future,td.chu.future,td.sho0.future,td.sho1.future{ font-weight:600; }
.ftag{ font-size:10.5px; color:#8a5a00; background:#fdeccb; border:1px solid #f0d39a;
       border-radius:3px; padding:0 4px; margin-right:4px; white-space:nowrap; }
.legend{ font-size:11px; color:#888; margin:6px 0 0; }
/* シート切替（上部に固定。見つけやすく、長い表でもスクロール追従で確認しやすい） */
.panel{ display:none; }
.panel.active{ display:block; }
.tabbar{ position:sticky; top:0; z-index:6; display:flex; gap:4px; align-items:flex-end;
         background:#fff; border-bottom:2px solid var(--dai); padding:6px 0 0; margin:0 0 12px;
         overflow-x:auto; min-height:40px; }
.tabbar button{ font:inherit; font-size:13px; border:1px solid #d4dde4; border-bottom:none;
                background:#eef2f5; color:#456; padding:7px 18px; border-radius:6px 6px 0 0;
                cursor:pointer; white-space:nowrap; }
.tabbar button:hover{ background:#e3eaef; }
.tabbar button.active{ background:var(--dai); color:#fff; font-weight:700; border-color:var(--dai); }
@media print{
  body{ padding:0; font-size:10px; }
  thead th{ position:static; }
  tr{ break-inside:avoid; }
  thead{ display:table-header-group; }  /* 各ページにヘッダを繰り返す */
  .tabbar{ display:none; }
  .panel{ display:block !important; }   /* 印刷は全シートを通しで出す */
  .panel + .panel{ page-break-before:always; }
}
""".strip()

TAB_SCRIPT = """
<script>
(function(){
  var tabs=[].slice.call(document.querySelectorAll('.tabbar button'));
  var panels=[].slice.call(document.querySelectorAll('.panel'));
  function show(id){
    panels.forEach(function(p){ p.classList.toggle('active', p.id===id); });
    tabs.forEach(function(t){ t.classList.toggle('active', t.dataset.target===id); });
    window.scrollTo(0,0);
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ show(t.dataset.target); }); });
})();
</script>
""".strip()


def render(cfg):
    validate_config(cfg)
    title = cfg.get("title", "機能一覧")
    meta = cfg.get("meta", {})
    screens = cfg.get("screens", []) or []
    screen_names = {s["id"]: s.get("name", "") for s in screens if s.get("id")}
    css = CSS % {"grid": GRID, "hdr": HEADER_BG, "dai": DAI_BG, "chu": CHU_BG,
                 "sho0": SHO_BG[0], "sho1": SHO_BG[1], "future": FUTURE_BG}

    # ── 各シート（パネル）の中身を組み立てる。tab=(key, ラベル, [行...])
    sheets = []

    # 機能一覧
    fl = []
    fl.append('    <h2 id="func">機能一覧</h2>')
    fl.append('    <table class="funclist">')
    fl.append("    " + _colgroup(COL_WIDTHS))
    fl.append("      <thead><tr>" + "".join(f"<th>{esc(h)}</th>" for h in HEADERS) + "</tr></thead>")
    fl.append("      <tbody>")
    fl.extend(build_function_rows(cfg, screen_names))
    fl.append("      </tbody>")
    fl.append("    </table>")
    if any(_is_future(r) for d in cfg["function_list"] for c in d["children"]
           for s in c["children"] for r in s["rows"]):
        fl.append('    <p class="legend">※ 「将来対応」の行は将来バージョンで提供予定。'
                  '「画面」列の SCR-xxx は「画面一覧」タブに対応。</p>')
    sheets.append(("func", "機能一覧", fl))

    # 画面一覧（画面マスタ）
    if screens:
        rows = [[s.get("id", ""),
                 s.get("name", "") + ("（将来対応）" if _is_future(s) else ""),
                 s.get("summary", ""), s.get("roles", "")] for s in screens]
        lines = _table("画面一覧（画面マスタ）", ["画面ID", "画面名", "概要", "主な対象ロール"],
                       rows, center_cols=(0,), anchor="screens",
                       col_widths=["10%", "22%", "44%", "24%"],
                       row_future=lambda i: _is_future(screens[i]))
        sheets.append(("screens", "画面一覧", lines))

    # ユーザーストーリー
    us = cfg.get("user_stories")
    if us:
        rows = [[u.get("id", ""), u.get("story", ""), u.get("priority", ""),
                 u.get("scope", ""), u.get("summary", ""), u.get("acceptance", "")] for u in us]
        lines = _table("ユーザーストーリー・受入基準",
                       ["ID", "ストーリー", "優先度", "スコープ単位", "概要", "受入シナリオ"],
                       rows, center_cols=(0, 2), anchor="us",
                       col_widths=["6%", "26%", "6%", "16%", "22%", "24%"],
                       row_future=lambda i: _is_future(us[i]))
        sheets.append(("us", "ユーザーストーリー", lines))

    # 成功基準・前提・対象外
    crit = cfg.get("criteria")
    if crit:
        rows = [[c.get("区分", ""), c.get("項目", ""), c.get("内容", "")] for c in crit]
        lines = _table("成功基準・前提・対象外・要確認事項", ["区分", "ID／項目", "内容"],
                       rows, center_cols=(0,), anchor="crit",
                       col_widths=["10%", "18%", "72%"],
                       row_future=lambda i: _is_future(crit[i]))
        sheets.append(("crit", "成功基準ほか", lines))

    # データエンティティ
    ents = cfg.get("entities")
    if ents:
        rows = [[e.get("name", ""), e.get("desc", "")] for e in ents]
        lines = _table("主要データエンティティ", ["エンティティ", "説明"],
                       rows, anchor="ent", col_widths=["22%", "78%"],
                       row_future=lambda i: _is_future(ents[i]))
        sheets.append(("ent", "データエンティティ", lines))

    # ── HTML 組み立て
    out = []
    out.append("<!DOCTYPE html>")
    out.append('<html lang="ja">')
    out.append("<head>")
    out.append('<meta charset="utf-8">')
    out.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    out.append(f"<title>{esc(title)}</title>")
    out.append("<style>")
    out.append(css)
    out.append("</style>")
    out.append("</head>")
    out.append("<body>")

    out.append('  <div class="titlebar">')
    out.append(f'    <h1 class="title">{esc(title)}</h1>')
    meta_rows = []
    for k in ("作成日", "作成者", "更新日", "更新者"):
        v = _fmt_date(meta.get(k, "")) if k in ("作成日", "更新日") else meta.get(k, "")
        meta_rows.append(f'<tr><td class="k">{esc(k)}</td><td>{esc(v)}</td></tr>')
    out.append('    <table class="meta">' + "".join(meta_rows) + "</table>")
    out.append("  </div>")

    out.append('  <nav class="tabbar">')
    for i, (key, label, _lines) in enumerate(sheets):
        active = " active" if i == 0 else ""
        out.append(f'    <button class="{active.strip()}" data-target="panel-{key}">{esc(label)}</button>')
    out.append("  </nav>")

    for i, (key, _label, lines) in enumerate(sheets):
        active = " active" if i == 0 else ""
        out.append(f'  <section class="panel{active}" id="panel-{key}">')
        out.extend(lines)
        out.append("  </section>")

    out.append("  " + TAB_SCRIPT)
    out.append("</body>")
    out.append("</html>")
    out.append("")  # 末尾改行
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="基本設計書(機能一覧) HTML ジェネレータ")
    ap.add_argument("config", help="設計データ JSON のパス")
    ap.add_argument("-o", "--output", help="出力 .html パス（省略時は JSON の output キーの拡張子を .html に）")
    args = ap.parse_args()

    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)

    out = args.output or cfg.get("output_html")
    if not out:
        base = cfg.get("output")
        if base:
            out = base.rsplit(".", 1)[0] + ".html" if "." in base else base + ".html"
    if not out:
        sys.exit("出力パスが指定されていません（-o か JSON の output_html / output キー）")

    html_text = render(cfg)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html_text)

    nfr = sum(len(s["rows"]) for d in cfg["function_list"]
              for c in d["children"] for s in c["children"])
    nscr = len(cfg.get("screens", []) or [])
    nsheet = 1 + (1 if nscr else 0) + sum(1 for k in ("user_stories", "criteria", "entities") if cfg.get(k))
    print(f"saved {out}  (機能一覧 {nfr}行 / 画面 {nscr}件 / シート {nsheet}枚)")


if __name__ == "__main__":
    main()
