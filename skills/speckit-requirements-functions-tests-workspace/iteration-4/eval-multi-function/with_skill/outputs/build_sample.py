"""Reproduce a fictional, editorial many-to-many sample; not business approval."""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = next(p for p in ROOT.parents if (p / 'skills' / 'speckit-requirements-functions-tests').is_dir())
sys.path.insert(0, str(REPO / 'skills/speckit-requirements-functions-tests/scripts'))
from document_model import build_model, evaluate_model, json_text
from render_documents import write_rendered
from schema_validation import require_valid_model

feature = ROOT / 'input'
model = build_model(feature)
by_id = {r['id']: r for r in model['requirements']}
functions = []
for fid, name, reqs, trigger in [
    ('FNC-001', '注文を登録する', ['FR-001', 'FR-003'], '注文担当者が商品 A の数量を入力して登録する'),
    ('FNC-002', '注文を取り消す', ['FR-002', 'FR-003'], '注文担当者が受付済み注文の取消を実行する'),
]:
    fn = copy.deepcopy(model['functions'][0])
    fn.update(id=fid, name=name, summary=name, actors=['注文担当者'], trigger=trigger,
              basis='confirmed', rationale='架空仕様の概要で登録と取消を別業務と明記。FR-003 の監査記録は両機能に共通する条件として扱い、独立した利用者操作には分割しない。',
              inputs=['商品 A の数量'] if fid == 'FNC-001' else ['対象注文 ID'],
              outputs=['保存状態または拒否メッセージ', '成功時の監査記録'],
              preconditions=['注文担当者としてログイン済み'], postconditions=[], exceptions=[],
              business_rules=[by_id[r]['statement'] for r in reqs],
              source_refs=sorted(set(sum([by_id[r]['source_refs'] for r in reqs], []))))
    functions.append(fn)
model['functions'] = functions
model['links'] = []
def link(kind, left, right):
    model['links'].append(dict(type=kind, from_id=left, to_id=right))
for rid, fid in [('FR-001','FNC-001'),('FR-002','FNC-002'),('FR-003','FNC-001'),('FR-003','FNC-002')]:
    link('requirement-to-function',rid,fid)

cases = [
    ('数量下限 1 の登録成功', 'boundary', ['FR-001','FR-003'], ['FNC-001'], ['数量 1 を入力して登録する','保存注文と監査記録を参照する'], ['商品 A、数量 1'], '受付済みの注文が 1 件保存される。発行された注文 ID と操作種別「登録」を持つ監査記録が 1 件ある。'),
    ('数量上限 5 の登録成功', 'boundary', ['FR-001','FR-003'], ['FNC-001'], ['数量 5 を入力して登録する','保存注文と監査記録を参照する'], ['商品 A、数量 5'], '受付済みの注文が 1 件保存される。発行された注文 ID と操作種別「登録」を持つ監査記録が 1 件ある。'),
    ('下限未満 0 の登録拒否', 'boundary', ['FR-001','FR-003'], ['FNC-001'], ['数量 0 を入力して登録する','メッセージ、保存注文、監査記録を確認する'], ['商品 A、数量 0'], '「数量は1～5で入力してください」と表示される。注文も監査記録も 0 件のままである。'),
    ('上限超過 6 の登録拒否', 'boundary', ['FR-001','FR-003'], ['FNC-001'], ['数量 6 を入力して登録する','メッセージ、保存注文、監査記録を確認する'], ['商品 A、数量 6'], '「数量は1～5で入力してください」と表示される。注文も監査記録も 0 件のままである。'),
    ('登録から取消までの監査整合性', 'state', ['FR-001','FR-002','FR-003'], ['FNC-001','FNC-002'], ['数量 1 で登録し、受付済みであることと注文 ID を確認する','その注文 ID に取消を実行する','注文状態と、その注文 ID の監査記録を参照する'], ['商品 A、数量 1、登録時に発行された注文 ID'], '注文状態は取消済みである。同じ注文 ID の監査記録は登録 1 件、取消 1 件、合計 2 件である。'),
    ('取消済み注文の再取消を拒否', 'negative', ['FR-002','FR-003'], ['FNC-002'], ['準備操作として数量 1 で注文を登録し、発行された注文 ID に取消を 1 回実行する','同じ注文 ID にもう一度取消を実行する','メッセージ、注文状態、監査記録を確認する'], ['商品 A、数量 1、準備操作で発行された注文 ID'], '「既に取消済みです」と表示される。注文状態は取消済みのまま、監査記録は登録 1 件・取消 1 件の合計 2 件から増えない。'),
]
model['test_cases'] = []
for number, (title, kind, reqs, fns, steps, data, expected) in enumerate(cases, 1):
    tid = f'TST-{number:03}'
    model['test_cases'].append(dict(id=tid,title=title,type=kind,level='logical-acceptance',status='planned',priority='unspecified',
        preconditions=['注文担当者としてログイン済み。商品 A が使える。注文・監査記録を空に戻している。保存内容と監査記録の検証用参照手段が使える。'],
        steps=steps,test_data=data,expected_result=expected,automation_status='unspecified',basis='confirmed',
        rationale='架空仕様に明示された数量境界・状態・監査件数を具体化した試験仕様。テスト実施済みを意味しない。',
        source_refs=sorted(set(sum([by_id[r]['source_refs'] for r in reqs], []) + ['spec.md#L16']))))
    for rid in reqs: link('requirement-to-test',rid,tid)
    for fid in fns: link('function-to-test',fid,tid)

old_registry = model['identity_registry']
model['identity_registry'] = [e for e in old_registry if e['kind']=='requirement']
for group, kind in [('functions','function'),('test_cases','test-case')]:
    for item in model[group]:
        model['identity_registry'].append(dict(id=item['id'],kind=kind,source_key='reviewed-sample:'+item['id'],lifecycle='active',aliases=[]))
for old in old_registry:
    if old['id'] not in {e['id'] for e in model['identity_registry']}:
        model['identity_registry'].append(dict(old,lifecycle='retired'))
for q in model['open_questions']:
    q['status']='resolved'
    q['resolution']='作成担当 independent_review の合成例を、別担当 root が2026-09-26に入力全文と照合。数量 0/1/5/6、取消成功・再取消拒否、成功・拒否の監査件数、機能と要件の多対多対応を確認し、根拠行番号を修正した。これは合成例の整合確認であり実業務の承認でも試験実施結果でもない。'
    q['source_refs']=['spec.md#L5','spec.md#L6','spec.md#L10','spec.md#L11','spec.md#L12','spec.md#L16','spec.md#L17']
model['profile']='publish'
model['report']=evaluate_model(model,feature,'publish')
require_valid_model(model,feature)
if model['report']['blocking_errors']:
    raise RuntimeError(json.dumps(model['report'],ensure_ascii=False))
(ROOT/'orders_requirements-functions-tests.json').write_text(json_text(model),encoding='utf-8',newline='\n')
write_rendered(model,ROOT,'orders',feature)
print(json.dumps(model['report'],ensure_ascii=False))
