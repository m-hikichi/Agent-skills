import React from 'react';
import {Audio} from '@remotion/media';
import {
  AbsoluteFill,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {BUNDLED_FONT_FAMILY, type ProjectLock, type RenderInput, type ResolvedScene, type Speaker, type VideoProject} from '../shared/video-types.js';
import {clampVolume, createSubtitleLayoutStyles, effectiveDurationInFrames, effectiveScenes, sceneOpacity, storyboardCellLayout} from './layout.js';
import {VisualTemplate} from './templates.js';

// Remotion requires an index signature for composition props. The shared contract
// deliberately stays a closed interface, so the renderer adds it at this boundary.
export type RemotionRenderInput = RenderInput & Record<string, unknown>;

const resolveSpeaker = (project: VideoProject, id?: string): Speaker | undefined =>
  id ? project.speakers.find((speaker) => speaker.id === id) : undefined;

const materializeAssetUrls = (assetUrls: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(assetUrls).map(([id, url]) => [
    id,
    url.startsWith('remotion-static:') ? staticFile(url.slice('remotion-static:'.length)) : url,
  ]));

const resolveAvatar = (
  speaker: Speaker | undefined,
  emotion: string | undefined,
  mouthOpen: boolean,
): string | undefined => {
  if (!speaker?.avatar) return undefined;
  if (mouthOpen && speaker.avatar.mouthOpenAssetId) return speaker.avatar.mouthOpenAssetId;
  if (emotion && speaker.avatar.expressions?.[emotion]) return speaker.avatar.expressions[emotion];
  return speaker.avatar.defaultAssetId;
};

const SceneLayer = ({scene, project, assetUrls, staticPreview = false}: {scene: ResolvedScene; project: VideoProject; assetUrls: Record<string, string>; staticPreview?: boolean}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const speaker = resolveSpeaker(project, scene.speakerId);
  const inferredSpeakingFrames = Math.max(0, scene.durationInFrames - Math.ceil(((scene.holdAfterMs ?? 0) / 1_000) * fps));
  const speakingFrames = scene.audioDurationMs > 0 ? Math.ceil((scene.audioDurationMs / 1_000) * fps) : inferredSpeakingFrames;
  const isSpeaking = Boolean(scene.text || scene.resolvedAudioAssetId) && frame < speakingFrames;
  const avatarId = resolveAvatar(speaker, scene.emotion, !staticPreview && isSpeaking && frame % 10 < 4);
  const avatarSrc = avatarId ? assetUrls[avatarId] : undefined;
  const subtitleFontSize = project.theme.subtitleStyle?.fontSize ?? 48;
  const subtitleMaxLines = project.theme.subtitleStyle?.maxLines ?? 2;
  const subtitleLayout = createSubtitleLayoutStyles(subtitleFontSize, subtitleMaxLines);
  const fade = staticPreview ? 1 : sceneOpacity(frame, scene.durationInFrames);

  return (
    <AbsoluteFill style={{opacity: scene.visual.type === 'flow' ? 1 : fade, color: project.theme.foregroundColor}}>
      <AbsoluteFill style={{display: 'grid', placeItems: 'center', padding: '70px 140px 190px'}}>
        <VisualTemplate visual={scene.visual} project={project} assetUrls={assetUrls} staticPreview={staticPreview} />
      </AbsoluteFill>
      {avatarSrc ? (
        <Img
          src={avatarSrc}
          style={{position: 'absolute', opacity: scene.visual.type === 'flow' ? fade : 1, right: 42, bottom: 154, width: 290, height: 390, objectFit: 'contain', transform: `translateY(${!staticPreview && isSpeaking ? Math.sin(frame / 3) * 3 : 0}px)`}}
        />
      ) : null}
      {scene.subtitleText && (staticPreview || frame < speakingFrames) ? (
        <div style={{position: 'absolute', opacity: scene.visual.type === 'flow' ? fade : 1, left: 190, right: 190, bottom: 44, borderRadius: 18, textAlign: 'center', fontSize: subtitleFontSize, fontWeight: 800, color: project.theme.subtitleStyle?.color ?? '#fff', background: project.theme.subtitleStyle?.backgroundColor ?? 'rgba(0,0,0,.78)', textShadow: '0 3px 8px rgba(0,0,0,.8)', ...subtitleLayout.box}}>
          <div style={subtitleLayout.text}>{scene.subtitleText}</div>
        </div>
      ) : null}
      {!staticPreview && scene.resolvedAudioAssetId && assetUrls[scene.resolvedAudioAssetId] ? (
        <Audio
          src={assetUrls[scene.resolvedAudioAssetId]}
          volume={scene.resolvedAudioAssetId.startsWith('voice:') ? 1 : clampVolume(speaker?.volume)}
        />
      ) : null}
      {!staticPreview && scene.sfxAssetId && assetUrls[scene.sfxAssetId] ? (
        <Audio src={assetUrls[scene.sfxAssetId]} volume={clampVolume(project.audio?.sfxVolume)} />
      ) : null}
    </AbsoluteFill>
  );
};

const backgroundForScene = (project: VideoProject, scene: ResolvedScene, assetUrls: Record<string, string>): string | undefined => {
  const section = project.sections.find((item) => item.id === scene.sectionId);
  return section?.backgroundAssetId ? assetUrls[section.backgroundAssetId] : undefined;
};

export const VideoComposition = ({project, lock, assetUrls}: RemotionRenderInput) => {
  const resolvedAssetUrls = materializeAssetUrls(assetUrls);
  const scenes = effectiveScenes(project, lock);
  const sectionAudio = project.sections.flatMap((section) => {
    const assetId = section.bgmAssetId ?? project.audio?.bgmAssetId;
    if (!assetId || !resolvedAssetUrls[assetId]) return [];
    const sectionScenes = scenes.filter((scene) => scene.sectionId === section.id);
    const first = sectionScenes[0];
    const last = sectionScenes.at(-1);
    if (!first || !last) return [];
    return [{id: section.id, assetId, from: first.startFrame, durationInFrames: last.startFrame + last.durationInFrames - first.startFrame}];
  });
  return (
    <AbsoluteFill style={{fontFamily: BUNDLED_FONT_FAMILY, background: project.theme.backgroundColor, color: project.theme.foregroundColor, overflow: 'hidden'}}>
      {scenes.map((scene) => {
        const background = backgroundForScene(project, scene, resolvedAssetUrls);
        return (
          <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames} name={scene.id}>
            {background ? <Img src={background} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.27}} /> : null}
            <SceneLayer scene={scene} project={project} assetUrls={resolvedAssetUrls} />
          </Sequence>
        );
      })}
      {sectionAudio.map((audio) => (
        <Sequence key={`bgm-${audio.id}`} from={audio.from} durationInFrames={audio.durationInFrames} name={`BGM ${audio.id}`}>
          <Audio src={resolvedAssetUrls[audio.assetId]} volume={clampVolume(project.audio?.bgmVolume, 0.12)} loop />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const ThumbnailComposition = ({project, assetUrls}: RemotionRenderInput) => {
  const resolvedAssetUrls = materializeAssetUrls(assetUrls);
  const background = project.thumbnail.backgroundAssetId ? resolvedAssetUrls[project.thumbnail.backgroundAssetId] : undefined;
  const align = project.thumbnail.layout ?? 'center';
  const avatars = (project.thumbnail.speakerIds ?? [])
    .map((id) => resolveSpeaker(project, id))
    .map((speaker) => speaker?.avatar?.defaultAssetId)
    .filter((id): id is string => Boolean(id))
    .map((id) => resolvedAssetUrls[id])
    .filter((url): url is string => Boolean(url));
  return (
    <AbsoluteFill style={{fontFamily: BUNDLED_FONT_FAMILY, background: project.theme.backgroundColor, color: project.theme.foregroundColor, overflow: 'hidden'}}>
      {background ? <Img src={background} style={{width: '100%', height: '100%', objectFit: 'cover', opacity: 0.46}} /> : null}
      <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(3,7,18,.92), rgba(3,7,18,.18))'}} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', padding: 90, textAlign: align}}>
        <div style={{maxWidth: 1040}}>
          {project.thumbnail.textLines.map((line, index) => <div key={line} style={{fontSize: index === 0 ? 105 : 82, lineHeight: 1.02, fontWeight: 950, color: index === 0 ? project.theme.accentColor : project.theme.foregroundColor, textShadow: '0 8px 30px rgba(0,0,0,.75)', marginTop: index ? 20 : 0}}>{line}</div>)}
        </div>
      </AbsoluteFill>
      {avatars.map((url, index) => (
        <Img key={url} src={url} style={{position: 'absolute', right: 26 + index * 190, bottom: -35, width: 280, height: 490, objectFit: 'contain', filter: 'drop-shadow(0 16px 20px rgba(0,0,0,.55))'}} />
      ))}
    </AbsoluteFill>
  );
};

