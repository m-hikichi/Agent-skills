import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Player} from '@remotion/player';
import type {JobKind, JobRecord, ProjectEnvelope, StoryboardRunSummary} from '../shared/contracts.js';
import type {ProjectLock, Scene, SceneVisual, Section, Speaker, VideoProject} from '../shared/video-types.js';
import {isPassingReviewForLock} from '../shared/review.js';
import {VideoComposition} from '../render/composition.js';
import type {RemotionRenderInput} from '../render/composition.js';
import {buildPreviewScenes, collectLayoutWarnings, effectiveDurationInFrames} from '../render/layout.js';
import {apiRequest} from './api.js';
import type {OutputEntry, ProjectSummary, ValidationResult, VoicevoxSpeakerSummary} from './server.js';

type Tab = 'edit' | 'json' | 'voice' | 'jobs' | 'outputs';
const OPTIONAL_OUTPUT_KEYS = ['captions', 'chapters', 'thumbnail'] as const;

interface ReviewSummary {
  status: 'pass' | 'fail' | 'missing_info' | 'missing';
  lockHash?: string;
  iteration?: number;
  projectId?: string;
  gates?: unknown;
  issues?: Array<{severity: string; sceneId?: string; problem: string; fix: string; framePath?: string}>;
}

const visualFor = (type: SceneVisual['type']): SceneVisual => {
  switch (type) {
    case 'title': return {type, title: 'タイトル'};
    case 'bullets': return {type, title: 'ポイント', items: ['項目1', '項目2']};
    case 'split': return {type, left: '左側', right: '右側', leftTitle: 'A', rightTitle: 'B'};
    case 'media': return {type, assetId: '', fit: 'contain'};
    case 'code': return {type, variant: 'source', code: '// code', language: 'text'};
    case 'quote': return {type, quote: '引用文'};
    case 'metric': return {type, variant: 'number', label: '指標', value: '100'};
    case 'outro': return {type, title: 'ご視聴ありがとうございました'};
    case 'flow': return {type, title: '処理の流れ', steps: [{title: '入力'}, {title: '出力'}], activeStep: 0};
  }
};

const thumbnailLines = (text: string): VideoProject['thumbnail']['textLines'] => {
  const lines = text.split('\n').slice(0, 2);
  return lines.length > 1 ? [lines[0] ?? '', lines[1] ?? ''] : [lines[0] ?? ''];
};

const previewLock = (project: VideoProject): ProjectLock => {
  const scenes = buildPreviewScenes(project);
  return {
    lockVersion: '1.0.0', projectDigest: 'preview', lockHash: 'preview', generatedAt: '',
    runtime: {node: '', remotion: '', ffmpeg: '', chrome: '', font: ''}, assets: [], scenes,
    totalFrames: scenes.at(-1) ? scenes.at(-1)!.startFrame + scenes.at(-1)!.durationInFrames : 1,
    fps: 30, credits: [], warnings: [],
  };
};

const Field = ({label, children}: {label: string; children: React.ReactNode}) => <label className="field"><span>{label}</span>{children}</label>;
const TextInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />;
const TextArea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />;

const schemaPropertyNames = (value: unknown, names = new Set<string>()): Set<string> => {
  if (!value || typeof value !== 'object') return names;
  const record = value as Record<string, unknown>;
  if (record.properties && typeof record.properties === 'object') {
    for (const [name, schema] of Object.entries(record.properties as Record<string, unknown>)) {
      names.add(name);
      schemaPropertyNames(schema, names);
    }
  }
  if (record.$defs && typeof record.$defs === 'object') {
    for (const schema of Object.values(record.$defs as Record<string, unknown>)) schemaPropertyNames(schema, names);
  }
  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'prefixItems'] as const) {
    if (Array.isArray(record[keyword])) for (const schema of record[keyword] as unknown[]) schemaPropertyNames(schema, names);
  }
  if (record.items && typeof record.items === 'object') schemaPropertyNames(record.items, names);
  return names;
};

const SchemaJsonEditor = ({value, onChange}: {value: string; onChange: (value: string) => void}) => {
  const editor = useRef<HTMLTextAreaElement>(null);
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    void apiRequest<unknown>('/api/schema')
      .then((schema) => setKeys([...schemaPropertyNames(schema)].sort()))
      .catch(() => setKeys([]));
  }, []);
  const insertKey = (key: string) => {
    const target = editor.current;
    if (!target) return;
    const start = target.selectionStart;
    const inserted = `"${key}": `;
    onChange(`${value.slice(0, start)}${inserted}${value.slice(target.selectionEnd)}`);
    requestAnimationFrame(() => { target.focus(); target.setSelectionRange(start + inserted.length, start + inserted.length); });
  };
  return <>
    <textarea ref={editor} className="json-editor" value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label="Schema補完付きJSONエディタ" />
    <details className="schema-completion"><summary>Schema補完（キーを挿入）</summary><div>{keys.map((key) => <button key={key} type="button" onClick={() => insertKey(key)}>{key}</button>)}</div></details>
  </>;
};

