import {readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root='/workspace/dialogue';
const output=`${root}/dist/voicevox-dialogue/b4906152b3dadc5c05d2885b00454ec7fe7aa9ff7b0fd955b9754f2d7fd60652`;
const lock=JSON.parse(await readFile(`${output}/project.lock.json`,'utf8'));
function pcm(file,rate=24000){const r=spawnSync('ffmpeg',['-v','error','-i',file,'-vn','-ac','1','-ar',String(rate),'-f','f32le','-'],{maxBuffer:1e8});if(r.status)throw Error(r.stderr.toString());return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset,r.stdout.byteOffset+r.stdout.byteLength));}
const rendered=pcm(`${output}/video.mp4`);
function correlation(x,y,offset,start,end,step=4){let xy=0,xx=0,yy=0;for(let i=start;i<end;i+=step){const a=x[i],b=y[offset+i]??0;xy+=a*b;xx+=a*a;yy+=b*b;}return xy/Math.sqrt(xx*yy);}
const results=[];
for(const scene of lock.scenes){const asset=lock.assets.find(a=>a.id===scene.resolvedAudioAssetId);const original=pcm(`${root}/${asset.resolvedPath}`);const offset=Math.round(scene.startFrame/lock.fps*24000);const windows=[];for(const [start,end] of [[240,original.length-240],[12000,24000],[Math.floor(original.length/2),Math.floor(original.length/2)+12000]]){let best={correlation:-1,lag:0};for(let lag=-24000;lag<=24000;lag+=12){const c=correlation(original,rendered,offset+lag,start,end,12);if(c>best.correlation)best={correlation:c,lag};}let fine={...best};for(let lag=best.lag-24;lag<=best.lag+24;lag++){const c=correlation(original,rendered,offset+lag,start,end,1);if(c>fine.correlation)fine={correlation:c,lag};}windows.push({start,end,...fine,lagMs:fine.lag/24});}
const fixedLagWindows=windows.map(w=>({start:w.start,end:w.end,correlation:correlation(original,rendered,offset+1024,w.start,w.end,1)}));
results.push({id:scene.id,offset,sourceSamples:original.length,windows,fixedLagWindows});}
const asset=lock.assets.find(a=>a.id===lock.scenes[0].resolvedAudioAssetId);
const control=`${root}/final-review/audio-control.m4a`;
const encode=spawnSync('ffmpeg',['-y','-v','error','-i',`${root}/${asset.resolvedPath}`,'-ar','48000','-ac','2','-c:a','aac',control]);
if(encode.status)throw Error(encode.stderr.toString());
const source=pcm(`${root}/${asset.resolvedPath}`), controlPcm=pcm(control);
results.push({control:'ffmpeg AAC encode/decode',zeroLagCorrelation:correlation(source,controlPcm,0,240,source.length-240,1)});
await writeFile(`${root}/final-review/audio-diagnostic.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
