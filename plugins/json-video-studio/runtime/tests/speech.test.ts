import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {resolveSpeechText, pronunciationWarnings} from '../src/core/speech.js';
import {validateProject} from '../src/core/schema.js';
import {VoicevoxClient} from '../src/core/voicevox.js';
import type {VideoProject} from '../src/shared/video-types.js';
const schemaPath = resolve(import.meta.dirname, '../../schemas/video-project.schema.json');
const fixture = async (): Promise<VideoProject> => JSON.parse(await readFile(resolve(import.meta.dirname, '../../examples/dialogue.video-project.json'), 'utf8'));
const roots: string[] = [];
afterEach(async () => {vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true, force:true})));});

describe('speech authoring', () => {
  it('supports names, place names, and context-dependent numerals beyond English acronyms', () => {
    const dictionary = [{term: '東海林', reading: 'しょうじ'}, {term: '日本橋', reading: 'にほんばし'}];
    expect(resolveSpeechText({text: '東海林さんと日本橋へ。'}, dictionary)).toBe('しょうじさんとにほんばしへ。');
    expect(resolveSpeechText({text: '日本橋へ。', speechText: 'にっぽんばしへ。'}, dictionary)).toBe('にっぽんばしへ。');
    expect(resolveSpeechText({text: '1日に出発する。', speechText: 'ついたちにしゅっぱつする。'})).toBe('ついたちにしゅっぱつする。');
    expect(resolveSpeechText({text: '1日で仕上げる。', speechText: 'いちにちでしあげる。'})).toBe('いちにちでしあげる。');
  });
  it('uses literal longest matches with ASCII boundaries, without recursive replacements', () => {
    const dictionary = [{term:'JSON', reading:'ジェーソン'}, {term:'JSON Schema', reading:'スキーマ'}, {term:'ジェーソン', reading:'別の読み'}];
    expect(resolveSpeechText({text:'JSONとJSON Schema、MYJSON JSON5 JSON_key json'},dictionary)).toBe('ジェーソンとスキーマ、MYJSON JSON5 JSON_key json');
    expect(resolveSpeechText({text:'JSON',speechText:'明示した読み'},dictionary)).toBe('明示した読み');
    expect(resolveSpeechText({text:'C++と(C++)'},[{term:'C++',reading:'シープラスプラス'}])).toBe('シープラスプラスと(シープラスプラス)');
  });
  it('warns on unconfigured uppercase acronyms only in synthesized speech', async () => {
    const project=await fixture();
    expect(pronunciationWarnings(project).some(w=>w.includes('JSON'))).toBe(true);
    project.pronunciations=[{term:'JSON',reading:'ジェーソン'}];
    expect(pronunciationWarnings(project).some(w=>w.includes('「JSON」'))).toBe(false);
    for(const section of project.sections) for(const scene of section.scenes) scene.speechText='明示した読み';
    expect(pronunciationWarnings(project)).toEqual([]);
  });
  it('validates flow bounds and rejects duplicate dictionary terms and unknown fields', async () => {
    const project=await fixture();
    const visual={type:'flow' as const,steps:[{title:'入力'},{title:'出力'}],activeStep:1};
    project.sections[0]!.scenes[0]!.visual=visual;
    await expect(validateProject(project,{schemaPath})).resolves.toBe(project);
    visual.activeStep=2;
    await expect(validateProject(project,{schemaPath})).rejects.toMatchObject({code:'FLOW_ACTIVE_STEP_INVALID'});
    visual.activeStep=1;
    project.pronunciations=[{term:'JSON',reading:'ジェーソン'},{term:'JSON',reading:'ジェイソン'}];
    await expect(validateProject(project,{schemaPath})).rejects.toMatchObject({code:'DUPLICATE_PRONUNCIATION'});
    delete project.pronunciations;
    Object.assign(visual.steps[0]!,{unknown:true});
    await expect(validateProject(project,{schemaPath})).rejects.toMatchObject({code:'SCHEMA_VALIDATION_FAILED'});
  });
  it('records actual query kana and input, regenerates legacy cache metadata, and keys on spoken text', async () => {
    const root=await mkdtemp(resolve(tmpdir(),'json-video-speech-'));roots.push(root);
    const project=await fixture(), speaker=project.speakers[0]!;
    const wav=Buffer.alloc(44+4800);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4800,40);
    let queries=0;
    vi.stubGlobal('fetch',vi.fn(async (input:string|URL|Request,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith('/version'))return Response.json('test');
      if(url.endsWith('/speakers'))return Response.json([{speaker_uuid:speaker.voice!.speakerUuid,name:'話者',styles:[{id:speaker.voice!.styleId,name:'通常'}]}]);
      if(url.includes('/audio_query?')){queries++;expect(new URL(url).searchParams.get('text')).toBe('ジェーソン');return Response.json({kana:"ジェ'ーソン"});}
      expect(JSON.parse(String(init?.body)).kana).toBe("ジェ'ーソン");
      return new Response(wav);
    }));
    const client=new VoicevoxClient({cacheRoot:root,workspaceRoot:root});
    const first=await client.synthesize('ジェーソン',speaker);
    expect(first).toMatchObject({synthesisText:'ジェーソン',kana:"ジェ'ーソン",cacheHit:false});
    expect((await client.plan('JSON',speaker)).cacheKey).not.toBe(first.cacheKey);
    expect(await client.synthesize('ジェーソン',speaker)).toMatchObject({kana:"ジェ'ーソン",cacheHit:true});
    const metadataPath=resolve(root,`${first.cacheKey}.json`);
    const metadata=JSON.parse(await readFile(metadataPath,'utf8'));
    delete metadata.synthesisText;delete metadata.kana;
    await writeFile(metadataPath,JSON.stringify(metadata));
    expect((await client.plan('ジェーソン',speaker)).cacheHit).toBe(false);
    expect((await client.synthesize('ジェーソン',speaker)).cacheHit).toBe(false);
    expect(queries).toBe(2);
    expect(JSON.parse(await readFile(metadataPath,'utf8'))).toMatchObject({synthesisText:'ジェーソン',kana:"ジェ'ーソン"});
  });
});
