import {BUNDLED_FONT_FAMILY, type ProjectLock} from '../shared/video-types.js';
import {toolVersion} from './media.js';

export async function collectRuntimeVersions(voicevox?: string): Promise<ProjectLock['runtime']> {
  const chromeCommand = process.env.CHROME_BIN ?? process.env.REMOTION_BROWSER_EXECUTABLE ?? 'chromium';
  const [ffmpeg, chrome, font] = await Promise.all([
    toolVersion(process.env.FFMPEG_PATH ?? 'ffmpeg'),
    toolVersion(chromeCommand, ['--version']),
    toolVersion('fc-match', ['--format=%{family} %{version}\n', BUNDLED_FONT_FAMILY]),
  ]);
  return {
    node: process.version,
    remotion: process.env.REMOTION_VERSION ?? '4.0.503',
    ffmpeg,
    chrome,
    font,
    ...(voicevox === undefined ? {} : {voicevox}),
  };
}

export function assertRuntimeMatchesLock(
  actual: ProjectLock['runtime'],
  locked: ProjectLock['runtime'],
): string[] {
  const keys = ['node', 'remotion', 'ffmpeg', 'chrome', 'font'] as const;
  return keys.flatMap((key) => actual[key] === locked[key] ? [] : [`${key}: lock=${locked[key]} current=${actual[key]}`]);
}
