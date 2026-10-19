import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
const [name, output] = process.argv.slice(2);
const root = `/workspace/${name}`;
const directory = `/workspace/${output}`;
const video = `${directory}/video.mp4`;
const lock = JSON.parse(await readFile(`${directory}/project.lock.json`, 'utf8'));
const evidence = `${root}/final-review`;
await mkdir(evidence, {recursive: true});
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {maxBuffer: 100 * 1024 * 1024});
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}
function pcm(file) {
  const bytes = ffmpeg(['-i', file, '-vn', '-ac', '1', '-ar', '24000', '-f', 'f32le', '-']);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
ffmpeg(['-i', video, '-f', 'null', '-']);
const rendered = pcm(video);
let peak = 0, clipped = 0;
for (const sample of rendered) {peak = Math.max(peak, Math.abs(sample)); if (Math.abs(sample) >= 0.999) clipped++;}
const scenes = [];
for (const [index, scene] of lock.scenes.entries()) {
  const source = lock.assets.find(a => a.id === scene.resolvedAudioAssetId);
  let audio;
  if (source) {
    const original = pcm(path.join(root, source.resolvedPath));
    const offset = Math.round(scene.startFrame / lock.fps * 24000);
    let best = {correlation: -1, offsetSamples: 0};
    // Allow up to two video frames, including the measured AAC encoder delay.
    const toleranceSamples = Math.ceil(2 / lock.fps * 24000);
    for (let lag = -toleranceSamples; lag <= toleranceSamples; lag += 4) {
      let dot = 0, xx = 0, yy = 0;
      for (let i = 240; i < original.length - 240; i += 4) {
        const x = original[i], y = rendered[offset + i + lag] ?? 0;
        dot += x * y; xx += x * x; yy += y * y;
      }
      const correlation = dot / Math.sqrt(xx * yy);
      if (correlation > best.correlation) best = {correlation, offsetSamples: lag};
    }
    audio = {...best, offsetMs: best.offsetSamples / 24, sourceDurationSeconds: original.length / 24000};
  }
  const stem = `${String(index + 1).padStart(2, '0')}-${scene.id}`;
  const midpoint = scene.startFrame + Math.floor(scene.durationInFrames / 2);
  if (!existsSync(`${evidence}/${stem}.png`)) ffmpeg(['-ss', String(midpoint / lock.fps), '-i', video, '-frames:v', '1', `${evidence}/${stem}.png`]);
  const offsets = [...new Set([0, 4, 12, 30, scene.durationInFrames - 4].map(n => Math.min(scene.durationInFrames - 1, Math.max(0, n))))];
  const selection = offsets.map(n => `eq(n\\,${scene.startFrame + n})`).join('+');
  if (!existsSync(`${evidence}/${stem}-motion.png`)) ffmpeg(['-i', video, '-vf', `select=${selection},scale=480:270,tile=${offsets.length}x1`, '-frames:v', '1', `${evidence}/${stem}-motion.png`]);
  scenes.push({id: scene.id, startSeconds: scene.startFrame / lock.fps, durationSeconds: scene.durationInFrames / lock.fps, midpointFrame: midpoint, motionOffsets: offsets, audio});
}
if (!existsSync(`${evidence}/thumbnail-small.png`)) ffmpeg(['-i', `${directory}/thumbnail.png`, '-vf', 'scale=320:180', '-frames:v', '1', `${evidence}/thumbnail-small.png`]);
const report = {lockHash: lock.lockHash, decodeAllFrames: true, peak, clippedSampleFraction: clipped / rendered.length, audioSourceComparison: '24kHz mono PCM; cross-correlation within +/-2 video frames of locked scene start', maxAllowedOffsetMs: 2000 / lock.fps, limitation: 'Objective waveform/timing checks; pronunciation and subjective listening are not assessed.', scenes, passed: clipped / rendered.length < 0.001 && scenes.every(s => s.audio && s.audio.correlation > 0.97 && Math.abs(s.audio.offsetMs) <= 2000 / lock.fps)};
await writeFile(`${evidence}/media-check-v2.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
