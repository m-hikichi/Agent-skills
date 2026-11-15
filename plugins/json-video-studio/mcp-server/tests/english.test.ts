import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {validateProject} from '../src/core/schema.js';
import {splitSubtitle, textUnits} from '../src/render/layout.js';
import {languageStyles} from '../src/render/language.js';
import type {VideoProject} from '../src/shared/video-types.js';

const pluginRoot = resolve(import.meta.dirname, '../..');
const schemaPath = resolve(pluginRoot, 'schemas/video-project.schema.json');
const project = async (): Promise<VideoProject> => JSON.parse(await readFile(resolve(pluginRoot, 'examples/english.video-project.json'), 'utf8'));

describe('experimental English projects', () => {
  it.each(['en-US', 'en-GB'] as const)('accepts %s silent scenes and supplied narration', async (language) => {
    const value = await project();
    value.meta.language = language;
    await expect(validateProject(value, {schemaPath})).resolves.toBeTruthy();
    value.assets = [{id: 'narration', type: 'audio', path: 'narration.wav', rights: {status: 'owned'}}];
    value.sections[0]!.scenes[0]!.text = 'Welcome to the English video.';
    value.sections[0]!.scenes[0]!.audioAssetId = 'narration';
    delete value.sections[0]!.scenes[0]!.durationMs;
    await expect(validateProject(value, {schemaPath})).resolves.toBeTruthy();
  });

  it('requires a configured voice or supplied audio for English narration', async () => {
    const value = await project();
    value.sections[0]!.scenes[0]!.text = 'Speak English.';
    await expect(validateProject(value, {schemaPath})).rejects.toMatchObject({code: 'VOICE_REQUIRED'});
  });

  it.each(['en-US', 'en-GB'] as const)('accepts matching Kokoro narration for %s', async language => {
    const value = await project();
    value.meta.language = language;
    value.speakers = [{id: 'narrator', displayName: 'Narrator', voice: {provider: 'kokoro', voiceId: language === 'en-US' ? 'af_heart' : 'bf_emma', language}}];
    const scene = value.sections[0]!.scenes[0]!;
    scene.speakerId = 'narrator';
    scene.text = 'Speak English.';
    delete scene.durationMs;
    await expect(validateProject(value, {schemaPath})).resolves.toBeTruthy();
    value.meta.language = 'ja-JP';
    await expect(validateProject(value, {schemaPath})).rejects.toMatchObject({code: 'VOICE_LANGUAGE_MISMATCH'});
    value.meta.language = language;
    value.speakers[0]!.voice = {provider: 'kokoro', voiceId: language === 'en-US' ? 'bf_emma' : 'af_heart', language};
    await expect(validateProject(value, {schemaPath})).rejects.toMatchObject({code: 'VOICE_LANGUAGE_MISMATCH'});
  });

  it('rejects VOICEVOX for generated English narration', async () => {
    const value = JSON.parse(await readFile(resolve(pluginRoot, 'examples/dialogue.video-project.json'), 'utf8'));
    value.meta.language = 'en-US';
    await expect(validateProject(value, {schemaPath})).rejects.toMatchObject({code: 'VOICE_LANGUAGE_MISMATCH'});
  });

  it('rejects unsupported language tags', async () => {
    const value = await project();
    await expect(validateProject({...value, meta: {...value.meta, language: 'fr-FR'}}, {schemaPath})).rejects.toMatchObject({code: 'SCHEMA_VALIDATION_FAILED'});
  });

  it('splits English sentences and long clauses without losing spaces, punctuation or words', () => {
    const text = 'The result is 3.14 units. Next, we explain how the data moves from the client through the server and back to the user.';
    const cues = splitSubtitle(text, 18, 2, 'en-US');
    expect(cues.length).toBeGreaterThan(2);
    expect(cues[0]).toBe('The result is 3.14 units.');
    expect(cues.join(' ')).toBe(text);
    expect(cues.every(cue => textUnits(cue) <= 36)).toBe(true);
  });

  it('retains every word across many cues and flags long words through existing lint limits', () => {
    const text = Array.from({length: 20}, (_, index) => `Sentence ${index}.`).join(' ');
    expect(splitSubtitle(text, 6, 2, 'en-GB').join(' ')).toBe(text);
    expect(splitSubtitle('Supercalifragilisticexpialidocious', 5, 1, 'en-US')).toEqual(['Supercalifragilisticexpialidocious']);
    expect(splitSubtitle('First line\nSecond line', 5, 2, 'en-US')).toEqual(['First line\nSecond line']);
  });

  it('preserves Japanese segmentation and selects language-specific wrapping', () => {
    expect(splitSubtitle('最初の文です。次の文です。', 8, 2)).toEqual(['最初の文です。', '次の文です。']);
    expect(languageStyles('ja-JP')).toMatchObject({'--video-word-break': 'auto-phrase', '--video-line-break': 'strict'});
    expect(languageStyles('en-US')).toMatchObject({'--video-word-break': 'normal', '--video-line-break': 'auto'});
  });
});