export const StoryboardComposition = ({project, lock, assetUrls}: RemotionRenderInput) => {
  const {width, height} = useVideoConfig();
  const cell = storyboardCellLayout(width, height);
  const resolvedAssetUrls = materializeAssetUrls(assetUrls);
  const scenes = effectiveScenes(project, lock).slice(0, 12);
  return (
    <AbsoluteFill style={{background: '#e8edf5', padding: 28, boxSizing: 'border-box', fontFamily: BUNDLED_FONT_FAMILY, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridTemplateRows: 'repeat(4, minmax(0, 1fr))', gap: 18}}>
      {scenes.map((scene, index) => (
        <div key={scene.id} style={{position: 'relative', overflow: 'hidden', borderRadius: 14, boxShadow: '0 5px 18px rgba(15,23,42,.18)'}}>
          <div style={{width: 1920, height: 1080, left: cell.left, top: cell.top, transform: `scale(${cell.scale})`, transformOrigin: 'top left', background: project.theme.backgroundColor, color: project.theme.foregroundColor, position: 'absolute', overflow: 'hidden'}}>
            {backgroundForScene(project, scene, resolvedAssetUrls) ? <Img src={backgroundForScene(project, scene, resolvedAssetUrls)!} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.27}} /> : null}
            <SceneLayer scene={{...scene, startFrame: 0}} project={project} assetUrls={resolvedAssetUrls} staticPreview />
          </div>
          <div style={{position: 'absolute', left: 10, top: 3, borderRadius: 8, background: 'rgba(0,0,0,.76)', color: '#fff', padding: '3px 9px', fontSize: 16}}>{index + 1}. {scene.id}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
};

export const calculateMainMetadata = ({props}: {props: RemotionRenderInput}) => ({
  durationInFrames: effectiveDurationInFrames(props.project, props.lock),
  fps: props.project.canvas.fps,
  width: 1920,
  height: 1080,
});

export const emptyRenderInput = (): RemotionRenderInput => ({
  project: {
    schemaVersion: '1.0.0',
    meta: {id: 'preview', title: 'Preview', language: 'ja-JP'},
    canvas: {preset: 'youtube-1080p', fps: 30},
    theme: {backgroundColor: '#07111f', foregroundColor: '#f8fafc', accentColor: '#22d3ee', fontFamily: BUNDLED_FONT_FAMILY},
    assets: [], speakers: [], sections: [],
    thumbnail: {textLines: ['Preview']},
    outputs: {video: true, captions: true, chapters: true, thumbnail: true, storyboard: true},
    policies: {allowUnknownRights: false, maxDurationMinutes: 30},
  },
  lock: {
    lockVersion: '1.0.0', projectDigest: '', lockHash: '', generatedAt: '',
    runtime: {node: '', remotion: '', ffmpeg: '', chrome: '', font: ''},
    assets: [], scenes: [], totalFrames: 1, fps: 30, credits: [], warnings: [],
  },
  assetUrls: {},
});

export const renderDuration = (project: VideoProject, lock: ProjectLock): number =>
  effectiveDurationInFrames(project, lock);