const VisualEditor = ({visual, project, onChange}: {visual: SceneVisual; project: VideoProject; onChange: (value: SceneVisual) => void}) => {
  const patch = (values: Record<string, unknown>) => onChange({...visual, ...values} as SceneVisual);
  return <div className="visual-editor">
    <Field label="ビジュアル">
      <select value={visual.type} onChange={(event) => onChange(visualFor(event.target.value as SceneVisual['type']))}>
        {['title', 'bullets', 'split', 'media', 'code', 'quote', 'metric', 'outro', 'flow'].map((type) => <option key={type}>{type}</option>)}
      </select>
    </Field>
    {visual.type === 'title' || visual.type === 'outro' ? <>
      <Field label="タイトル"><TextInput value={visual.title} onChange={(e) => patch({title: e.target.value})} /></Field>
      <Field label="補足"><TextInput value={visual.subtitle ?? ''} onChange={(e) => patch({subtitle: e.target.value || undefined})} /></Field>
    </> : null}
    {visual.type === 'bullets' ? <>
      <Field label="見出し"><TextInput value={visual.title ?? ''} onChange={(e) => patch({title: e.target.value || undefined})} /></Field>
      <Field label="項目（1行1件）"><TextArea value={visual.items.join('\n')} onChange={(e) => patch({items: e.target.value.split('\n')})} /></Field>
    </> : null}
    {visual.type === 'split' ? <div className="two-columns">
      <Field label="左見出し"><TextInput value={visual.leftTitle ?? ''} onChange={(e) => patch({leftTitle: e.target.value})} /></Field>
      <Field label="右見出し"><TextInput value={visual.rightTitle ?? ''} onChange={(e) => patch({rightTitle: e.target.value})} /></Field>
      <Field label="左本文"><TextArea value={visual.left} onChange={(e) => patch({left: e.target.value})} /></Field>
      <Field label="右本文"><TextArea value={visual.right} onChange={(e) => patch({right: e.target.value})} /></Field>
    </div> : null}
    {visual.type === 'media' ? <>
      <Field label="素材"><select value={visual.assetId} onChange={(e) => patch({assetId: e.target.value})}><option value="">選択してください</option>{project.assets.filter((asset) => ['image', 'video'].includes(asset.type)).map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field>
      <Field label="表示"><select value={visual.fit ?? 'contain'} onChange={(e) => patch({fit: e.target.value})}><option>contain</option><option>cover</option></select></Field>
      <Field label="キャプション"><TextInput value={visual.caption ?? ''} onChange={(e) => patch({caption: e.target.value || undefined})} /></Field>
    </> : null}
    {visual.type === 'code' ? <>
      <div className="two-columns"><Field label="種類"><select value={visual.variant} onChange={(e) => patch({variant: e.target.value})}><option>source</option><option>diff</option><option>terminal</option></select></Field><Field label="言語"><TextInput value={visual.language ?? ''} onChange={(e) => patch({language: e.target.value})} /></Field></div>
      <Field label="コード"><TextArea className="code-input" value={visual.code} onChange={(e) => patch({code: e.target.value})} /></Field>
    </> : null}
    {visual.type === 'quote' ? <><Field label="引用"><TextArea value={visual.quote} onChange={(e) => patch({quote: e.target.value})} /></Field><Field label="出典"><TextInput value={visual.attribution ?? ''} onChange={(e) => patch({attribution: e.target.value || undefined})} /></Field></> : null}
    {visual.type === 'metric' ? <>
      <div className="two-columns"><Field label="種類"><select value={visual.variant} onChange={(e) => patch({variant: e.target.value})}><option>number</option><option>bar</option><option>line</option></select></Field><Field label="ラベル"><TextInput value={visual.label} onChange={(e) => patch({label: e.target.value})} /></Field></div>
      {visual.variant === 'number' ? <Field label="値"><TextInput value={visual.value ?? ''} onChange={(e) => patch({value: e.target.value})} /></Field> : <Field label="値（カンマ区切り）"><TextInput value={(visual.values ?? []).join(',')} onChange={(e) => patch({values: e.target.value.split(',').map(Number).filter(Number.isFinite)})} /></Field>}
    </> : null}
    {visual.type === 'flow' ? <>
      <Field label="見出し"><TextInput value={visual.title ?? ''} maxLength={60} onChange={(e) => patch({title: e.target.value || undefined})} /></Field>
      <Field label="説明中の工程"><select value={visual.activeStep} onChange={(e) => patch({activeStep: Number(e.target.value)})}>{visual.steps.map((step, index) => <option key={index} value={index}>{index + 1}. {step.title}</option>)}</select></Field>
      {visual.steps.map((step, index) => <div key={index} className="two-columns">
        <Field label={`工程${index + 1}`}><TextInput value={step.title} maxLength={20} onChange={(e) => patch({steps: visual.steps.map((item, i) => i === index ? {...item, title: e.target.value} : item)})} /></Field>
        <Field label="説明"><TextInput value={step.detail ?? ''} maxLength={45} onChange={(e) => patch({steps: visual.steps.map((item, i) => i === index ? {...item, detail: e.target.value || undefined} : item)})} /></Field>
      </div>)}
      <button disabled={visual.steps.length >= 4} onClick={() => patch({steps: [...visual.steps, {title: '次の工程'}]})}>工程を追加</button>
      <button disabled={visual.steps.length <= 2} onClick={() => patch({steps: visual.steps.slice(0, -1), activeStep: Math.min(visual.activeStep, visual.steps.length - 2)})}>最後の工程を削除</button>
    </> : null}
  </div>;
};

const move = <T,>(items: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= items.length) return items;
  const result = [...items];
  const [item] = result.splice(from, 1);
  if (item !== undefined) result.splice(to, 0, item);
  return result;
};

// Scene is generated from the conditional JSON Schema. The editor intentionally
// allows incomplete intermediate values; validate/save is the contract boundary.
const patchScene = (scene: Scene, values: Record<string, unknown>): Scene => ({...scene, ...values} as Scene);

