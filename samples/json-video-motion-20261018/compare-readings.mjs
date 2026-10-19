import {writeFile} from 'node:fs/promises';
const comparisons = [];
for (const text of ['JSONから動画へ。', 'ジェーソンから動画へ。']) {
  const query = new URLSearchParams({text, speaker: '2'});
  const response = await fetch(`http://voicevox:50021/audio_query?${query}`, {method: 'POST'});
  if (!response.ok) throw new Error(`VOICEVOX: ${response.status}`);
  const value = await response.json();
  comparisons.push({text, kana: value.kana, mora: value.accent_phrases.flatMap(p => p.moras.map(m => m.text))});
}
await writeFile('/workspace/logs/pronunciation-comparison.json', JSON.stringify(comparisons, null, 2));
console.log(JSON.stringify(comparisons));
