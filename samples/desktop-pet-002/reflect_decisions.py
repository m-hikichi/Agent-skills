"""Apply the user's recorded decisions to the existing editorial canonical.

Original editorial output is kept in review-draft. No product code is changed.
"""
import copy
import difflib
import hashlib
import json
import subprocess
from pathlib import Path
from build_documents import HERE, FEATURE, STEM, save
from document_model import extract_requirements, evaluate_model
from render_documents import write_rendered
from schema_validation import require_valid_model

OUT = HERE / 'decision-reviewed'
DECISIONS = 'decisions-2026-09-27.md'


def main():
    model = json.loads((HERE / 'review-draft' / f'{STEM}_requirements-functions-tests.json').read_text(encoding='utf-8'))
    old_model = copy.deepcopy(model)
    repo = FEATURE.parents[1]
    line_maps = {}
    mapping_notes = []
    for source in model['sources']:
        path = FEATURE / source['path']
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != source['sha256']:
            relative = path.relative_to(repo).as_posix()
            old = subprocess.check_output(['git', '-c', f'safe.directory={repo.as_posix()}', '-C', str(repo), 'show', f'HEAD:{relative}'])
            # Avoid remapping against an unrelated version of the source.
            variants = [old, old.replace(b'\r\n', b'\n'), old.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')]
            variants += [b'\xef\xbb\xbf' + v for v in list(variants)]
            if source['sha256'] not in {hashlib.sha256(v).hexdigest() for v in variants}:
                mapping_notes.append(relative + ': original byte fingerprint differs from HEAD; line references require independent review against source text')
            old_lines = old.decode('utf-8-sig').splitlines()
            new_lines = content.decode('utf-8-sig').splitlines()
            mapping = {}
            for tag, a, b, c, d in difflib.SequenceMatcher(a=old_lines, b=new_lines, autojunk=False).get_opcodes():
                for n in range(a, b):
                    mapping[n + 1] = (c + n - a + 1) if tag == 'equal' else min(c + 1, len(new_lines))
            line_maps[source['path']] = mapping
        source['sha256'] = hashlib.sha256(content).hexdigest()

    def remap(value):
        if isinstance(value, str) and '#L' in value:
            path, _, number = value.rpartition('#L')
            if path in line_maps and number.isdigit():
                return path + '#L' + str(line_maps[path][int(number)])
        if isinstance(value, list):
            return [remap(v) for v in value]
        if isinstance(value, dict):
            return {k: remap(v) for k, v in value.items()}
        return value
    model = remap(model)
    _, extracted, _ = extract_requirements(FEATURE / 'spec.md')
    current = {r['id']: r for r in extracted}
    reqs = {r['id']: r for r in model['requirements']}
    tests = {t['id']: t for t in model['test_cases']}
    for id_ in ['FR-015','FR-021','SC-002','SC-008','SC-009']:
        reqs[id_]['statement'] = current[id_]['statement']
        decision_line = {'FR-015':7,'FR-021':6,'SC-002':5,'SC-008':11,'SC-009':12}[id_]
        reqs[id_]['source_refs'] = current[id_]['source_refs'] + [DECISIONS + f'#L{decision_line}']
        model['change_impact'].append(dict(id=id_, change='modified', source_key='user-decisions-2026-09-27', impact='利用者が選択した方針を入力仕様と派生資料へ反映。旧試験結果は新仕様の合格証拠としない。'))
    for part in model['unclassified']:
        ref = part.get('source_ref', '')
        source_path = ref.split('#L')[0]
        if source_path in line_maps and source_path != 'spec.md':
            part['content'] = (FEATURE / source_path).read_text(encoding='utf-8')

    for name, kind, authority in [(DECISIONS,'user-decisions','normative'), ('baseline-001/spec.md','inherited-spec','normative')]:
        model['sources'].append(dict(path=name, type=kind, authority=authority, locator='*', sha256=hashlib.sha256((FEATURE / name).read_bytes()).hexdigest(), explicit=True))

    def revise(id_, **values):
        tests[id_].update(values)
        tests[id_]['rationale'] = '利用者の2026-09-27の決定と入力仕様に基づき具体化。実行結果は別の試験記録で管理する。'
        decision_line = {'TST-006':8,'TST-051':5,'TST-095':6,'TST-107':11,'TST-108':12}[id_]
        tests[id_]['source_refs'].append(DECISIONS + f'#L{decision_line}')

    revise('TST-051', title='しきい値に達してから0.3秒以内に走り始める',
           preconditions=['ペットは待機状態。本体をつかみ、カーソル変位とアニメーション開始時刻を記録できる検証環境。'],
           steps=['左右それぞれ、0.3秒を超える時間をかけて1 DIPだけ動かし、待機を維持することを確認する。', '停止して待機に戻してから、300 ms未満の間隔で1 DIPずつ2回動かす。符号つき累積が±2 DIPに達した時刻と最初の走り表示時刻を記録する。', '両方向で走りの向きと反応時間を比較する。'],
           test_data=['左/右、しきい値2 DIP未満と到達。画面上の移動量は現在モニタの表示倍率で換算する。'],
           expected_result='しきい値未満は待機を維持。±2 DIPに達してから0.3秒以内に対応方向の走りを開始し、最初の走りの向きも一致する。位置の追従は遅らせない。')
    revise('TST-095', title='サイズ設定が文字列でも位置と選択ペットを保持する',
           test_data=['{"schemaVersion":1,"selectedPetId":"genba-neko","positionX":900,"positionY":400,"scalePercent":"big"}'],
           preconditions=['実利用設定と分離した一時保存先を使う。genba-nekoが読み込めること。'],
           steps=['指定JSONを一時保存先に用意しSettingsServiceで読み込む。', '解釈後のサイズとSelectedPetId、PositionX、PositionYを確認する。'],
           expected_result='サイズはMedium 100%。SelectedPetIdはgenba-neko、PositionXは900、PositionYは400を保持し、例外で起動を失敗させない。')
    revise('TST-107', title='初めて使う3人がサイズ変更方法を発見できる',
           preconditions=['サイズ変更方法を知らない実際の利用者3人。各人に説明書や操作誘導を渡さず、他の参加者の操作を見せない。'],
           steps=['各参加者へサイズを変えたいという目的だけを伝えて計時を開始する。', 'サイズ選択の場所を見つけた時刻と操作経路を記録する。', '3人それぞれの結果を1分と比較し、誰かの成功で他の人を成功扱いしない。'],
           test_data=['参加者U1/U2/U3。試験前にサイズ変更方法を知らないことを確認。実名等の個人情報は不要。'],
           expected_result='3人全員が説明書や誘導なしで1分以内にサイズ変更方法を発見する。1人でも超過した場合はその結果を記録して不合格とする。未参加は未実施であり合格ではない。')
    revise('TST-108', title='提供中の全2ペットを全4サイズで表示できる',
           preconditions=['提供中のgenba-nekoとyoshi-catのpet.json・spritesheet.webpを読み取り専用で用意し、試験前ハッシュを記録する。'],
           steps=['2パッケージそれぞれを加工せず読み込み、75/100/125/150%へ変更する。', '各組合せで表示と待機・左右走りのコマ進行を確認する。', '全8組合せの結果と試験後ハッシュを記録する。'],
           test_data=['genba-neko×75/100/125/150%、yoshi-cat×75/100/125/150%。素材は変更しない。'],
           expected_result='8組合せすべてで追加加工なしに表示・アニメーションを利用でき、互換率100%。素材のハッシュは変わらない。ファイル読込試験だけでは画面の合格としない。')
    revise('TST-006', title='画面端へのドラッグで従来の位置決定を変えない',
           preconditions=['検証用Windows環境でペット本体をつかめる。サイズやOS表示倍率は試験中に変更しない。'],
           steps=['キャラクター本体上のつかみ点を記録する。', 'カーソルを画面端へ移動し、本体がカーソルとつかみ点の差に従うことを記録する。', 'ボタンを離して位置と待機状態を確認する。'],
           test_data=['上下左右の画面端、本体上の異なるつかみ点。実際の座標と表示倍率を記録する。'],
           expected_result='ドラッグ中の位置はカーソルとつかみ点に従い、走り追加を理由に強制的な画面内補正をしない。解放後はドロップ位置で待機する。サイズ変更・画面構成変更時の補正とは分ける。')
    tests['TST-073']['steps'].append('ボタンを保持したまま再び左右へ2 DIP以上動かし、進行方向の走りが再開することを確認する。')
    for id_ in ['TST-099','TST-104']:
        test = tests[id_]
        test['preconditions'] = ['genba-nekoとyoshi-catをそれぞれ表示する。利用者設定と分離した検証環境で実施する。'] + test['preconditions']
        test['test_data'] = ['対象はgenba-neko/yoshi-catの2種類×75/100/125/150%の全8組合せ。各ペットで実際のコマの透明点・本体点を確認し、座標を記録してから操作する。既存genba-neko用の座標を別ペットへ無検査で流用しない。']
        test['steps'].insert(0,'全8組合せについて以下を実施し、個別に結果を残す。')
        test['source_refs'].append(DECISIONS+'#L12')
    tests['TST-099']['preconditions'] = ['Windows 11、表示倍率100%。genba-neko/yoshi-catを順に表示し、背後にクリック・文字入力を確認できる検証用アプリを置く。']
    tests['TST-099']['steps'][1] = '各ペットのコマで確認した透明点・本体点をサイズに応じた表示座標へ変換する。元コマの画素と試験点を記録する。'

    registry = {e['id']: e for e in model['identity_registry']}
    def register(id_, kind):
        if id_ not in registry:
            entry = dict(id=id_, kind=kind, lifecycle='active', aliases=[], source_key='decision-reflection:'+id_)
            registry[id_] = entry
            model['identity_registry'].append(entry)
    links = {(l['type'],l['from_id'],l['to_id']) for l in model['links']}
    def link(kind, from_, to):
        key = kind,from_,to
        if key not in links:
            links.add(key)
            model['links'].append(dict(type=kind,from_id=from_,to_id=to))
    next_test = max(int(e['id'].split('-')[1]) for e in registry.values() if e['kind']=='test-case' and e['id'].startswith('TST-')) + 1
    def add_test(test, target, function):
        nonlocal next_test
        id_ = f'TST-{next_test:03}'
        next_test += 1
        test.update(id=id_,status='planned',priority='unspecified',automation_status='unspecified',basis='derived')
        model['test_cases'].append(test)
        register(id_,'test-case')
        link('requirement-to-test',target,id_)
        link('function-to-test',function,id_)
        return id_

    add_test(dict(title='OS表示倍率変更時のはみ出し補正とサイズ維持',type='boundary',level='e2e',
                  preconditions=['検証専用WindowsセッションでOSの表示倍率を変更できる。変更前の倍率を記録して試験後に戻す。通常ドラッグの境界通過とは分ける。'],
                  steps=['各サイズで足元が中央付近にある状態からOS倍率を変更し、足元と選択サイズを比較する。', '小さい倍率では収まり、倍率を上げるとはみ出す画面端の位置で同じ操作を行う。', '補正後の矩形と作業領域を比較し、元の表示倍率へ戻す。'],
                  test_data=['ペットgenba-neko/yoshi-cat、サイズ75/100/125/150%。OSで利用可能な100%と150%の組を使い実際の倍率・作業領域を記録する。'],
                  expected_result='収まる場合は足元位置を変えず、はみ出す場合だけ全体が作業領域内に収まる位置へ補正する。どちらも選択サイズは維持する。',
                  rationale='利用者決定3で未定義だったOS倍率変更時の振る舞いを確定。',source_refs=[DECISIONS+'#L7',*reqs['FR-015']['source_refs']]),'FR-015','FNC-005')

    extra_functions = {7:('起動制御・常駐メニュー・終了','多重起動を防ぎ、常駐アイコンから終了し、通常のタスクバーには出さない'),8:('安定稼働・リソース使用量','長時間稼働とリソース基準を維持する'),9:('パッケージ発見・異常時の案内','既定配置先からパッケージを発見し、利用できない場合は原因を案内する')}
    for n,(name,summary) in extra_functions.items():
        fn=dict(id=f'FNC-{n:03}',name=name,summary=summary,status='current',priority='unspecified',actors=['PCで作業する利用者'],trigger='起動・常駐操作・復帰',inputs=['提供中のペットパッケージと保存設定'],outputs=[summary],preconditions=[],postconditions=[summary],business_rules=[],exceptions=[],basis='derived',rationale='001から継承する独立した利用者責務を集約。最終独立レビューで境界を確認する。',source_refs=['baseline-001/spec.md#L1'])
        model['functions'].append(fn)
        register(fn['id'],'function')
    groups={'透過・枠なし表示':6,'最前面表示':6,'継続アニメーション':1,'ペットパッケージ読込・互換':4,'ペットパッケージ発見':9,'クリック透過・本体操作':6,'フォーカス非奪取':6,'常駐メニュー・終了':7,'ドラッグ移動':2,'ペット選択':4,'パッケージ異常時の案内':9,'単一起動':8,'無音・通知抑止':6,'画面構成変更時の位置回復':5,'位置の保存復元':4,'DPI別の表示品質':6,'長時間安定稼働':8,'リソース使用量検証':6,'終了操作の発見性':7,'スリープ復帰':8}
    groups.update({'サイズの保存復元・旧設定・ペット切替':4,'ドラッグの走行方向・停止・中断':2,'ペット発見・読込・異常案内':9,'起動制御・常駐メニュー・終了':7,'常時待機・自律挙動の停止':1,'常駐の安定性・リソース検証':8,'全サイズの描画・クリック判定':6,'足元位置・作業領域・DPI座標変換':5})
    inherited=json.loads((HERE/'inherited-review.json').read_text(encoding='utf-8'))
    for item in inherited:
        id_='V1-'+item['original_id']
        prefix=item['original_id'].split('-')[0]
        kind={'FR':'functional-requirement','SC':'success-criterion','AC':'acceptance-scenario','EC':'edge-case','US':'user-story'}[prefix]
        refs=[r.replace('spec.md#','baseline-001/spec.md#') for r in item['source_refs']]
        req=dict(id=id_,kind=kind,statement=item['statement'],status=item['status'],priority='unspecified',parent_id=None,basis='specified',source_refs=refs)
        model['requirements'].append(req)
        reqs[id_]=req
        register(id_,'requirement')
        if item['status']!='current':
            continue
        fn=f'FNC-{groups[item["function_name"]]:03}'
        link('requirement-to-function',id_,fn)
        test={key:copy.deepcopy(item[key]) for key in ['preconditions','steps','test_data','expected_result','rationale']}
        test.update(title='既存機能の回帰: '+item['function_name']+' ('+item['original_id']+')',type='positive',level='logical-acceptance',source_refs=refs)
        add_test(test,id_,fn)
    # A story spans drag and selection; link its actual selection test as well.
    link('requirement-to-function','V1-US-003','FNC-004')
    for l in list(model['links']):
        if l['type']=='requirement-to-test' and l['from_id']=='V1-FR-011':
            link('requirement-to-test','V1-US-003',l['to_id'])
    for story, related in {'V1-US-001':['V1-FR-003','V1-FR-009'], 'V1-US-002':['V1-SC-003']}.items():
        for r in related:
            for l in list(model['links']):
                if l['from_id'] == r and l['type'] in {'requirement-to-function','requirement-to-test'}:
                    link(l['type'],story,l['to_id'])

    for fn in model['functions']:
        related=[reqs[l['from_id']] for l in model['links'] if l['type']=='requirement-to-function' and l['to_id']==fn['id']]
        fn['business_rules']=[r['statement'] for r in related if r['kind']=='functional-requirement']
        fn['source_refs']=sorted({ref for r in related for ref in r['source_refs']})

    resolutions={1:'利用者がAを選択。時間計測はFR-025のしきい値到達時からとしSC-002とTST-051へ反映。',2:'利用者がAを選択。型不一致でもサイズだけ100%へ戻し他設定を保持。FR-021、契約、TST-095へ反映。現行実装の不適合は試験結果へ分離。',3:'利用者がAを選択。OS表示倍率変更時もはみ出す時だけ補正。FR-015、座標契約、専用試験へ反映。',4:'利用者がAを選択。001原文の保存コピーと独立担当の継承分類に基づき現行42項目、置換済み4項目を追加。',6:'利用者がAを選択。TST-006/051/095/107/108を具体化し、追加の回帰試験とOS倍率変更試験を作成。',7:'利用者がAを選択。初心者3人、提供中2ペット×4サイズに確定。SC-008/009とTST-107/108へ反映。'}
    for q in model['open_questions']:
        n=int(q['id'].rsplit('-',1)[1])
        q['source_refs'] += [DECISIONS+f'#L{ {1:5,2:6,3:7,4:8,5:9,6:10,7:11}[n]}']
        if n == 7:
            q['source_refs'].append(DECISIONS+'#L12')
        if n in resolutions:
            q.update(status='resolved',resolution=resolutions[n])
        else:
            q['question']='利用者は最終独立レビューを選択済み。決定反映後の正本を独立担当が確認し、指摘を解消する。'
            q['affected_ids']=[fn['id'] for fn in model['functions']]
    model['context']['overview']='利用者の7件の決定を反映し、001の維持対象を含めた要求・機能・テスト資料。現在の実装が新しい要求に適合するかは別の実行記録で確認する。実際の利用者3人・長時間・画面操作の未実施を自動試験で代用しない。'
    model.pop('review_record',None)
    for collection in ['requirements', 'functions', 'test_cases', 'open_questions']:
        for item in model[collection]:
            item['source_refs'] = list(dict.fromkeys(item['source_refs']))
    model['report']=evaluate_model(model,FEATURE,'draft')
    require_valid_model(model,FEATURE)
    OUT.mkdir(exist_ok=True)
    save(OUT/f'{STEM}_requirements-functions-tests.json',model)
    write_rendered(model,OUT,STEM,FEATURE)
    save(OUT/'quality-draft.json',model['report'])
    save(OUT/'source-remapping-notes.json', mapping_notes)
    print(json.dumps({'counts':{key:len(model[key]) for key in ['requirements','functions','test_cases']},'blocking_errors':model['report']['blocking_errors'],'test_warnings':model['report']['axes']['test_coverage']['warnings']},ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
