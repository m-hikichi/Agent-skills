"""Case-specific editorial reconstruction; not a general Spec Kit parser.

Reads the external project only. Retains the initial extraction for comparison.
No application tests are run and no execution results are imported.
"""
import copy
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FEATURE = Path('C:/Users/m_hikichi/Documents/desktop-pet/specs/002-idle-run-pet-resize')
STEM = 'desktop-pet-002'
sys.path.insert(0, str(ROOT / 'skills/speckit-requirements-functions-tests/scripts'))
from document_model import evaluate_model
from render_documents import write_rendered
from schema_validation import require_valid_model


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8', newline='\n')


def build():
    model = json.loads((HERE / 'automatic' / f'{STEM}_requirements-functions-tests.json').read_text(encoding='utf-8'))
    lines = (FEATURE / 'spec.md').read_text(encoding='utf-8-sig').splitlines()
    reqs = {r['id']: r for r in model['requirements']}
    registry = {r['id']: r for r in model['identity_registry']}

    def register(id_, kind):
        if id_ not in registry:
            entry = dict(id=id_, kind=kind, source_key='desktop-pet-editorial:' + id_, lifecycle='active', aliases=[])
            registry[id_] = entry
            model['identity_registry'].append(entry)

    # The automatic parser discarded continuation lines and 17 numbered items.
    scenarios = []
    story = 0
    next_ac = 4
    for index, line in enumerate(lines):
        heading = re.match(r'### User Story (\d+)', line)
        if heading:
            story = int(heading[1])
        if not re.match(r'\d+\. \*\*Given\*\*', line):
            continue
        fragments = [re.sub(r'^\d+\.\s*', '', line)]
        end = index + 1
        while end < len(lines) and lines[end].startswith('   '):
            fragments.append(lines[end].strip())
            end += 1
        statement = ' '.join(fragments).replace('**', '')
        match = re.fullmatch(r'Given\s+(.+?),\s*When\s+(.+?),\s*Then\s+(.+)', statement)
        assert match, statement
        ordinal = sum(s['story'] == story for s in scenarios) + 1
        id_ = f'AC-{story:03}' if ordinal == 1 else f'AC-{next_ac:03}'
        if ordinal != 1:
            next_ac += 1
        req = dict(id=id_, kind='acceptance-scenario', statement=statement, status='current', priority=f'P{story}', parent_id=f'US-{story:03}', basis='specified', source_refs=[f'spec.md#L{index + 1}'])
        if id_ in reqs:
            reqs[id_].update(req)
        else:
            model['requirements'].append(req)
            reqs[id_] = req
        register(id_, 'requirement')
        scenarios.append(dict(id=id_, story=story, ordinal=ordinal, given=match[1], when=match[2], then=match[3]))
    assert [sum(s['story'] == n for s in scenarios) for n in (1, 2, 3)] == [4, 7, 9]
    for n in range(1, 14):
        reqs[f'REQ-{n:03}']['parent_id'] = 'FR-025' if n <= 6 else 'FR-022' if n <= 9 else 'FR-024'

    groups = {
        1: ('常時待機・自律挙動の停止', [1, 2, 3, 4], '起動・ドロップ後に操作しない', '待機アニメーションを続け、勝手に移動・動作しない'),
        2: ('ドラッグの走行方向・停止・中断', [5, 6, 7, 8, 9, 10, 11, 25], '本体をつかんで移動・停止・解放する', '符号つき変位と時間に応じて走行方向・待機状態を切り替える'),
        3: ('サイズメニュー・即時反映', [12, 13, 14, 17], '常駐メニューで4段階のサイズを選ぶ', '選択印と表示サイズを更新し、再生中のアニメーションを維持する'),
        4: ('サイズの保存復元・旧設定・ペット切替', [16, 18, 21], 'サイズ保存・起動・ペット切替', 'アプリ共通のサイズを引き継ぎ、旧形式の設定を読み込む'),
        5: ('足元位置・作業領域・DPI座標変換', [15, 22, 24], 'サイズ変更・位置復元・モニタ間移動', '座標変換を集約し、足元位置と必要時のみのはみ出し補正を管理する'),
        6: ('全サイズの描画・クリック判定', [19, 20], '各サイズで表示・クリック・ドラッグする', '輪郭・透過・操作性・フォーカス非奪取を維持する'),
    }
    mapping = {}
    for number, (_, ids, _, _) in groups.items():
        for n in ids:
            mapping[f'FR-{n:03}'] = [number]
    mapping['FR-023'] = [2, 3, 4, 5]
    mapping['FR-019'] = [2, 3, 6]
    for n in range(1, 14):
        mapping[f'REQ-{n:03}'] = mapping[reqs[f'REQ-{n:03}']['parent_id']]
    mapping.update({'US-001': [1], 'US-002': [2], 'US-003': [3, 4, 5, 6]})
    for n, ids in enumerate([[2], [2], [2, 5], [3, 5], [4], [4], [5], [6]], 1):
        mapping[f'EC-{n:03}'] = ids
    for n, ids in enumerate([[1], [2], [2], [3], [4], [2, 6], [6], [3], [4, 6], [5], [3], [5]], 1):
        mapping[f'SC-{n:03}'] = ids
    ac_fns = {1: [[1]] * 4, 2: [[2]] * 7, 3: [[3], [3, 5], [4], [6], [2, 6], [3], [4], [3], [2, 5]]}
    for s in scenarios:
        mapping[s['id']] = ac_fns[s['story']][s['ordinal'] - 1]

    model['functions'] = []
    for n, (name, _, trigger, summary) in groups.items():
        related = [r for r, f in mapping.items() if n in f]
        fn = dict(id=f'FNC-{n:03}', name=name, summary=summary, status='current', priority='P1' if n == 1 else 'P2' if n == 2 else 'P3', actors=['PCで作業する利用者'], trigger=trigger,
                  inputs=[trigger], outputs=[summary], preconditions=['対象ペットを利用できる検証環境'], postconditions=[summary],
                  business_rules=[reqs[r]['statement'] for r in related if r.startswith('FR-')],
                  exceptions=[reqs[r]['statement'] for r in related if r.startswith('EC-')], basis='derived',
                  rationale='独立レビューの責務別6分類を反映。最終正本の再レビューは未完了のため機能境界は候補として残す。',
                  source_refs=sorted({ref for r in related for ref in reqs[r]['source_refs']}))
        model['functions'].append(fn)
        register(fn['id'], 'function')

    old_tests = model['test_cases']
    old_links = model['links']
    model['links'] = []
    model['test_cases'] = []
    seen = set()

    def link(kind, from_, to):
        key = kind, from_, to
        if key not in seen:
            seen.add(key)
            model['links'].append(dict(type=kind, from_id=from_, to_id=to))

    for req, functions in mapping.items():
        for fn in functions:
            link('requirement-to-function', req, f'FNC-{fn:03}')

    def add_test(test, requirements):
        requirements = list(dict.fromkeys(requirements))
        assert all(r in reqs and r in mapping for r in requirements), requirements
        model['test_cases'].append(test)
        register(test['id'], 'test-case')
        for r in requirements:
            link('requirement-to-test', r, test['id'])
        for fn in sorted({n for r in requirements for n in mapping[r]}):
            link('function-to-test', f'FNC-{fn:03}', test['id'])

    ac_reqs = {
        1: [['FR-001','FR-002','SC-001'], ['FR-003'], ['FR-004'], ['FR-001','FR-002']],
        2: [['FR-005','FR-011'], ['FR-006','FR-011'], ['FR-007'], ['FR-010'], ['FR-009'], ['FR-008'], ['FR-008']],
        3: [['FR-014'], ['FR-015'], ['FR-016','SC-005'], ['FR-019'], ['FR-019'], ['FR-012','FR-017'], ['FR-018'], ['FR-014','SC-011'], ['FR-022','SC-012','EC-007']],
    }
    for s in scenarios:
        n = 65 + len(model['test_cases'])
        when = s['when']
        data = ['対象ペット: genba-neko。表示倍率・アプリ版・開始位置を試験記録に残す。既存QA結果の転記ではなく新規実施する。']
        if s['story'] == 1:
            data += ['放置観察はUS-001の独立テストに合わせ30分間。位置とアニメーション行・コマ進行を連続記録する。']
        if s['story'] == 2:
            data += ['走り出しは各軸2 DIP、確定後の反転は逆方向4 DIP。向きの開始状態は事前条件に従う。静止は300 ms。']
        if s['story'] == 3:
            data += ['選択肢:75/100/125/150%。標準以外は75/125/150%をそれぞれ実施。']
        test = dict(id=f'TST-{n:03}', title=f'受入条件 US{s["story"]}-{s["ordinal"]}: {when}', type='positive', level='logical-acceptance', status='planned', priority=f'P{s["story"]}',
                    preconditions=[s['given']], steps=[when, '表示・位置・状態を記録し、期待結果と比較する。'], test_data=data,
                    expected_result=s['then'], automation_status='unspecified', basis='derived', rationale='改行を含む受入条件を原文から復元。数値境界は別の詳細試験でも確認する。', source_refs=reqs[s['id']]['source_refs'])
        add_test(test, [s['id'], f'US-{s["story"]:03}'] + ac_reqs[s['story']][s['ordinal']-1])

    child_links = {
        'motion-start-signed-axis': ['REQ-001','REQ-002'],
        'motion-diagonal-net-displacement': ['REQ-001','REQ-004','EC-001'],
        'motion-vertical-to-horizontal': ['REQ-003'],
        'motion-flip-and-reset': ['REQ-005','EC-001'],
        'motion-stillness-zero-events': ['REQ-006'],
        'capture-loss-real-session': ['EC-002'],
        'coordinate-roundtrip-negative-dpi': ['REQ-007','REQ-008'],
        'coordinate-scale-roundtrip-100': ['REQ-011'],
        'coordinate-cross-monitor-runtime': ['REQ-010','REQ-012','EC-007'],
        'hit-test-all-scales': ['REQ-009'],
        'settings-scale-validation': ['EC-005','EC-006'],
        'resources-all-four-scales': ['EC-008'],
        'coordinate-conversion-boundary-review': ['REQ-010','REQ-011','REQ-012','REQ-013'],
    }
    for source in json.loads((HERE / 'design-tests.json').read_text(encoding='utf-8')):
        test = copy.deepcopy(source)
        key = test.pop('key')
        requirements = test.pop('requirement_ids') + child_links.get(key, [])
        if key == 'settings-invalid-type-file':
            # Two normative interpretations conflict: do not choose one silently.
            test['title'] = '判定保留: サイズ設定が文字列のときの旧設定の扱い'
            test['expected_result'] = '未設定（要確認）: Q-REAL-002の解決待ち。契約はファイル全体の初期化、FR-021は旧設定保持を要求している。起動継続・100%表示と、位置・ペットの扱いを分けて記録する。'
            test['rationale'] = '独立レビューで原文間の矛盾を検出したため、契約だけを正として合格判定しない。'
            requirements += ['FR-021']
        test.update(id=f'TST-{65 + len(model["test_cases"]):03}', status='planned', priority='unspecified', automation_status='unspecified', basis='derived')
        add_test(test, requirements)

    supplementary = [
        ('サイズ変更で内側は足元不変、はみ出した時だけ補正', ['EC-004','FR-015','SC-010'],
         ['作業領域の境界を取得できるWindows検証環境。OS表示倍率変更の試験とは分ける。'],
         ['全サイズが収まる足元位置で各サイズへ切り替え、変更前後の足元座標を記録する。', '画面端で小サイズは収まり大サイズははみ出す位置を作り、大サイズへ変更して矩形と作業領域を比較する。'],
         ['75/100/125/150%、画面内と画面端。矩形・作業領域・足元を同じ物理ピクセル座標で記録する。'],
         '内側では内部足元位置を変えず、表示上のずれは1ピクセル相当以内。はみ出す場合のみ補正し、全試行で作業領域内に収まる。', ['spec.md#L274','spec.md#L371']),
        ('標準サイズの表示寸法', ['FR-013'],
         ['192×208のコマ画像を持つペットを表示し、モニタ倍率を取得できる。'],
         ['Medium 100%を選び、論理寸法と物理ピクセル寸法を取得する。', '各倍率で原寸コマに対する表示寸法を比較する。'],
         ['原寸192×208、モニタ倍率1.0/1.25/1.5/2.0。期待物理寸法はそれぞれ192×208、240×260、288×312、384×416。'],
         '論理寸法は192×208 DIP。物理寸法は原寸にモニタ倍率を掛けた値で、サイズ選択100%による追加拡縮はない。', ['spec.md#L269','data-model.md#L236']),
        ('全サイズの輪郭とフォーカス非奪取', ['FR-020','FR-019'],
         ['背後の検証用入力欄へフォーカスを置き、ペットの原寸画像と表示を比較できる。'],
         ['各サイズで静止画と連続アニメーションを観察し、輪郭のにじみ・つぶれ・欠けを記録する。', '背後へ文字を入力しながらペットを表示し、入力先が移らないことを確認する。'],
         ['75/100/125/150%、genba-neko。実際のモニタ倍率と各サイズの画像を記録する。'],
         '全サイズで輪郭のにじみ・つぶれ・欠けがなく同じ絵柄と判別でき、ペット表示により背後の入力フォーカスを奪わない。視覚判定者と観察画像を保存する。', ['spec.md#L286','spec.md#L289']),
        ('解放と静止から待機に戻る時間', ['SC-003','FR-009','FR-010'],
         ['単体ロジックではなく実画面で左右の走りを開始でき、操作と表示の時刻を記録できる。'],
         ['左右それぞれのドラッグからボタンを離し、待機表示までの時間を計測する。', '左右それぞれのドラッグでつかんだままカーソルを止め、最後の移動から待機表示までを計測する。'],
         ['走り出しを確認した右/左の各条件、解放/保持静止の組合せ。各試行の時刻を記録。'],
         '解放した全試行で0.5秒以内に待機し走りのまま固まらない。保持静止の全試行で停止後0.3秒±0.1秒で待機する。', ['spec.md#L358']),
        ('サイズ変更の操作数・操作時間・反映時間', ['SC-004','FR-012','FR-014'],
         ['常駐メニューからサイズ変更でき、メニュー操作と表示の時刻を記録できる。'],
         ['メニューを開いた時刻から別サイズの選択までの操作数と所要時間を記録する。', '選択確定から表示寸法が変わるまでの時間を計測する。'],
         ['変更先75/100/125/150%。同じ値の再選択は変更時間の測定対象から分ける。'],
         'メニューを開いてから10秒以内・3操作以内に変更でき、選択後1秒以内に表示へ反映する。', ['spec.md#L361']),
        ('初めて使う人がサイズ変更方法を発見できる', ['SC-008'],
         ['対象アプリのサイズ変更方法を知らない参加者。説明書・操作誘導を渡さない。'],
         ['サイズを変更したいという目的だけを伝え、探索開始時刻を記録する。', 'サイズ変更方法を見つけた時刻・操作経路を記録し、1分と比較する。'],
         ['参加者・試行数は要確認。SC-008には母集団・人数の指定がないため、個別試行と全体の受入判断を分ける。'],
         '個別試行では説明書なしで1分以内に変更方法を見つけられる。母集団全体の合否はQ-REAL-007で試験人数等を確定するまで判定しない。', ['spec.md#L368']),
        ('既存ペットパッケージを加工せず表示できる', ['SC-009'],
         ['既存パッケージの対象一覧と試験前ハッシュを記録する。1パッケージだけで全件互換としない。'],
         ['対象一覧の各パッケージをそのまま読み込み、各サイズで表示とアニメーションを確認する。', '試験後ハッシュと表示可否を一覧化し、成功件数を対象件数で割る。'],
         ['既存パッケージの全件一覧は要確認。genba-nekoは既存QAの一例であって全件を意味しない。'],
         '確定した全対象が追加加工なしで表示でき、互換率100%。Q-REAL-007で全対象を確定するまでは全件合格を宣言しない。', ['spec.md#L369']),
        ('ホイールや単なるカーソル移動でサイズ・位置を変えない', ['FR-002','FR-012'],
         ['ペットを表示し、ドラッグしない状態でサイズと位置を記録する。'],
         ['ボタンを押さずカーソルを動かす。', 'ペット本体上でホイール操作を行い、サイズ・位置を比較する。'],
         ['75/100/125/150%それぞれでカーソル移動とホイール上下操作を実施。'],
         'ペットがカーソルを自発的に追いかけず、ホイールではサイズを変更しない。', ['spec.md#L27','spec.md#L30','spec.md#L211']),
    ]
    for title, targets, pre, steps, data, expected, refs in supplementary:
        test = dict(id=f'TST-{65+len(model["test_cases"]):03}', title=title, type='positive', level='logical-acceptance', status='planned', priority='unspecified', preconditions=pre, steps=steps, test_data=data, expected_result=expected, source_refs=refs, automation_status='unspecified', basis='derived', rationale='原文の観測可能な条件を試験手順へ展開。試験用組合せは実施提案であり要件を追加するものではない。')
        add_test(test, targets)

    # Preserve uncovered extraction candidates visibly, never pad coverage with
    # invented expected results or pretend their procedures are executable.
    covered = {l['from_id'] for l in model['links'] if l['type'] == 'requirement-to-test'}
    retained = []
    for test in old_tests:
        targets = [l['from_id'] for l in old_links if l['type'] == 'requirement-to-test' and l['to_id'] == test['id'] and l['from_id'] not in covered]
        if targets:
            test['title'] = '要具体化: ' + test['title']
            add_test(test, targets)
            retained.append(test['id'])
        else:
            registry[test['id']]['lifecycle'] = 'retired'
            model['change_impact'].append(dict(id=test['id'], change='retired', source_key=registry[test['id']]['source_key'], impact='不完全な自動候補を、原文から復元した受入試験・契約試験へ置換。IDを再利用しない。'))

    questions = [
        ('001', 'SC-002の0.3秒以内はどこから測るか。FR-025の2 DIP到達前の低速移動にも適用するか。', ['SC-002','FR-025'], ['spec.md#L241','spec.md#L356'], 'speckit.clarify'),
        ('002', 'scalePercentが文字列の場合、位置・選択ペットを保持するか、設定全体を初期化するか。FR-021と契約・過去QAの扱いを統一する。', ['FR-021','FR-016'], ['spec.md#L292','contracts/app-settings.md#L81','qa/us3-visual-qa.md#L44'], 'speckit.analyze'),
        ('003', 'OSの表示倍率を変更した時に画面外へ出る場合の補正規則を確定する。通常のサイズ選択時の規則を流用してよいとはまだ言えない。', ['FR-022'], ['qa/final-visual-qa.md#L25'], 'speckit.plan'),
        ('004', '001の継承要件を別途取り込み、変更されない要件の回帰試験を照合する。今回の002資料だけではアプリ全体の網羅性を保証しない。', ['US-001','US-002','US-003'], ['spec.md#L13','spec.md#L21'], 'speckit.analyze'),
        ('005', '原文の独立レビュー指摘を反映した最終正本の再レビューが必要。担当エージェントの利用上限により未実施。特に直接REQ→TSTの範囲と子要件への対応を確認する。', [f'FNC-{n:03}' for n in groups], ['spec.md#L78'], 'semantic-review'),
        ('006', '残った自動試験候補を具体的な事前条件・データ・操作・観測結果へ展開する。既存QAのPASSは今回の実行結果ではない。', retained, ['quickstart.md#L1','checklists/visual-qa.md#L1'], 'test-review'),
        ('007', '初心者ユーザー試験の参加人数・選定条件と、全件互換試験に用いる既存ペットパッケージの一覧を確定する。', ['SC-008','SC-009'], ['spec.md#L368','spec.md#L369'], 'speckit.clarify'),
    ]
    model['open_questions'] = [dict(id='Q-REAL-'+n, question=q, affected_ids=ids, source_refs=refs, return_to=dest, status='open') for n,q,ids,refs,dest in questions]
    model['context']['overview'] = '002変更範囲のレビュー用資料。原文の受入条件20件を復元し、責務別6機能と詳細試験を追加した。アプリ試験は未実施。入力の矛盾、未具体化試験、最終独立レビュー待ちが残るため公開承認済みではない。001継承要件の全面照合は対象外。'
    model.pop('review_record', None)
    model['profile'] = 'draft'
    require_valid_model(model, FEATURE)
    model['report'] = evaluate_model(model, FEATURE, 'draft')
    out = HERE / 'review-draft'
    out.mkdir(exist_ok=True)
    save(out / f'{STEM}_requirements-functions-tests.json', model)
    write_rendered(model, out, STEM, FEATURE)
    print(json.dumps(dict(requirements=len(reqs), acceptance_scenarios=len(scenarios), functions=len(groups), tests=len(model['test_cases']), incomplete_candidates=retained, report=model['report']), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    build()
