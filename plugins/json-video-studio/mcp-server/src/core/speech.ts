import type {Scene, VideoProject} from '../shared/video-types.js';

const asciiWord = (character: string): boolean => /[A-Za-z0-9_]/u.test(character);

/** Single-pass, case-sensitive replacement; inserted readings are never replaced again. */
export const resolveSpeechText = (scene: Pick<Scene, 'text' | 'speechText'>, pronunciations: VideoProject['pronunciations'] = []): string => {
  if (scene.speechText !== undefined) return scene.speechText;
  const text = scene.text ?? '';
  const terms = [...pronunciations].sort((a, b) => b.term.length - a.term.length);
  let result = '';
  for (let index = 0; index < text.length;) {
    const match = terms.find(({term}) => text.startsWith(term, index)
      && !(asciiWord(term[0]!) && asciiWord(text[index - 1] ?? ''))
      && !(asciiWord(term.at(-1)!) && asciiWord(text[index + term.length] ?? '')));
    if (match) { result += match.reading; index += match.term.length; }
    else { result += text[index]; index += 1; }
  }
  return result;
};

/** Advisory only: standalone uppercase ASCII acronyms in generated speech need listening review. */
export const pronunciationWarnings = (project: VideoProject): string[] => project.sections.flatMap(section => section.scenes.flatMap(scene => {
  if (scene.audioAssetId || !scene.speakerId || !project.speakers.some(s => s.id === scene.speakerId && s.voice)) return [];
  // Explicit speechText is the author's deliberate reading instruction.
  if (scene.speechText !== undefined) return [];
  const text = resolveSpeechText(scene, project.pronunciations);
  const terms = [...new Set([...text.matchAll(/(?<![A-Za-z0-9_])[A-Z]{2,12}(?![A-Za-z0-9_])/gu)].map(match => match[0]))];
  return terms.map(term => `読み確認が必要です: scene ${scene.id} の「${term}」。pronunciations または speechText で指定し、生成音声を確認してください。`);
}));
