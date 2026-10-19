/* eslint-disable */
/**
 * Generated from schemas/video-project.schema.json.
 * Do not edit by hand; run `npm run generate:types`.
 */

export type Identifier = string;
export type Color = string;
export type LocalPath = string;
export type Rights = {
  [k: string]: any;
} & {
  status: 'owned' | 'licensed' | 'public-domain' | 'unknown';
  license?: string;
  author?: string;
  source?: string;
  attribution?: string;
};
export type Scene = {
  id: Identifier;
  speakerId?: Identifier;
  text?: string;
  subtitle?: string;
  /**
   * Explicit synthesis text; overrides the project pronunciation dictionary without changing displayed text or subtitles.
   */
  speechText?: string;
  emotion?: Identifier;
  audioAssetId?: Identifier;
  sfxAssetId?: Identifier;
  durationMs?: number;
  holdAfterMs?: number;
  visual: SceneVisual;
} & Scene1;
export type SceneVisual =
  | TitleVisual
  | BulletsVisual
  | SplitVisual
  | MediaVisual
  | CodeVisual
  | QuoteVisual
  | MetricVisual
  | OutroVisual
  | FlowVisual;
export type MetricVisual = {
  type: 'metric';
  variant: 'number' | 'bar' | 'line';
  label: string;
  value?: string;
  /**
   * @minItems 1
   * @maxItems 12
   */
  values?: number[];
  /**
   * @minItems 1
   * @maxItems 12
   */
  labels?: string[];
} & MetricVisual1;
export type MetricVisual1 =
  | {
      variant?: 'number';
      value: string;
      [k: string]: any;
    }
  | {
      variant?: 'bar' | 'line';
      /**
       * @minItems 1
       * @maxItems 12
       */
      values: number[];
      [k: string]: any;
    };
export type Scene1 =
  | {
      audioAssetId: Identifier;
      [k: string]: any;
    }
  | {
      speakerId: Identifier;
      text: string;
      [k: string]: any;
    }
  | {
      durationMs: number;
      [k: string]: any;
    };

/**
 * Authoring contract for json-video/v1. All asset paths are local and relative to the project file.
 */
export interface JSONVideoStudioProject {
  schemaVersion: '1.0.0';
  meta: Meta;
  canvas: Canvas;
  theme: Theme;
  /**
   * @maxItems 500
   */
  assets: Asset[];
  /**
   * @maxItems 20
   */
  speakers: Speaker[];
  /**
   * @minItems 1
   * @maxItems 100
   */
  sections: Section[];
  audio?: AudioMix;
  /**
   * @maxItems 200
   */
  pronunciations?: {
    term: string;
    reading: string;
  }[];
  thumbnail: Thumbnail;
  outputs: Outputs;
  policies: Policies;
}
export interface Meta {
  id: Identifier;
  title: string;
  description?: string;
  language: 'ja-JP';
}
export interface Canvas {
  preset: 'youtube-1080p';
  fps: 30;
}
export interface Theme {
  backgroundColor: Color;
  foregroundColor: Color;
  accentColor: Color;
  /**
   * v0.1 uses the Noto Sans CJK JP family bundled in the Docker image so resolved and rendered output use the same locked font.
   */
  fontFamily: 'Noto Sans CJK JP';
  spacing?: 'compact' | 'comfortable';
  subtitleStyle?: SubtitleStyle;
}
export interface SubtitleStyle {
  fontSize?: number;
  maxLines?: 1 | 2;
  backgroundColor?: Color;
  color?: Color;
}
export interface Asset {
  id: Identifier;
  type: 'image' | 'video' | 'audio' | 'font' | 'avatar';
  path: LocalPath;
  rights: Rights;
}
export interface Speaker {
  id: Identifier;
  displayName: string;
  voice?: VoicevoxVoice;
  avatar?: Avatar;
  volume?: number;
  speed?: number;
}
export interface VoicevoxVoice {
  provider: 'voicevox';
  speakerUuid: string;
  styleId: number;
  speedScale?: number;
  volumeScale?: number;
  pitchScale?: number;
  intonationScale?: number;
}
export interface Avatar {
  defaultAssetId?: Identifier;
  mouthOpenAssetId?: Identifier;
  expressions?: {
    [k: string]: Identifier;
  };
}
export interface Section {
  id: Identifier;
  title: string;
  backgroundAssetId?: Identifier;
  bgmAssetId?: Identifier;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  scenes: Scene[];
}
export interface TitleVisual {
  type: 'title';
  title: string;
  subtitle?: string;
}
export interface BulletsVisual {
  type: 'bullets';
  title?: string;
  /**
   * @minItems 1
   * @maxItems 5
   */
  items: string[];
}
export interface SplitVisual {
  type: 'split';
  left: string;
  right: string;
  leftTitle?: string;
  rightTitle?: string;
}
export interface MediaVisual {
  type: 'media';
  assetId: Identifier;
  caption?: string;
  fit?: 'contain' | 'cover';
}
export interface CodeVisual {
  type: 'code';
  variant: 'source' | 'diff' | 'terminal';
  code: string;
  language?: string;
  title?: string;
}
export interface QuoteVisual {
  type: 'quote';
  quote: string;
  attribution?: string;
}
export interface OutroVisual {
  type: 'outro';
  title: string;
  subtitle?: string;
}
export interface FlowVisual {
  type: 'flow';
  title?: string;
  /**
   * @minItems 2
   * @maxItems 4
   */
  steps: {
    title: string;
    detail?: string;
  }[];
  activeStep: number;
}
export interface AudioMix {
  bgmAssetId?: Identifier;
  bgmVolume?: number;
  sfxVolume?: number;
}
export interface Thumbnail {
  backgroundAssetId?: Identifier;
  /**
   * @minItems 1
   * @maxItems 2
   */
  textLines: string[];
  /**
   * @maxItems 2
   */
  speakerIds?: Identifier[];
  layout?: 'left' | 'center' | 'right';
}
export interface Outputs {
  /**
   * v0.1 always renders the primary MP4.
   */
  video: true;
  captions: boolean;
  chapters: boolean;
  thumbnail: boolean;
  /**
   * v0.1 always generates storyboard assets for the mandatory review gate.
   */
  storyboard: true;
}
export interface Policies {
  allowUnknownRights: boolean;
  maxDurationMinutes: number;
}
