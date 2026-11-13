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
  | FlowVisual
  | TableVisual
  | StatementVisual
  | SlideVisual;
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
export type SlideBlock =
  | {
      kind: 'text';
      span?: BlockSpan;
      label?: string;
      heading?: string;
      text: string;
      emphasis?: EmphasisTerms;
    }
  | {
      kind: 'callout';
      span?: BlockSpan;
      text: string;
      emphasis?: EmphasisTerms;
    }
  | {
      kind: 'table';
      span?: BlockSpan;
      heading?: string;
      labelHeader?: string;
      /**
       * @minItems 1
       * @maxItems 6
       */
      columns: string[];
      /**
       * @minItems 1
       * @maxItems 8
       */
      rows: {
        label: string;
        /**
         * @minItems 1
         * @maxItems 6
         */
        cells: string[];
      }[];
      highlightRows?: HighlightIndexes;
      highlightColumns?: HighlightIndexes;
      note?: string;
    }
  | {
      kind: 'cards';
      span?: BlockSpan;
      /**
       * @minItems 1
       * @maxItems 4
       */
      items: {
        title: string;
        body: string;
        note?: string;
      }[];
      highlight?: HighlightIndexes;
    }
  | {
      kind: 'kpis';
      span?: BlockSpan;
      /**
       * @minItems 1
       * @maxItems 4
       */
      items: {
        label: string;
        value: string;
        note?: string;
      }[];
      highlight?: HighlightIndexes;
    }
  | {
      kind: 'list';
      span?: BlockSpan;
      heading?: string;
      /**
       * @minItems 1
       * @maxItems 6
       */
      items: string[];
      highlight?: HighlightIndexes;
    }
  | {
      kind: 'steps';
      span?: BlockSpan;
      /**
       * @minItems 2
       * @maxItems 6
       */
      items: {
        title: string;
        detail?: string;
      }[];
      highlight?: HighlightIndexes;
    };
/**
 * Width in a 12-column grid.
 */
export type BlockSpan = number;
/**
 * Exact substrings of the block text to emphasize.
 *
 * @maxItems 8
 */
export type EmphasisTerms = string[];
/**
 * Zero-based item indexes to emphasize; the other items are dimmed.
 *
 * @maxItems 8
 */
export type HighlightIndexes = number[];
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
  navigation?: Navigation;
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
  frame?: Frame;
}
export interface SubtitleStyle {
  fontSize?: number;
  maxLines?: 1 | 2;
  backgroundColor?: Color;
  color?: Color;
}
/**
 * Slide-deck frame: gradient background, white content card, footer with logo, footer text and page number, chapter chips and progress line at the bottom, and a cover layout for title/outro visuals. Colors come from palette (brand-neutral defaults).
 */
export interface Frame {
  style: 'deck';
  /**
   * Frame colors. Omitted keys fall back to neutral defaults.
   */
  palette?: {
    gradientStart?: Color;
    gradientEnd?: Color;
    primary?: Color;
    dark?: Color;
    light?: Color;
    text?: Color;
    marker?: Color;
  };
  footerLogoAssetId?: Identifier;
  coverLogoAssetId?: Identifier;
  coverMarkAssetId?: Identifier;
  footerText?: string;
  coverCaption?: string;
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
  /**
   * Zero-based item indexes to emphasize. Other items are dimmed. Consecutive scenes that differ only by highlight keep the layout on screen.
   *
   * @maxItems 5
   */
  highlight?: number[];
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
export interface TableVisual {
  type: 'table';
  title?: string;
  /**
   * @minItems 1
   * @maxItems 5
   */
  columns: string[];
  /**
   * @minItems 1
   * @maxItems 6
   */
  rows: {
    label: string;
    /**
     * @minItems 1
     * @maxItems 5
     */
    cells: string[];
  }[];
  /**
   * Zero-based row indexes to emphasize.
   *
   * @maxItems 6
   */
  highlightRows?: number[];
  /**
   * Zero-based column indexes to emphasize.
   *
   * @maxItems 5
   */
  highlightColumns?: number[];
  note?: string;
}
export interface StatementVisual {
  type: 'statement';
  label?: string;
  title?: string;
  text: string;
  /**
   * Exact substrings of text to emphasize with the accent color.
   *
   * @maxItems 6
   */
  emphasis?: string[];
}
/**
 * A composed slide page: tag + title header and up to six blocks in a 12-column grid. Consecutive scenes with the same slide keep the page on screen and only move emphasis.
 */
export interface SlideVisual {
  type: 'slide';
  tag?: string;
  title: string;
  /**
   * @minItems 1
   * @maxItems 6
   */
  blocks: SlideBlock[];
}
/**
 * Persistent chapter bar shown above every scene. Each group bundles one or more sections in order.
 */
export interface Navigation {
  /**
   * @minItems 2
   * @maxItems 6
   */
  groups: {
    title: string;
    /**
     * @minItems 1
     * @maxItems 100
     */
    sectionIds: Identifier[];
  }[];
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
