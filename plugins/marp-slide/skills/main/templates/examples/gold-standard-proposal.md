---
marp: true
theme: default
size: 16:9
paginate: true
html: true
style: |
  /* ============================================================
     presentation-starter — 既定デザインリファレンス
     - 生成時はこの style ブロックを「丸ごと」転記する（削らない）
     - 色・フォント・サイズは必ず下のトークン（CSS 変数）を使う。
       本文側で新しい色コード・inline style・未定義クラスを
       作ってはいけない（reviewer G12 が fail にする）
     ============================================================ */

  /* ==== TOKENS ==================================================
     可視色は primary / accent + ニュートラルの 3〜4 色ルール。
     good / warn は表・比較の可否表現のみに最小限使う。 */
  :root {
    --c-primary:      #1B4965;
    --c-primary-dark: #12334A;
    --c-primary-soft: #E4EEF5;
    --c-accent:       #E9A13B;
    --c-accent-deep:  #B4700E;
    --c-good:         #3E8E5A;
    --c-warn:         #C25450;
    --c-ink:          #22313A;
    --c-sub:          #5D6D78;
    --c-line:         #D9E1E7;
    --c-surface:      #F3F6F8;
    --c-bg:           #FFFFFF;
    --fs-note:  16px;
    --fs-body:  24px;
    --fs-h3:    26px;
    --fs-h2:    30px;
    --fs-title: 40px;
    --fs-hero:  54px;
    --fs-stat:  84px;
  }

  /* ==== BASE ==================================================== */
  section {
    font-family: 'Noto Sans CJK JP', 'Noto Sans JP', 'BIZ UDPGothic',
                 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif;
    font-size: var(--fs-body);
    line-height: 1.75;
    letter-spacing: 0.01em;
    color: var(--c-ink);
    background: var(--c-bg);
    padding: 56px 72px 72px;
    justify-content: flex-start;
  }
  section h1 {
    font-size: var(--fs-title);
    font-weight: 800;
    line-height: 1.35;
    color: var(--c-ink);
    margin: 0 0 30px;
  }
  section h1::after {
    content: '';
    display: block;
    width: 56px;
    height: 5px;
    margin-top: 14px;
    border-radius: 3px;
    background: var(--c-accent);
  }
  section h2 {
    font-size: var(--fs-h2);
    font-weight: 700;
    line-height: 1.4;
    color: var(--c-primary);
    margin: 0 0 16px;
  }
  section h3 {
    font-size: var(--fs-h3);
    font-weight: 700;
    line-height: 1.4;
    color: var(--c-ink);
    margin: 0 0 8px;
  }
  section p { margin: 0 0 12px; }
  section ul, section ol { margin: 0; padding-left: 1.3em; }
  section li { margin-bottom: 12px; }
  section ul li::marker { color: var(--c-primary); }
  section li li { font-size: 0.85em; color: var(--c-sub); margin: 6px 0 0; }
  section strong { color: var(--c-primary); font-weight: 700; }
  section em { font-style: normal; font-weight: 700; color: var(--c-accent-deep); }
  section a { color: var(--c-primary); }
  section blockquote {
    border-left: 5px solid var(--c-primary);
    background: var(--c-surface);
    border-radius: 0 10px 10px 0;
    margin: 12px 0;
    padding: 14px 22px;
    font-size: 0.9em;
    color: var(--c-ink);
  }
  section blockquote p { margin: 0; }
  section table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
    line-height: 1.5;
  }
  section table th, section table td { border: none; }
  section thead th {
    color: var(--c-primary);
    background: none;
    border-bottom: 3px solid var(--c-primary);
    padding: 10px 14px;
    text-align: left;
    font-weight: 700;
  }
  section tbody td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--c-line);
  }
  section tbody tr:nth-child(even) { background: var(--c-surface); }
  footer {
    color: var(--c-sub);
    font-size: 14px;
    left: 72px;
    bottom: 24px;
  }
  section::after {
    content: attr(data-marpit-pagination) ' / ' attr(data-marpit-pagination-total);
    color: var(--c-sub);
    font-size: 14px;
    font-weight: 400;
    right: 40px;
    bottom: 24px;
    padding: 0;
  }

  /* ==== COMPONENTS ==============================================
     図解・強調はすべてこの部品で組む（生 SVG や ad-hoc CSS は不可） */
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    width: 100%;
    align-items: stretch;
  }
  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 24px;
    width: 100%;
    align-items: stretch;
  }
  .card {
    background: var(--c-bg);
    border: 1px solid var(--c-line);
    border-radius: 14px;
    padding: 22px 26px;
    box-shadow: 0 2px 10px rgba(27, 73, 101, 0.06);
  }
  .card h3 { margin-top: 0; }
  .card p, .card ul { font-size: 0.9em; margin-bottom: 0; }
  .card.filled { background: var(--c-surface); border-color: transparent; box-shadow: none; }
  .card.emphasis { background: var(--c-primary); color: #fff; border-color: transparent; }
  .card.emphasis h3, .card.emphasis strong, .card.emphasis em { color: #fff; }
  .pill {
    display: inline-block;
    font-size: var(--fs-note);
    font-weight: 700;
    line-height: 1;
    color: var(--c-primary);
    background: var(--c-primary-soft);
    border-radius: 999px;
    padding: 7px 16px;
    letter-spacing: 0.05em;
  }
  .pill.accent { color: #fff; background: var(--c-accent); }
  .small { font-size: var(--fs-note); color: var(--c-sub); line-height: 1.6; }

  /* KPI を 2〜4 個横に並べる */
  .metrics-row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 24px;
    width: 100%;
    margin: 12px 0;
  }
  .metric {
    background: var(--c-surface);
    border-radius: 14px;
    padding: 24px 20px 20px;
    text-align: center;
  }
  .metric .value {
    display: block;
    font-size: 52px;
    font-weight: 800;
    line-height: 1.15;
    color: var(--c-primary);
  }
  .metric .unit { font-size: 0.45em; font-weight: 700; margin-left: 2px; }
  .metric .label { display: block; margin-top: 8px; font-size: var(--fs-note); color: var(--c-sub); }
  .metric.highlight { background: var(--c-primary); }
  .metric.highlight .value, .metric.highlight .label { color: #fff; }

  /* 1 つの数字を主役にする */
  .big-stat { text-align: center; margin: 8px auto 0; }
  .big-stat .value {
    display: block;
    font-size: var(--fs-stat);
    font-weight: 800;
    line-height: 1.1;
    color: var(--c-primary);
  }
  .big-stat .unit { font-size: 0.4em; font-weight: 700; margin-left: 4px; }
  .big-stat .label { display: block; margin-top: 12px; font-size: var(--fs-body); color: var(--c-sub); }

  /* プロセス図（3〜5 ステップ、矢印は CSS が描く） */
  .steps { display: flex; gap: 56px; width: 100%; margin: 16px 0; }
  .step {
    position: relative;
    flex: 1;
    background: var(--c-surface);
    border-radius: 14px;
    padding: 24px 24px 20px;
  }
  .step:not(:last-child)::after {
    content: '';
    position: absolute;
    top: 50%;
    right: -38px;
    transform: translateY(-50%);
    border-left: 18px solid var(--c-primary);
    border-top: 12px solid transparent;
    border-bottom: 12px solid transparent;
  }
  .step .step-no {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    background: var(--c-primary);
    color: #fff;
    font-weight: 800;
    font-size: 20px;
    margin-bottom: 12px;
  }
  .step h3 { margin: 0 0 6px; }
  .step p { margin: 0; font-size: var(--fs-note); color: var(--c-sub); line-height: 1.6; }

  /* タイムライン（3〜5 マイルストーン、現在は .is-now） */
  .timeline {
    display: flex;
    gap: 32px;
    width: 100%;
    position: relative;
    margin: 28px 0 8px;
    padding-top: 30px;
  }
  .timeline::before {
    content: '';
    position: absolute;
    top: 7px;
    left: 8px;
    right: 8px;
    height: 3px;
    border-radius: 2px;
    background: var(--c-line);
  }
  .t-item { flex: 1; position: relative; }
  .t-item::before {
    content: '';
    position: absolute;
    top: -30px;
    left: 0;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--c-bg);
    border: 4px solid var(--c-primary);
  }
  .t-item.is-now::before { background: var(--c-accent); border-color: var(--c-accent); }
  .t-item h3 { margin: 10px 0 4px; }
  .t-item p { margin: 0; font-size: var(--fs-note); color: var(--c-sub); }

  /* 構成図（3〜6 ノード + 1 本の主たる流れ） */
  .arch {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    margin: 32px 0 16px;
  }
  .node {
    border: 2.5px solid var(--c-primary);
    border-radius: 12px;
    background: var(--c-bg);
    padding: 20px 30px;
    text-align: center;
    font-weight: 700;
    line-height: 1.4;
  }
  .node span {
    display: block;
    font-size: var(--fs-note);
    font-weight: 400;
    color: var(--c-sub);
    margin-top: 4px;
  }
  .node.hub { background: var(--c-primary); color: #fff; }
  .node.hub span { color: rgba(255, 255, 255, 0.8); }
  .arrow {
    position: relative;
    width: 64px;
    height: 3px;
    background: var(--c-primary);
    margin: 0 6px;
    flex: none;
  }
  .arrow::after {
    content: '';
    position: absolute;
    right: -1px;
    top: 50%;
    transform: translateY(-50%);
    border-left: 12px solid var(--c-primary);
    border-top: 8px solid transparent;
    border-bottom: 8px solid transparent;
  }
  .arch-note { text-align: center; font-size: var(--fs-note); color: var(--c-sub); margin-top: 12px; }

  /* BEFORE / AFTER 比較 */
  .compare {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    width: 100%;
    align-items: stretch;
  }
  .compare .col {
    border: 1px solid var(--c-line);
    border-radius: 14px;
    background: var(--c-bg);
    padding: 0 0 18px;
    overflow: hidden;
  }
  .compare .col-label {
    display: block;
    text-align: center;
    font-weight: 800;
    font-size: 18px;
    letter-spacing: 0.12em;
    color: #fff;
    background: var(--c-sub);
    padding: 10px 0;
    margin-bottom: 18px;
  }
  .compare .after { border: 2px solid var(--c-primary); }
  .compare .after .col-label { background: var(--c-primary); }
  .compare .col ul { padding: 0 26px 0 46px; margin: 0; }
  .compare .col li { font-size: 0.9em; margin-bottom: 10px; }

  /* クロージングのアクションリスト（2〜4 個、担当か期限を必ず書く） */
  .cta-list { display: grid; gap: 18px; width: 100%; margin-top: 8px; }
  .cta {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    background: var(--c-surface);
    border-radius: 14px;
    padding: 20px 26px;
  }
  .cta .cta-no {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    background: var(--c-accent);
    color: #fff;
    font-weight: 800;
    font-size: 20px;
    margin-top: 2px;
  }
  .cta .cta-body { line-height: 1.6; }
  .cta .cta-body p { margin: 0; }
  .cta .cta-meta { display: inline-block; font-size: var(--fs-note); color: var(--c-sub); margin-top: 2px; }

  /* ==== ICONS（モノクロ・ピクトグラム）==========================
     形は定義済みの .i-* だけを使う（本文で新しい形を作らない）。
     色は塗り分けクラスで決める: 既定 primary / .accent / .sub / .inverse */
  .icon {
    display: inline-block;
    width: 42px;
    height: 42px;
    vertical-align: middle;
    background: var(--c-primary);
    -webkit-mask: var(--icon) center / contain no-repeat;
    mask: var(--icon) center / contain no-repeat;
  }
  .icon.sm { width: 28px; height: 28px; }
  .icon.lg { width: 64px; height: 64px; }
  .icon.accent { background: var(--c-accent); }
  .icon.sub { background: var(--c-sub); }
  .icon.inverse { background: #fff; }
  .card .icon { display: block; margin-bottom: 10px; }
  .metric .icon { display: block; margin: 0 auto 10px; }
  .evidence .icon { display: block; margin: 0 auto 12px; }
  .i-target { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14z'/%3E%3Ccircle cx='12' cy='12' r='3.5'/%3E%3C/svg%3E"); }
  .i-chart-up { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M3 13h4.5v8H3z'/%3E%3Cpath d='M9.75 8h4.5v13h-4.5z'/%3E%3Cpath d='M16.5 3h4.5v18h-4.5z'/%3E%3C/svg%3E"); }
  .i-chart-down { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M3 3h4.5v18H3z'/%3E%3Cpath d='M9.75 9h4.5v12h-4.5z'/%3E%3Cpath d='M16.5 14h4.5v7h-4.5z'/%3E%3C/svg%3E"); }
  .i-clock { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6z'/%3E%3Cpath d='M11 6.5h2v6.1l4.2 2.4-1 1.7-5.2-3z'/%3E%3C/svg%3E"); }
  .i-money { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M2 5.5h20v13H2v-13zm10 2.7a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM4.4 10.9h2v2.2h-2zm13.2 0h2v2.2h-2z'/%3E%3Ccircle cx='12' cy='12' r='1.8'/%3E%3C/svg%3E"); }
  .i-people { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='8.5' cy='7' r='3.6'/%3E%3Cpath d='M2 20a6.5 6.5 0 0 1 13 0z'/%3E%3Ccircle cx='17.5' cy='8' r='2.9'/%3E%3Cpath d='M16 20c0-2.6-.9-5-2.3-6.7a5.2 5.2 0 0 1 8.3 4.2V20z'/%3E%3C/svg%3E"); }
  .i-person { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3Cpath d='M4.5 20.5a7.5 7.5 0 0 1 15 0z'/%3E%3C/svg%3E"); }
  .i-gear { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 5.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2zm0 3.8a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z'/%3E%3Crect x='10.7' y='1' width='2.6' height='4.4'/%3E%3Crect x='10.7' y='1' width='2.6' height='4.4' transform='rotate(45 12 12)'/%3E%3Crect x='10.7' y='1' width='2.6' height='4.4' transform='rotate(90 12 12)'/%3E%3Crect x='10.7' y='1' width='2.6' height='4.4' transform='rotate(135 12 12)'/%3E%3Crect x='10.7' y='1' width='2.6' height='4.4' transform='rotate(180 12 12)'/%3E%3Crect x='10.7' y='1' width='2.6' height='4.4' transform='rotate(225 12 12)'/%3E%3Crect x='10.7' y='1' width='2.6' height='4.4' transform='rotate(270 12 12)'/%3E%3Crect x='10.7' y='1' width='2.6' height='4.4' transform='rotate(315 12 12)'/%3E%3C/svg%3E"); }
  .i-database { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cellipse cx='12' cy='4.8' rx='9' ry='2.9'/%3E%3Cpath d='M3 8.1c1.9 1.5 5.2 2.3 9 2.3s7.1-.8 9-2.3v3.2c-1.9 1.5-5.2 2.3-9 2.3s-7.1-.8-9-2.3z'/%3E%3Cpath d='M3 14.4c1.9 1.5 5.2 2.3 9 2.3s7.1-.8 9-2.3v3.5c0 1.8-4 3.2-9 3.2s-9-1.4-9-3.2z'/%3E%3C/svg%3E"); }
  .i-doc { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M5 1.5h9.6L19 5.9v16.6H5V1.5zm9.2 1.6v3.4h3.4zM8.2 11.4h7.6v1.9H8.2zm0 4h7.6v1.9H8.2z'/%3E%3C/svg%3E"); }
  .i-check { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5.6 6.1l1.5 1.5-7.6 7.6-4.6-4.6 1.5-1.5 3.1 3.1z'/%3E%3C/svg%3E"); }
  .i-alert { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 1.8L23.2 21H.8L12 1.8zm-1.2 7.2l.4 6h1.6l.4-6h-2.4zm1.2 7.6a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1z'/%3E%3C/svg%3E"); }
  .i-idea { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 1.8a7.2 7.2 0 0 0-4.1 13.1c.7.5 1.1 1.3 1.1 2.1v.5h6v-.5c0-.8.4-1.6 1.1-2.1A7.2 7.2 0 0 0 12 1.8z'/%3E%3Cpath d='M9 19h6v1.8H9z'/%3E%3Cpath d='M10 22h4v1.4h-4z'/%3E%3C/svg%3E"); }
  .i-search { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M10.5 2a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z'/%3E%3Cpath d='M15.3 17.2l1.9-1.9 5.3 5.3-1.9 1.9z'/%3E%3C/svg%3E"); }
  .i-shield { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 1.5l8.7 3.2v6.3c0 5.2-3.5 9.3-8.7 11.5C6.8 20.3 3.3 16.2 3.3 11V4.7L12 1.5zm4.1 7l-1.4-1.4-3.8 4.1-1.5-1.4-1.4 1.5 2.9 2.8 5.2-5.6z'/%3E%3C/svg%3E"); }
  .i-rocket { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M12 1.3c-3.1 2.3-4.7 5.6-4.7 9.6 0 1.7.3 3.3.9 4.9h7.6c.6-1.6.9-3.2.9-4.9 0-4-1.6-7.3-4.7-9.6zM12 6.8a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z'/%3E%3Cpath d='M7.4 12.8L4.2 18.6l4.1-1.5z'/%3E%3Cpath d='M16.6 12.8l3.2 5.8-4.1-1.5z'/%3E%3Cpath d='M9.8 17.6h4.4L12 22.3z'/%3E%3C/svg%3E"); }
  .i-building { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M4 22V2.5h12V22h-4.2v-4.2H8.2V22H4zM6.8 5.5v2.6h2.6V5.5H6.8zm4.8 0v2.6h2.6V5.5h-2.6zM6.8 10v2.6h2.6V10H6.8zm4.8 0v2.6h2.6V10h-2.6z'/%3E%3Cpath d='M17.5 8.5H21V22h-3.5z'/%3E%3C/svg%3E"); }
  .i-calendar { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M2.8 4.5h18.4V22H2.8V4.5zm2.6 5.2v9.7h13.2V9.7H5.4z'/%3E%3Crect x='6.4' y='1.4' width='2.6' height='4.6' rx='1.2'/%3E%3Crect x='15' y='1.4' width='2.6' height='4.6' rx='1.2'/%3E%3Crect x='7.6' y='12' width='2.9' height='2.9'/%3E%3Crect x='13.5' y='12' width='2.9' height='2.9'/%3E%3C/svg%3E"); }
  .i-cycle { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cg fill='none' stroke='black' stroke-width='2.6'%3E%3Cpath d='M4.76 10.06A7.5 7.5 0 0 1 19.24 10.06'/%3E%3Cpath d='M19.24 13.94A7.5 7.5 0 0 1 4.76 13.94'/%3E%3C/g%3E%3Cpath d='M21.9 9.4L16.6 10.8 20.4 14.2z'/%3E%3Cpath d='M2.1 14.6L7.4 13.2 3.6 9.8z'/%3E%3C/svg%3E"); }
  .i-chat { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill-rule='evenodd' d='M2 3h20v13.5H10.5L5 21v-4.5H2V3zm5.4 5.1a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zm4.6 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zm4.6 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z'/%3E%3C/svg%3E"); }

  /* ==== ARCHETYPES ============================================== */
  /* title-hero: 表紙 */
  section.title-hero {
    background: linear-gradient(135deg, var(--c-primary) 0%, var(--c-primary-dark) 100%);
    color: #fff;
    justify-content: center;
    padding: 96px;
  }
  section.title-hero h1 {
    color: #fff;
    font-size: var(--fs-hero);
    line-height: 1.3;
    margin-bottom: 8px;
  }
  section.title-hero h1::after { width: 72px; }
  section.title-hero h2 {
    color: rgba(255, 255, 255, 0.85);
    font-weight: 500;
    margin-top: 20px;
  }
  section.title-hero .meta {
    position: absolute;
    left: 96px;
    bottom: 64px;
    font-size: var(--fs-note);
    color: rgba(255, 255, 255, 0.7);
    letter-spacing: 0.04em;
  }
  section.title-hero footer { display: none; }
  section.title-hero::after { display: none; }

  /* agenda-overview: 目次（聞き手の助けになる場合のみ使う） */
  section.agenda-overview ol {
    list-style: none;
    counter-reset: agenda;
    padding: 0;
    margin: 12px 0 0;
    width: 100%;
  }
  section.agenda-overview ol > li {
    counter-increment: agenda;
    display: flex;
    align-items: baseline;
    gap: 22px;
    padding: 18px 8px;
    margin: 0;
    border-bottom: 1px solid var(--c-line);
    font-size: var(--fs-h3);
    font-weight: 500;
  }
  section.agenda-overview ol > li::before {
    content: counter(agenda, decimal-leading-zero);
    font-size: var(--fs-h2);
    font-weight: 800;
    color: var(--c-primary);
    line-height: 1;
  }

  /* section-divider: 章区切り（見出しは章ラベルでよい） */
  section.section-divider {
    background: var(--c-surface);
    justify-content: center;
    padding: 96px;
  }
  section.section-divider .chapter {
    font-size: 110px;
    font-weight: 800;
    line-height: 1;
    color: var(--c-primary);
    opacity: 0.18;
    letter-spacing: 0.02em;
    margin-bottom: 4px;
  }
  section.section-divider h1 { font-size: var(--fs-hero); margin-bottom: 4px; }
  section.section-divider h1::after { width: 72px; }
  section.section-divider h2 { color: var(--c-sub); font-weight: 500; margin-top: 14px; }

  /* title-content: 標準スライド（基本レイアウトのまま） */
  section.title-content { }

  /* assertion-evidence: 左に根拠 bullet、右に視覚要素 1 つ */
  section.assertion-evidence .grid-2 {
    grid-template-columns: 1.05fr 0.95fr;
    align-items: center;
  }
  section.assertion-evidence .evidence {
    background: var(--c-surface);
    border-radius: 14px;
    padding: 36px 24px;
    text-align: center;
  }

  /* two-column-compare: .compare 部品を使う */
  section.two-column-compare { }

  /* two-column-content: .grid-2 + .card を使う */
  section.two-column-content { }

  /* process-flow: .steps 部品を使う */
  section.process-flow .steps { margin-top: 28px; }

  /* timeline-roadmap: .timeline 部品を使う */
  section.timeline-roadmap { }

  /* big-number: 数字 1 つを主役に */
  section.big-number { justify-content: center; text-align: center; }
  section.big-number h1 { margin-bottom: 44px; }
  section.big-number h1::after { margin-left: auto; margin-right: auto; }
  section.big-number .stat-insight {
    margin-top: 40px;
    font-size: var(--fs-h3);
    color: var(--c-ink);
  }

  /* architecture-diagram: .arch 部品を使う */
  section.architecture-diagram { }

  /* quote-callout: 引用 + 解釈 */
  section.quote-callout { justify-content: center; }
  section.quote-callout blockquote {
    border: none;
    background: none;
    border-radius: 0;
    margin: 10px 0 0;
    padding: 0 64px;
    font-size: var(--fs-h2);
    line-height: 1.7;
    font-weight: 500;
    position: relative;
  }
  section.quote-callout blockquote::before {
    content: '\201C';
    position: absolute;
    left: 0;
    top: -18px;
    font-size: 96px;
    line-height: 1;
    color: var(--c-primary-soft);
  }
  section.quote-callout .quote-attr {
    text-align: right;
    padding: 0 64px;
    color: var(--c-sub);
    font-size: var(--fs-note);
    margin-top: 16px;
  }
  section.quote-callout .quote-insight {
    margin-top: 32px;
    padding: 0 64px;
    font-weight: 700;
    color: var(--c-primary);
  }

  /* closing-next-action: 最終スライド */
  section.closing-next-action { }
---

<!--
gold-standard 完成例: 提案デッキ（架空題材）。
S2b でドラフトを書く前にこのデッキを読み、タイトルの書き方・
archetype の使い分け・密度感をこの水準に合わせること。
style ブロックは presentation-starter.md と同一。
-->

<!-- _class: title-hero -->
<!-- _paginate: false -->

# 在庫コストを2年で半減する

## 発注自動化システム導入のご提案

<div class="meta">2026年7月10日｜経営会議</div>

---

<!-- _class: title-content -->

# 結論: 300万円のPoCで「半減シナリオ」を検証させてほしい

<div class="grid-3">
<div class="card filled">
<span class="icon i-alert"></span>

### 課題

滞留在庫コストが**年4,200万円**に到達

</div>
<div class="card filled">
<span class="icon i-idea"></span>

### 提案

発注業務を自動化し滞留の発生源を断つ

</div>
<div class="card emphasis">
<span class="icon inverse i-check"></span>

### 本日のお願い

PoC予算**300万円**の承認

</div>
</div>

---

<!-- _class: big-number -->

# 滞留在庫のコストは年間4,200万円に達している

<div class="big-stat">
<span class="value">4,200<span class="unit">万円/年</span></span>
<span class="label">滞留在庫の維持コスト（2025年度実績・経理部集計）</span>
</div>

<p class="stat-insight">売上原価の <strong>8.6%</strong> に相当し、業界中央値の約2倍</p>

---

<!-- _class: assertion-evidence -->

# 原因は需要予測の精度ではなく、発注の属人化にある

<div class="grid-2">
<div>

- 発注判断の基準が担当者ごとに異なり、標準がない
- 転記・確認の手作業が週12時間発生し、ミスが月3件
- 予測モデル導入済みの部門でも滞留は減っていない

</div>
<div class="evidence">
<div class="big-stat">
<span class="value">68<span class="unit">%</span></span>
<span class="label">発注業務のうち手作業が占める割合（業務調査 2026年6月）</span>
</div>
</div>
</div>

---

<!-- _class: section-divider -->

<div class="chapter">02</div>

# 提案

## 発注プロセスそのものを自動化する

---

<!-- _class: architecture-diagram -->

# 既存の基幹システムに追加開発なしで接続できる

<div class="arch">
<div class="node">基幹システム<span>受発注データ</span></div>
<div class="arrow"></div>
<div class="node hub">自動発注エンジン<span>需要予測・自動起案</span></div>
<div class="arrow"></div>
<div class="node">承認ワークフロー<span>例外のみ人が判断</span></div>
</div>

<p class="arch-note">データ連携は既存の日次CSV出力を流用するため、基幹側の改修はゼロ</p>

---

<!-- _class: two-column-compare -->

# 移行後は発注工数が週12時間から2時間に減る

<div class="compare">
<div class="col before">
<span class="col-label">BEFORE（現行）</span>

- 担当者の経験で発注量を判断
- 転記・突合の手作業が週12時間
- ミス発見は月次棚卸しまで遅延

</div>
<div class="col after">
<span class="col-label">AFTER（自動化後）</span>

- 需要予測から自動で起案
- 人の作業は例外承認の週2時間
- 異常は当日中にアラート検知

</div>
</div>

---

<!-- _class: title-content -->

# 投資は初年度内に回収できる見込み

<div class="metrics-row">
<div class="metric">
<span class="icon sm i-chart-down"></span>
<span class="value">2,100<span class="unit">万円/年</span></span>
<span class="label">在庫コスト削減額 <em>（要確認）</em></span>
</div>
<div class="metric">
<span class="icon sm i-money"></span>
<span class="value">2,100<span class="unit">万円</span></span>
<span class="label">総投資額（PoC 300 + 本導入 1,800）</span>
</div>
<div class="metric highlight">
<span class="icon sm inverse i-clock"></span>
<span class="value">12<span class="unit">か月</span></span>
<span class="label">投資回収期間（試算）</span>
</div>
</div>

<p class="small">削減額は滞留半減を仮説とした試算値（仮説・要確認）。PoC で実測し精緻化する。</p>

---

<!-- _class: timeline-roadmap -->

# 2026年度内に全社展開まで到達できる

<div class="timeline">
<div class="t-item is-now">
<span class="pill accent">Phase 1</span>

### PoC

<p>7〜9月｜物流部門で実測</p>
</div>
<div class="t-item">
<span class="pill">Phase 2</span>

### 本番導入

<p>10〜12月｜主要3部門</p>
</div>
<div class="t-item">
<span class="pill">Phase 3</span>

### 全社展開

<p>1〜3月｜全部門+定着化</p>
</div>
</div>

---

<!-- _class: closing-next-action -->

# 本日ご判断いただきたいこと

<div class="cta-list">
<div class="cta">
<span class="cta-no">1</span>
<div class="cta-body">

**PoC 予算 300万円の承認**
<span class="cta-meta">本日この場で｜承認者: 経営会議</span>

</div>
</div>
<div class="cta">
<span class="cta-no">2</span>
<div class="cta-body">

**PoC 対象として物流部門を確定**
<span class="cta-meta">7月17日まで｜担当: 業務改革室</span>

</div>
</div>
<div class="cta">
<span class="cta-no">3</span>
<div class="cta-body">

**9月末の経営会議で実測結果を報告**
<span class="cta-meta">報告者: 情報システム部</span>

</div>
</div>
</div>
