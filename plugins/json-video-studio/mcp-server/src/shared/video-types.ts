import type {
  Asset as GeneratedAsset,
  Avatar as GeneratedAvatar,
  JSONVideoStudioProject,
  Rights as GeneratedRights,
  Scene as GeneratedScene,
  SceneVisual as GeneratedSceneVisual,
  Section as GeneratedSection,
  Speaker as GeneratedSpeaker,
  VoicevoxVoice as GeneratedVoicevoxVoice,
} from '../generated/video-project.js';

export const BUNDLED_FONT_FAMILY = 'Noto Sans CJK JP' as const;

// Authoring types are aliases of the generated Draft 2020-12 Schema output.
// Lock and render-only types below are deliberately separate runtime contracts.
export type VideoProject = JSONVideoStudioProject;
export type VideoAsset = GeneratedAsset;
export type AssetRights = GeneratedRights;
export type AssetType = GeneratedAsset['type'];
export type RightsStatus = GeneratedRights['status'];
export type VoicevoxVoice = GeneratedVoicevoxVoice;
export type AvatarDefinition = GeneratedAvatar;
export type Speaker = GeneratedSpeaker;
export type SceneVisual = GeneratedSceneVisual;
export type Scene = GeneratedScene;
export type Section = GeneratedSection;

/** Identity returned by VOICEVOX Engine after resolving speaker UUID + style ID. */
export interface ResolvedVoicevoxIdentity {
  speakerName: string;
  styleName: string;
}

export interface LockedVoicevoxVoice extends ResolvedVoicevoxIdentity {
  provider: 'voicevox';
  engineVersion: string;
  speakerUuid: string;
  styleId: number;
  speedScale: number;
  volumeScale: number;
  pitchScale: number;
  intonationScale: number;
  cacheKey: string;
  textSha256: string;
  synthesisText?: string;
  kana?: string;
}

export interface LockedAsset {
  id: string;
  type: AssetType | 'voice';
  sourcePath: string;
  resolvedPath: string;
  sha256: string;
  mime: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  rights?: AssetRights;
  voice?: LockedVoicevoxVoice;
}

export type ResolvedScene = Scene & {
  sectionId: string;
  sectionTitle: string;
  startFrame: number;
  durationInFrames: number;
  audioDurationMs: number;
  audioAssetId?: string;
  resolvedAudioAssetId?: string;
  subtitleText: string;
};

export interface ProjectLock {
  lockVersion: '1.0.0';
  projectDigest: string;
  lockHash: string;
  generatedAt: string;
  runtime: {
    node: string;
    remotion: string;
    ffmpeg: string;
    chrome: string;
    font: string;
    voicevox?: string;
  };
  assets: LockedAsset[];
  scenes: ResolvedScene[];
  totalFrames: number;
  fps: 30;
  credits: string[];
  warnings: string[];
}

export interface RenderInput extends Record<string, unknown> {
  project: VideoProject;
  lock: ProjectLock;
  assetUrls: Record<string, string>;
}

export interface RenderArtifacts {
  outputDirectory: string;
  lock?: string;
  video?: string;
  thumbnail?: string;
  storyboard?: string[];
  contactSheet?: string;
  contactSheets?: string[];
  thumbnailPreview?: string;
  captions?: string;
  chapters?: string;
  credits?: string;
  report?: string;
  manifest?: string;
}
