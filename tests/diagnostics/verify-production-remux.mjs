// Focused container verification: reuse encoded VP8, never encode PNG/WebP pixels.
import {readFile,writeFile,open,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const [input,backup,outdir]=process.argv.slice(2);
if(!input||!backup||!outdir)throw new Error('Expected input WebM, binary backup and new output directory.');
await mkdir(outdir,{recursive:true});
const output=path.join(outdir,'production-remux.webm');
assert.notEqual(path.resolve(input),path.resolve(output));
const context={console,Blob,Uint8Array,ArrayBuffer,DataView};
context.window=context;vm.createContext(context);
for(const file of ['js/media.js','js/webm.js'])
  vm.runInContext(await readFile(file,'utf8'),context,{filename:file});
context.stopMedia.encodeFrame=()=>{throw new Error('Image encoding is forbidden in this verification.');};
const bytes=await readFile(input),frames=[];
let dimensions,fps;
const started=performance.now();
context.webm.decode(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
  (w,h)=>{dimensions=[w,h]},value=>{fps=value},blob=>frames.push(blob));
assert.equal(frames.length,700);assert.deepEqual(dimensions,[1280,720]);assert.equal(fps,24);
const generated=await context.webm.encode('Production muxer verification',1280,720,1000/24,
  frames.map(blob=>Promise.resolve(blob)),null);
await writeFile(output,new Uint8Array(await generated.arrayBuffer()),{flag:'wx'});
const remuxMs=performance.now()-started;
assert.ok(generated.size>268435455);
const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0',
  '-show_packets','-show_data_hash','sha256','-show_entries','packet=pts_time,duration_time,data_hash',
  '-show_streams','-show_format','-of','json',file],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true}));
const original=probe(input),result=probe(output);
assert.equal(result.packets.length,707);
assert.deepEqual(result.packets.map(p=>p.data_hash),original.packets.map(p=>p.data_hash));
assert.deepEqual(result.packets.map(p=>p.pts_time),original.packets.map(p=>p.pts_time));
assert.deepEqual(result.packets.map(p=>p.duration_time),original.packets.map(p=>p.duration_time));
assert.deepEqual([result.streams[0].width,result.streams[0].height],[1280,720]);
assert.ok(Math.abs(Number(result.format.duration)-700/24)<.001);
const maxTimestampErrorMs=Math.max(...result.packets.slice(0,700).map((p,i)=>Math.abs(Number(p.pts_time)*1000-i*1000/24)));
assert.ok(maxTimestampErrorMs<=1);
// Read only the bounded v2 metadata and final PNG, not the entire 1.07GB backup.
const file=await open(backup,'r');let last;
try {
  const header=Buffer.alloc(12);await file.read(header,0,12,0);
  assert.equal(header.subarray(0,8).toString(),'STOPMOT2');
  const length=header.readUInt32LE(8);assert.ok(length>0&&length<=1024*1024);
  const json=Buffer.alloc(length);await file.read(json,0,length,12);
  const metadata=JSON.parse(json.toString());assert.equal(metadata.frames.length,700);
  let offset=12+length;
  for(const entry of metadata.frames.slice(0,-1))offset+=entry.size;
  last=Buffer.alloc(metadata.frames.at(-1).size);await file.read(last,0,last.length,offset);
}finally{await file.close();}
const lastPNG=path.join(outdir,'last-original.png');await writeFile(lastPNG,last,{flag:'wx'});
const rgb=(source,seek=[])=>execFileSync('ffmpeg',['-v','error',...seek,'-i',source,'-frames:v','1',
  '-vf','crop=2:2:970:370','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
const originalRGB=rgb(lastPNG),tailRGB=rgb(output,['-ss',String(700/24-.02)]);
assert.equal(originalRGB.length,12);assert.equal(tailRGB.length,12);
const maxRGBError=Math.max(...tailRGB.map((value,i)=>Math.abs(value-originalRGB[i])));
assert.ok(maxRGBError<=8,'Native tail pixels differ from original PNG by '+maxRGBError);
const evidence={input,backup,output,verification:'fresh production container using existing VP8; no image re-encode',
  decodedExposures:frames.length,packets:result.packets.length,packetHashesEqual:true,packetTimesEqual:true,
  dimensions,duration:result.format.duration,bytes:generated.size,remuxMs,maxTimestampErrorMs,
  originalTailRGB:[...originalRGB.subarray(0,3)],nativeTailRGB:[...tailRGB.subarray(0,3)],maxRGBError,
  freshPNGExport:'Previous 180s timeout; not verified to completion and not proof of encoder failure.'};
await writeFile(path.join(outdir,'RESULT.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
