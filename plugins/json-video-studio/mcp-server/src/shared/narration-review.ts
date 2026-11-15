import type {ProjectLock} from './video-types.js';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Bind the pronunciation review to the exact synthesis inputs and audio, not just the project title. */
export function hasPassingNarrationReview(value: unknown, projectId: string, lock: ProjectLock): boolean {
  if (!record(value) || value.projectId !== projectId || value.lockHash !== lock.lockHash || value.status !== 'pass') return false;
  if (!['engine-kana', 'listening-and-engine-kana', 'listening'].includes(String(value.method))) return false;
  if (value.listeningPerformed !== (value.method !== 'engine-kana')) return false;
  if (!Array.isArray(value.unresolvedReadings) || value.unresolvedReadings.length !== 0) return false;
  if (!Array.isArray(value.evidence)) return false;
  const voices = lock.assets.filter(asset => asset.voice);
  if (value.evidence.length !== voices.length) return false;
  return voices.every(asset => {
    const matches = (value.evidence as unknown[]).filter(item => record(item) && item.assetId === asset.id);
    const item = matches[0];
    const common = matches.length === 1 && record(item)
      && item.readingsConfirmed === true
      && item.coverage === 'full-utterance'
      && item.sha256 === asset.sha256
      && typeof asset.voice?.synthesisText === 'string' && asset.voice.synthesisText.length > 0
      && item.synthesisText === asset.voice.synthesisText;
    if (!common || !record(item)) return false;
    if (asset.voice?.provider === 'kokoro') {
      return value.listeningPerformed === true && value.method !== 'engine-kana'
        && item.provider === 'kokoro' && item.voiceId === asset.voice.voiceId
        && item.language === asset.voice.language && !('kana' in item);
    }
    return value.method !== 'listening' && typeof asset.voice?.kana === 'string' && asset.voice.kana.length > 0
      && item.kana === asset.voice.kana;
  });
}