const SceneEditor = ({scene, project, index, count, onChange, onMove, onDropFrom, onDuplicate, onRemove}: {scene: Scene; project: VideoProject; index: number; count: number; onChange: (scene: Scene) => void; onMove: (to: number) => void; onDropFrom: (from: number) => void; onDuplicate: () => void; onRemove: () => void}) => (
  <article className="scene-card" onDragOver={(event) => {event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';}} onDrop={(event) => {event.preventDefault(); event.stopPropagation(); const from = Number(event.dataTransfer.getData('application/x-json-video-scene') || event.dataTransfer.getData('text/plain')); if (Number.isInteger(from)) onDropFrom(from);}}>
    <header><span className="scene-drag-handle" draggable aria-label={`Scene ${scene.id}をドラッグ`} title="ドラッグして並べ替え" onDragStart={(event) => {event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-json-video-scene', String(index)); event.dataTransfer.setData('text/plain', String(index));}}>⠿ <strong>{index + 1}. {scene.id}</strong></span><div className="row"><button disabled={index === 0} onClick={() => onMove(index - 1)}>↑</button><button disabled={index === count - 1} onClick={() => onMove(index + 1)}>↓</button><button onClick={onDuplicate}>複製</button><button className="danger" onClick={onRemove}>削除</button></div></header>
    <div className="two-columns">
      <Field label="Scene ID"><TextInput value={scene.id} onChange={(e) => onChange(patchScene(scene, {id: e.target.value}))} /></Field>
      <Field label="話者"><select value={scene.speakerId ?? ''} onChange={(e) => onChange(patchScene(scene, {speakerId: e.target.value || undefined}))}><option value="">なし</option>{project.speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.displayName}</option>)}</select></Field>
    </div>
    <Field label="台詞"><TextArea value={scene.text ?? ''} onChange={(e) => onChange(patchScene(scene, {text: e.target.value || undefined}))} /></Field>
    <Field label="字幕（空なら台詞を使用）"><TextArea value={scene.subtitle ?? ''} onChange={(e) => onChange(patchScene(scene, {subtitle: e.target.value || undefined}))} /></Field>
    <Field label="ユーザー音声"><select value={scene.audioAssetId ?? ''} onChange={(e) => onChange(patchScene(scene, {audioAssetId: e.target.value || undefined}))}><option value="">VOICEVOXまたは無音</option>{project.assets.filter((asset) => asset.type === 'audio').map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field>
    <Field label="効果音"><select value={scene.sfxAssetId ?? ''} onChange={(e) => onChange(patchScene(scene, {sfxAssetId: e.target.value || undefined}))}><option value="">なし</option>{project.assets.filter((asset) => asset.type === 'audio').map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field>
    <div className="three-columns">
      <Field label="表情"><TextInput value={scene.emotion ?? ''} onChange={(e) => onChange(patchScene(scene, {emotion: e.target.value}))} /></Field>
      <Field label="無音時間 ms"><TextInput type="number" min="1" value={scene.durationMs ?? ''} onChange={(e) => onChange(patchScene(scene, {durationMs: e.target.value ? Number(e.target.value) : undefined}))} /></Field>
      <Field label="後余白 ms"><TextInput type="number" min="0" value={scene.holdAfterMs ?? 0} onChange={(e) => onChange(patchScene(scene, {holdAfterMs: Number(e.target.value)}))} /></Field>
    </div>
    <VisualEditor visual={scene.visual} project={project} onChange={(visual) => onChange(patchScene(scene, {visual}))} />
  </article>
);

const SpeakerEditor = ({speaker, voices, assets, onChange, onTest}: {speaker: Speaker; voices: VoicevoxSpeakerSummary[]; assets: VideoProject['assets']; onChange: (speaker: Speaker) => void; onTest: () => void}) => {
  const selected = voices.find((voice) => voice.speakerUuid === speaker.voice?.speakerUuid);
  const avatarAssets = assets.filter((asset) => ['image', 'avatar'].includes(asset.type));
  return <div className="speaker-card"><div className="two-columns"><Field label="ID"><TextInput value={speaker.id} onChange={(e) => onChange({...speaker, id: e.target.value})} /></Field><Field label="表示名"><TextInput value={speaker.displayName} onChange={(e) => onChange({...speaker, displayName: e.target.value})} /></Field></div>
    <div className="two-columns"><Field label="VOICEVOX話者"><select value={speaker.voice?.speakerUuid ?? ''} onChange={(e) => {const voice = voices.find((item) => item.speakerUuid === e.target.value); onChange({...speaker, voice: voice ? {provider: 'voicevox', speakerUuid: voice.speakerUuid, styleId: voice.styles[0]?.id ?? 0} : undefined});}}><option value="">未設定</option>{voices.map((voice) => <option key={voice.speakerUuid} value={voice.speakerUuid}>{voice.name}</option>)}</select></Field>
      <Field label="スタイル"><select value={speaker.voice?.styleId ?? ''} disabled={!selected} onChange={(e) => speaker.voice && onChange({...speaker, voice: {...speaker.voice, styleId: Number(e.target.value)}})}>{selected?.styles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}</select></Field></div>
    {speaker.voice ? <div className="three-columns"><Field label="話速"><TextInput type="number" min="0.5" max="2" step="0.05" value={speaker.voice.speedScale ?? 1} onChange={(e) => speaker.voice && onChange({...speaker, voice: {...speaker.voice, speedScale: Number(e.target.value)}})} /></Field><Field label="VOICEVOX音量"><TextInput type="number" min="0" max="2" step="0.05" value={speaker.voice.volumeScale ?? 1} onChange={(e) => speaker.voice && onChange({...speaker, voice: {...speaker.voice, volumeScale: Number(e.target.value)}})} /></Field><Field label="動画内音量"><TextInput type="number" min="0" max="1" step="0.05" value={speaker.volume ?? 1} onChange={(e) => onChange({...speaker, volume: Number(e.target.value)})} /></Field></div> : null}
    <div className="two-columns"><Field label="通常アバター"><select value={speaker.avatar?.defaultAssetId ?? ''} onChange={(e) => onChange({...speaker, avatar: {...speaker.avatar, defaultAssetId: e.target.value || undefined}})}><option value="">なし</option>{avatarAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field><Field label="口開きアバター"><select value={speaker.avatar?.mouthOpenAssetId ?? ''} onChange={(e) => onChange({...speaker, avatar: {...speaker.avatar, mouthOpenAssetId: e.target.value || undefined}})}><option value="">なし</option>{avatarAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field></div>
    <Field label="表情（emotion:assetId、1行1件）"><TextArea value={Object.entries(speaker.avatar?.expressions ?? {}).map(([emotion, assetId]) => `${emotion}:${assetId}`).join('\n')} onChange={(e) => {const expressions = Object.fromEntries(e.target.value.split(/\r?\n/u).map((line) => line.split(':', 2)).filter((parts): parts is [string, string] => Boolean(parts[0] && parts[1]))); onChange({...speaker, avatar: {...speaker.avatar, expressions}});}} /></Field>
    <button disabled={!speaker.voice} onClick={onTest}>試聴</button>
  </div>;
};

const storyboardRunLabel = (run: StoryboardRunSummary): string =>
  `${run.isCurrent ? 'Current' : 'History'} · ${run.lockHash.slice(0, 12)}`;

const StoryboardComparison = ({runs, projectPath}: {runs: StoryboardRunSummary[]; projectPath: string}) => {
  const [leftHash, setLeftHash] = useState('');
  const [rightHash, setRightHash] = useState('');

  useEffect(() => {
    if (runs.some((run) => run.lockHash === leftHash)) return;
    setLeftHash(runs.find((run) => !run.isCurrent)?.lockHash ?? runs.find((run) => run.isCurrent)?.lockHash ?? runs[0]?.lockHash ?? '');
  }, [runs, leftHash]);
  useEffect(() => {
    if (runs.some((run) => run.lockHash === rightHash) && rightHash !== leftHash) return;
    setRightHash(runs.find((run) => run.isCurrent && run.lockHash !== leftHash)?.lockHash ?? runs.find((run) => run.lockHash !== leftHash)?.lockHash ?? '');
  }, [runs, leftHash, rightHash]);

  const left = runs.find((run) => run.lockHash === leftHash);
  const right = runs.find((run) => run.lockHash === rightHash);
  const sceneIds = useMemo(() => {
    const ordered = new Set<string>();
    for (const frame of left?.frames ?? []) ordered.add(frame.sceneId);
    for (const frame of right?.frames ?? []) ordered.add(frame.sceneId);
    return [...ordered];
  }, [left, right]);
  const leftFrames = useMemo(() => new Map((left?.frames ?? []).map((frame) => [frame.sceneId, frame] as const)), [left]);
  const rightFrames = useMemo(() => new Map((right?.frames ?? []).map((frame) => [frame.sceneId, frame] as const)), [right]);
  const frameUrl = (run: StoryboardRunSummary, filename: string): string =>
    `/api/storyboard-frame?projectPath=${encodeURIComponent(projectPath)}&lockHash=${encodeURIComponent(run.lockHash)}&filename=${encodeURIComponent(filename)}`;
  const timestamp = (run: StoryboardRunSummary): string => {
    const value = new Date(run.createdAt);
    return Number.isNaN(value.valueOf()) ? run.createdAt : value.toLocaleString('ja-JP');
  };

  if (!runs.length) return <p className="muted">比較できるStoryboardはまだありません。</p>;
  return <section className="storyboard-comparison" aria-label="Storyboard比較">
    <div className="storyboard-compare-controls">
      <Field label="左のStoryboard"><select aria-label="左のStoryboard" value={leftHash} onChange={(event) => setLeftHash(event.target.value)}>{runs.map((run) => <option key={run.lockHash} value={run.lockHash}>{storyboardRunLabel(run)} · {timestamp(run)}</option>)}</select></Field>
      <Field label="右のStoryboard"><select aria-label="右のStoryboard" value={rightHash} disabled={runs.length < 2} onChange={(event) => setRightHash(event.target.value)}><option value="">選択してください</option>{runs.map((run) => <option key={run.lockHash} value={run.lockHash} disabled={run.lockHash === leftHash}>{storyboardRunLabel(run)} · {timestamp(run)}</option>)}</select></Field>
    </div>
    {runs.length < 2 ? <p className="muted">編集後にもう一度Resolve → Storyboardを実行すると、前回との差分を比較できます。</p> : null}
    {left && right ? <>
      <div className="storyboard-compare-headings" aria-hidden="true"><strong>{storyboardRunLabel(left)}</strong><strong>{storyboardRunLabel(right)}</strong></div>
      {sceneIds.map((sceneId) => {
        const leftFrame = leftFrames.get(sceneId);
        const rightFrame = rightFrames.get(sceneId);
        return <article className="storyboard-compare-group" data-scene-id={sceneId} key={sceneId}>
          <header><strong>Scene: {sceneId}</strong><span>{leftFrame && rightFrame ? '両方に存在' : leftFrame ? '右では削除' : '右で追加'}</span></header>
          <div className="storyboard-compare-row">
            <figure>{leftFrame ? <img loading="lazy" src={frameUrl(left, leftFrame.filename)} alt={`${sceneId} · ${storyboardRunLabel(left)}`} /> : <div className="storyboard-frame-missing">この世代にはありません</div>}<figcaption>{leftFrame ? `#${leftFrame.index} · ${leftFrame.filename}` : storyboardRunLabel(left)}</figcaption></figure>
            <figure>{rightFrame ? <img loading="lazy" src={frameUrl(right, rightFrame.filename)} alt={`${sceneId} · ${storyboardRunLabel(right)}`} /> : <div className="storyboard-frame-missing">この世代にはありません</div>}<figcaption>{rightFrame ? `#${rightFrame.index} · ${rightFrame.filename}` : storyboardRunLabel(right)}</figcaption></figure>
          </div>
        </article>;
      })}
    </> : null}
  </section>;
};

export const App = () => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [envelope, setEnvelope] = useState<ProjectEnvelope<VideoProject> | null>(null);
  const [resolvedLock, setResolvedLock] = useState<ProjectLock | null>(null);
  const [project, setProjectState] = useState<VideoProject | null>(null);
  const [raw, setRaw] = useState('');
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('edit');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [voices, setVoices] = useState<VoicevoxSpeakerSummary[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [outputs, setOutputs] = useState<OutputEntry[]>([]);
  const [storyboards, setStoryboards] = useState<StoryboardRunSummary[]>([]);
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const handledJobs = useRef(new Set<string>());

  const refreshProjects = useCallback(async () => setProjects(await apiRequest<ProjectSummary[]>('/api/projects')), []);
  const refreshJobs = useCallback(async () => setJobs(await apiRequest<JobRecord[]>('/api/jobs')), []);
  useEffect(() => { void refreshProjects(); void refreshJobs(); }, [refreshProjects, refreshJobs]);
  useEffect(() => { const timer = window.setInterval(() => void refreshJobs(), 1500); return () => clearInterval(timer); }, [refreshJobs]);

  const setProject = (next: VideoProject) => { setProjectState(next); setRaw(JSON.stringify(next, null, 2)); setDirty(true); setValidation(null); setResolvedLock(null); };
  const load = async (projectPath: string) => {
    if (dirty && !window.confirm('未保存の変更を破棄しますか？')) return;
    setError(''); setBusy(true); setStoryboards([]);
    try {
      const next = await apiRequest<ProjectEnvelope<VideoProject>>(`/api/project?path=${encodeURIComponent(projectPath)}`);
      setSelectedPath(projectPath); setEnvelope(next); setProjectState(next.project); setRaw(JSON.stringify(next.project, null, 2)); setDirty(false); setValidation(null);
      setResolvedLock(next.lockState === 'current' ? await apiRequest<ProjectLock>(`/api/preview-lock?path=${encodeURIComponent(projectPath)}`) : null);
      setOutputs(await apiRequest<OutputEntry[]>(`/api/outputs?projectPath=${encodeURIComponent(projectPath)}`));
      setStoryboards(await apiRequest<StoryboardRunSummary[]>(`/api/storyboards?projectPath=${encodeURIComponent(projectPath)}`));
      setReview(await apiRequest<ReviewSummary>(`/api/review?path=${encodeURIComponent(projectPath)}`));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const completed = jobs.filter((job) => job.status === 'succeeded' && job.projectPath === selectedPath && !handledJobs.current.has(job.id));
    if (!completed.length) return;
    for (const job of completed) handledJobs.current.add(job.id);
    if (!dirty && completed.some((job) => job.kind === 'resolve')) void load(selectedPath);
    else if (selectedPath && completed.some((job) => job.kind === 'render' || job.kind === 'storyboard')) {
      void apiRequest<OutputEntry[]>(`/api/outputs?projectPath=${encodeURIComponent(selectedPath)}`).then(setOutputs);
      void apiRequest<StoryboardRunSummary[]>(`/api/storyboards?projectPath=${encodeURIComponent(selectedPath)}`).then(setStoryboards);
      void apiRequest<ReviewSummary>(`/api/review?path=${encodeURIComponent(selectedPath)}`).then(setReview);
    }
  }, [jobs, selectedPath, dirty]);
  const createProject = async () => {
    const directory = window.prompt('workspace内のプロジェクトディレクトリ', 'video-project'); if (!directory) return;
    const projectPath = `${directory.replace(/\/$/u, '')}/video-project.json`;
    try { await apiRequest('/api/projects', {method: 'POST', body: JSON.stringify({projectPath})}); await refreshProjects(); await load(projectPath); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const save = async () => {
    if (!project || !envelope) return; setBusy(true); setError('');
    try { const next = await apiRequest<ProjectEnvelope<VideoProject>>(`/api/project?path=${encodeURIComponent(selectedPath)}`, {method: 'PUT', body: JSON.stringify({revision: envelope.revision, project})}); setEnvelope(next); setProjectState(next.project); setRaw(JSON.stringify(next.project, null, 2)); setDirty(false); await refreshProjects(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const validate = async () => { if (project) setValidation(await apiRequest<ValidationResult>('/api/validate', {method: 'POST', body: JSON.stringify({projectPath: selectedPath, project})})); };
  const applyRaw = () => { try { setProject(JSON.parse(raw) as VideoProject); setError(''); } catch (cause) { setError(`JSONエラー: ${cause instanceof Error ? cause.message : String(cause)}`); } };
  const startJob = async (kind: JobKind, dryRun = false) => { if (!selectedPath) return; await apiRequest('/api/jobs', {method: 'POST', body: JSON.stringify({kind, projectPath: selectedPath, ...(dryRun ? {dryRun: true} : {})})}); await refreshJobs(); setTab('jobs'); };

  const lock = useMemo(() => project ? resolvedLock ?? previewLock(project) : null, [project, resolvedLock]);
  const assetUrls = useMemo(() => project ? Object.fromEntries([...new Set([...project.assets.map((asset) => asset.id), ...(resolvedLock?.assets.map((asset) => asset.id) ?? [])])].map((assetId) => [assetId, `/api/asset?projectPath=${encodeURIComponent(selectedPath)}&assetId=${encodeURIComponent(assetId)}`])) : {}, [project, resolvedLock, selectedPath]);
  const playerInput = useMemo<RemotionRenderInput | null>(() => project && lock ? {project, lock, assetUrls} : null, [project, lock, assetUrls]);
  const localWarnings = project ? collectLayoutWarnings(project) : [];
  const reviewPasses = Boolean(project && resolvedLock && isPassingReviewForLock(review, project.meta.id, resolvedLock.lockHash));
  const displayedReviewStatus = review?.status === 'pass' && !reviewPasses ? 'invalid' : review?.status;

  const updateSection = (index: number, section: Section) => project && setProject({...project, sections: project.sections.map((item, itemIndex) => itemIndex === index ? section : item)});
  const updateAsset = (index: number, asset: VideoProject['assets'][number]) => project && setProject({...project, assets: project.assets.map((item, itemIndex) => itemIndex === index ? asset : item)});
  const upload = async (file: File) => {
    if (!project) return; const body = new FormData(); body.append('file', file);
    const result = await apiRequest<{relativePath: string}>(`/api/assets?projectPath=${encodeURIComponent(selectedPath)}`, {method: 'POST', body});
    const id = file.name.replace(/\.[^.]+$/u, '').replace(/[^a-z0-9-]/giu, '-').toLowerCase() || `asset-${project.assets.length + 1}`;
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('font/') || /\.(?:ttf|otf|woff2)$/iu.test(file.name) ? 'font' : 'image';
    setProject({...project, assets: [...project.assets, {id, type, path: result.relativePath, rights: {status: 'unknown'}}]});
  };
  const loadVoices = async () => { try { setVoices(await apiRequest<VoicevoxSpeakerSummary[]>('/api/voicevox/speakers')); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const testVoice = async (speaker: Speaker) => { if (!speaker.voice) return; const result = await apiRequest<{audioBase64: string; mime: string}>('/api/voicevox/test', {method: 'POST', body: JSON.stringify({speakerUuid: speaker.voice.speakerUuid, styleId: speaker.voice.styleId, text: '音声テストです'})}); new Audio(`data:${result.mime};base64,${result.audioBase64}`).play().catch(() => undefined); };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">▶</span><div><strong>JSON Video</strong><small>Studio v0.1.0</small></div></div>
      <button className="primary full" onClick={createProject}>＋ 新規プロジェクト</button>
      <nav>{projects.map((item) => <button key={item.path} className={item.path === selectedPath ? 'project active' : 'project'} onClick={() => void load(item.path)}><strong>{item.title}</strong><small>{item.path}</small><span className={`lock ${item.lockState}`}>{item.lockState}</span></button>)}</nav>
    </aside>
    <main>
      <header className="topbar"><div><h1>{project?.meta.title ?? 'プロジェクトを選択'}</h1>{selectedPath ? <small>{selectedPath} · lock: {envelope?.lockState}</small> : null}</div><div className="row"><button disabled={!project || busy} onClick={() => void validate()}>検証</button><button className="primary" disabled={!dirty || busy} onClick={() => void save()}>保存</button></div></header>
      {error ? <div className="notice error">{error}</div> : null}
      {validation ? <div className={`notice ${validation.valid ? 'success' : 'error'}`}>{validation.valid ? 'Schema検証に合格しました' : validation.errors.map((item) => `${item.jsonPointer ?? ''} ${item.message}`).join(' / ')}</div> : null}
      {!project || !lock || !playerInput ? <div className="empty"><div>JSONから動画制作を始めましょう</div><button className="primary" onClick={createProject}>プロジェクトを作成</button></div> : <>
        <div className="tabs">{(['edit', 'json', 'voice', 'jobs', 'outputs'] as Tab[]).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => {setTab(item); if (item === 'voice') void loadVoices();}}>{({edit: '編集', json: 'JSON', voice: '音声', jobs: 'Jobs', outputs: '成果物'} as Record<Tab, string>)[item]}</button>)}</div>
        <div className="workspace">
          <section className="editor-pane">
            {tab === 'edit' ? <>
              <div className="panel"><h2>基本設定</h2><Field label="タイトル"><TextInput value={project.meta.title} onChange={(e) => setProject({...project, meta: {...project.meta, title: e.target.value}})} /></Field><Field label="説明"><TextArea value={project.meta.description ?? ''} onChange={(e) => setProject({...project, meta: {...project.meta, description: e.target.value}})} /></Field><div className="three-columns"><Field label="背景色"><TextInput type="color" value={project.theme.backgroundColor} onChange={(e) => setProject({...project, theme: {...project.theme, backgroundColor: e.target.value}})} /></Field><Field label="文字色"><TextInput type="color" value={project.theme.foregroundColor} onChange={(e) => setProject({...project, theme: {...project.theme, foregroundColor: e.target.value}})} /></Field><Field label="アクセント"><TextInput type="color" value={project.theme.accentColor} onChange={(e) => setProject({...project, theme: {...project.theme, accentColor: e.target.value}})} /></Field></div></div>
              <div className="panel"><div className="panel-title"><h2>素材と権利</h2><label className="button">アップロード<input hidden type="file" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} /></label></div>{project.assets.length ? project.assets.map((asset, index) => <div className="asset-card" key={`${asset.id}-${index}`}>
                <div className="three-columns"><Field label="Asset ID"><TextInput value={asset.id} onChange={(e) => updateAsset(index, {...asset, id: e.target.value})} /></Field><Field label="種類"><select value={asset.type} onChange={(e) => updateAsset(index, {...asset, type: e.target.value as typeof asset.type})}>{['image', 'video', 'audio', 'font', 'avatar'].map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="権利状態"><select value={asset.rights.status} onChange={(e) => updateAsset(index, {...asset, rights: {...asset.rights, status: e.target.value as typeof asset.rights.status}})}><option>owned</option><option>licensed</option><option>public-domain</option><option>unknown</option></select></Field></div>
                <code>{asset.path}</code>
                <div className="two-columns"><Field label="作者"><TextInput value={asset.rights.author ?? ''} onChange={(e) => updateAsset(index, {...asset, rights: {...asset.rights, author: e.target.value || undefined}})} /></Field><Field label="ライセンス"><TextInput value={asset.rights.license ?? ''} onChange={(e) => updateAsset(index, {...asset, rights: {...asset.rights, license: e.target.value || undefined}})} /></Field><Field label="出典"><TextInput value={asset.rights.source ?? ''} onChange={(e) => updateAsset(index, {...asset, rights: {...asset.rights, source: e.target.value || undefined}})} /></Field><Field label="クレジット表記"><TextInput value={asset.rights.attribution ?? ''} onChange={(e) => updateAsset(index, {...asset, rights: {...asset.rights, attribution: e.target.value || undefined}})} /></Field></div>
                <button className="danger" onClick={() => setProject({...project, assets: project.assets.filter((_, itemIndex) => itemIndex !== index)})}>素材を削除</button>
              </div>) : <p className="muted">素材はまだありません</p>}</div>
              {project.sections.map((section, sectionIndex) => <div
                className="panel section"
                key={`${section.id}-${sectionIndex}`}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('application/x-json-video-section', String(sectionIndex))}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {event.preventDefault(); const from = Number(event.dataTransfer.getData('application/x-json-video-section')); if (Number.isInteger(from)) setProject({...project, sections: move(project.sections, from, sectionIndex)});}}
              >
                <div className="panel-title"><div><small>SECTION {sectionIndex + 1}</small><TextInput className="section-title" value={section.title} onChange={(e) => updateSection(sectionIndex, {...section, title: e.target.value})} /></div><div className="row"><button disabled={sectionIndex === 0} onClick={() => setProject({...project, sections: move(project.sections, sectionIndex, sectionIndex - 1)})}>↑</button><button disabled={sectionIndex === project.sections.length - 1} onClick={() => setProject({...project, sections: move(project.sections, sectionIndex, sectionIndex + 1)})}>↓</button></div></div>
                <div className="two-columns"><Field label="Section ID"><TextInput value={section.id} onChange={(e) => updateSection(sectionIndex, {...section, id: e.target.value})} /></Field><Field label="背景素材"><select value={section.backgroundAssetId ?? ''} onChange={(e) => updateSection(sectionIndex, {...section, backgroundAssetId: e.target.value || undefined})}><option value="">テーマ背景</option>{project.assets.filter((asset) => asset.type === 'image').map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field></div>
                <Field label="セクションBGM"><select value={section.bgmAssetId ?? ''} onChange={(e) => updateSection(sectionIndex, {...section, bgmAssetId: e.target.value || undefined})}><option value="">全体設定またはなし</option>{project.assets.filter((asset) => asset.type === 'audio').map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field>
                {section.scenes.map((scene, sceneIndex) => <SceneEditor key={`${scene.id}-${sceneIndex}`} scene={scene} project={project} index={sceneIndex} count={section.scenes.length} onChange={(next) => updateSection(sectionIndex, {...section, scenes: section.scenes.map((item, index) => index === sceneIndex ? next : item)})} onMove={(to) => updateSection(sectionIndex, {...section, scenes: move(section.scenes, sceneIndex, to)})} onDropFrom={(from) => updateSection(sectionIndex, {...section, scenes: move(section.scenes, from, sceneIndex)})} onDuplicate={() => updateSection(sectionIndex, {...section, scenes: [...section.scenes.slice(0, sceneIndex + 1), {...scene, id: `${scene.id}-copy-${section.scenes.length + 1}`}, ...section.scenes.slice(sceneIndex + 1)]})} onRemove={() => updateSection(sectionIndex, {...section, scenes: section.scenes.filter((_, index) => index !== sceneIndex)})} />)}
                <button className="full" onClick={() => updateSection(sectionIndex, {...section, scenes: [...section.scenes, {id: `${section.id}-${section.scenes.length + 1}`, subtitle: '新しい台詞', durationMs: 3000, visual: visualFor('title')}]})}>＋ Scene</button>
              </div>)}
              <div className="panel"><h2>サムネイル</h2><Field label="文言（1行1件・最大2行）"><TextArea value={project.thumbnail.textLines.join('\n')} onChange={(e) => setProject({...project, thumbnail: {...project.thumbnail, textLines: thumbnailLines(e.target.value)}})} /></Field><div className="two-columns"><Field label="背景素材"><select value={project.thumbnail.backgroundAssetId ?? ''} onChange={(e) => setProject({...project, thumbnail: {...project.thumbnail, backgroundAssetId: e.target.value || undefined}})}><option value="">なし</option>{project.assets.filter((asset) => asset.type === 'image').map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field><Field label="レイアウト"><select value={project.thumbnail.layout ?? 'center'} onChange={(e) => setProject({...project, thumbnail: {...project.thumbnail, layout: e.target.value as NonNullable<typeof project.thumbnail.layout>}})}><option>left</option><option>center</option><option>right</option></select></Field></div><Field label="登場キャラクター（最大2名）"><select multiple value={project.thumbnail.speakerIds ?? []} onChange={(e) => setProject({...project, thumbnail: {...project.thumbnail, speakerIds: [...e.target.selectedOptions].map((option) => option.value).slice(0, 2)}})}>{project.speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.displayName}</option>)}</select></Field></div>
              <div className="panel"><h2>音量・出力・ポリシー</h2><div className="three-columns"><Field label="全体BGM"><select value={project.audio?.bgmAssetId ?? ''} onChange={(e) => setProject({...project, audio: {...project.audio, bgmAssetId: e.target.value || undefined}})}><option value="">なし</option>{project.assets.filter((asset) => asset.type === 'audio').map((asset) => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></Field><Field label="BGM音量"><TextInput type="number" min="0" max="1" step="0.05" value={project.audio?.bgmVolume ?? 0.18} onChange={(e) => setProject({...project, audio: {...project.audio, bgmVolume: Number(e.target.value)}})} /></Field><Field label="効果音音量"><TextInput type="number" min="0" max="1" step="0.05" value={project.audio?.sfxVolume ?? 1} onChange={(e) => setProject({...project, audio: {...project.audio, sfxVolume: Number(e.target.value)}})} /></Field></div><div className="checkbox-grid"><label title="v0.1の必須成果物です"><input type="checkbox" checked={project.outputs.video} disabled /> video（必須）</label><label title="本番render前のレビューに必要です"><input type="checkbox" checked={project.outputs.storyboard} disabled /> storyboard（必須）</label>{OPTIONAL_OUTPUT_KEYS.map((key) => <label key={key}><input type="checkbox" checked={project.outputs[key]} onChange={(e) => setProject({...project, outputs: {...project.outputs, [key]: e.target.checked}})} /> {key}（任意）</label>)}</div><div className="two-columns"><Field label="最大尺（分）"><TextInput type="number" min="1" max="180" value={project.policies.maxDurationMinutes} onChange={(e) => setProject({...project, policies: {...project.policies, maxDurationMinutes: Number(e.target.value)}})} /></Field><label className="checkbox-field"><input type="checkbox" checked={project.policies.allowUnknownRights} onChange={(e) => setProject({...project, policies: {...project.policies, allowUnknownRights: e.target.checked}})} /> 権利未確認素材を許可</label></div></div>
              <button className="full" onClick={() => {const id = `section-${project.sections.length + 1}`; setProject({...project, sections: [...project.sections, {id, title: '新しいセクション', scenes: [{id: `${id}-1`, subtitle: '新しい台詞', durationMs: 3000, visual: visualFor('title')}]}]});}}>＋ Section</button>
            </> : null}
            {tab === 'json' ? <div className="panel grow"><div className="panel-title"><h2>Raw JSON</h2><button onClick={applyRaw}>JSONを適用</button></div><SchemaJsonEditor value={raw} onChange={(value) => {setRaw(value); setDirty(true);}} /></div> : null}
            {tab === 'voice' ? <div className="panel"><div className="panel-title"><h2>話者とVOICEVOX</h2><button onClick={() => void loadVoices()}>再読込</button></div>{project.speakers.map((speaker, index) => <SpeakerEditor key={`${speaker.id}-${index}`} speaker={speaker} voices={voices} assets={project.assets} onChange={(next) => setProject({...project, speakers: project.speakers.map((item, i) => i === index ? next : item)})} onTest={() => void testVoice(speaker)} />)}<button onClick={() => setProject({...project, speakers: [...project.speakers, {id: `speaker-${project.speakers.length + 1}`, displayName: '話者'}]})}>＋ 話者</button>{!voices.length ? <p className="muted">VOICEVOX Engineに接続すると話者一覧が表示されます。</p> : null}</div> : null}
            {tab === 'jobs' ? <div className="panel"><div className="panel-title"><h2>Jobs</h2><div className="row"><button disabled={dirty} onClick={() => void startJob('resolve', true)}>Resolve dry-run</button><button disabled={dirty} onClick={() => void startJob('resolve')}>Resolve</button><button disabled={dirty || envelope?.lockState !== 'current'} onClick={() => void startJob('storyboard')}>Storyboard</button><button className="primary" title={!reviewPasses ? 'current lockのreviewと8つのhard gate合格が必要です' : ''} disabled={dirty || envelope?.lockState !== 'current' || !reviewPasses} onClick={() => void startJob('render')}>Render</button></div></div>{jobs.map((job) => <div className="job" key={job.id}><div><strong>{job.kind}</strong> <span>{job.status}</span><small>{job.message}</small>{job.result ? <code>{JSON.stringify(job.result)}</code> : null}{job.error ? <code>{job.error.code}: {job.error.message}</code> : null}</div><progress value={job.progress} max={1} />{['queued', 'running'].includes(job.status) ? <button className="danger" onClick={() => void apiRequest(`/api/jobs/${job.id}`, {method: 'DELETE'}).then(refreshJobs)}>キャンセル</button> : null}</div>)}</div> : null}
            {tab === 'outputs' ? <div className="panel"><div className="panel-title"><h2>成果物・Storyboardレビュー</h2><button onClick={() => {void apiRequest<OutputEntry[]>(`/api/outputs?projectPath=${encodeURIComponent(selectedPath)}`).then(setOutputs); void apiRequest<StoryboardRunSummary[]>(`/api/storyboards?projectPath=${encodeURIComponent(selectedPath)}`).then(setStoryboards); void apiRequest<ReviewSummary>(`/api/review?path=${encodeURIComponent(selectedPath)}`).then(setReview);}}>再読込</button></div>
              {review && review.status !== 'missing' ? <div className={`review-summary ${displayedReviewStatus}`}><strong>Review: {displayedReviewStatus}</strong><span>iteration {review.iteration ?? '-'} · {review.lockHash?.slice(0, 12) ?? 'no lock'}</span>{review.status === 'pass' && !reviewPasses ? <span>current lockと8つのhard gateをすべて確認してください。</span> : null}{review.issues?.map((issue, index) => <div key={`${issue.sceneId ?? 'general'}-${index}`}><b>{issue.severity} {issue.sceneId ?? ''}</b><p>{issue.problem}</p><small>修正: {issue.fix}</small></div>)}</div> : <p className="muted">review.jsonはまだありません。</p>}
              <h3>Storyboard比較</h3><StoryboardComparison key={selectedPath} runs={storyboards} projectPath={selectedPath} />
              <div className="storyboard-gallery">{outputs.filter((output) => output.name.endsWith('.png')).map((output) => <figure key={output.path}><img loading="lazy" src={`/api/output?projectPath=${encodeURIComponent(selectedPath)}&path=${encodeURIComponent(output.path)}`} alt={output.name} /><figcaption>{output.name}</figcaption></figure>)}</div>
              {outputs.map((output) => <div className="output" key={output.path}><strong>{output.name}</strong><code>{output.path}</code><a className="button" href={`/api/output?projectPath=${encodeURIComponent(selectedPath)}&path=${encodeURIComponent(output.path)}`}>開く</a></div>)}{!outputs.length ? <p className="muted">成果物はまだありません</p> : null}
            </div> : null}
          </section>
          <aside className="preview-pane"><div className="preview-header"><strong>プレビュー</strong><span>{effectiveDurationInFrames(project, lock)} frames</span></div><Player component={VideoComposition} inputProps={playerInput} durationInFrames={Math.max(1, lock.totalFrames)} compositionWidth={1920} compositionHeight={1080} fps={30} controls style={{width: '100%', aspectRatio: '16 / 9', background: '#000'}} /><div className="warning-list"><strong>レイアウト検査</strong>{localWarnings.length ? localWarnings.map((warning, index) => <div key={`${warning.sceneId}-${index}`}>⚠ {warning.sceneId}: {warning.message}</div>) : <div className="ok">✓ 問題は見つかりません</div>}</div></aside>
        </div>
      </>}
    </main>
  </div>;
};
