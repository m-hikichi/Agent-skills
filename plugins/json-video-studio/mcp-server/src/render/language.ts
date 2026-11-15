import type {CSSProperties} from 'react';
import type {VideoProject} from '../shared/video-types.js';

/** Inherited by all visuals, including helpers without a project prop. */
export const languageStyles = (language: VideoProject['meta']['language']): CSSProperties => ({
  '--video-word-break': language === 'ja-JP' ? 'auto-phrase' : 'normal',
  '--video-line-break': language === 'ja-JP' ? 'strict' : 'auto',
} as CSSProperties);
