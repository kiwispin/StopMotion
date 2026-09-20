// Read-only source artifact; only a new, explicitly named diagnostic copy is written.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const [source,destination]=process.argv.slice(2);
if(!source||!destination||path.resolve(source)===path.resolve(destination))
  throw new Error('Provide different source and destination paths.');
const bytes=await readFile(source),patches=[];
function vint(offset,id=false){
  let width=1,mask=128;
  while(width<=8&&!(bytes[offset]&mask)){width++;mask>>=1;}
  if(width>8)throw new Error('Invalid VINT at '+offset);
  let value=id?bytes[offset]:bytes[offset]&(mask-1);
  for(let i=1;i<width;i++)value=value*256+bytes[offset+i];
  return {width,value};
}
function chunk(offset){
  const id=vint(offset,true),sizeAt=offset+id.width;
  let size=vint(sizeAt);
  if((id.value===0x18538067||id.value===0x1f43b675)&&bytes[sizeAt]===0x80){
    const value=bytes.readUInt32BE(sizeAt+1);
    if(value>=0x0fffffff){
      patches.push({id:id.value.toString(16),offset:sizeAt,old:128,replacement:8,length:value});
      bytes[sizeAt]=8;size={width:5,value};
    }
  }
  const start=sizeAt+size.width,end=start+size.value;
  if(end>bytes.length)throw new Error('Element exceeds artifact length.');
  return {id:id.value,start,end};
}
const ebml=chunk(0),segment=chunk(ebml.end);
if(segment.id!==0x18538067||segment.end!==bytes.length)throw new Error('Unexpected Segment boundary.');
for(let offset=segment.start;offset<segment.end;){const child=chunk(offset);offset=child.end;}
if(patches.length!==2)throw new Error('Expected only the Segment and Cluster length markers.');
await mkdir(path.dirname(destination),{recursive:true});
await writeFile(destination,bytes,{flag:'wx'});
const result=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_streams','-show_format','-of','json',destination],
  {encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true}));
const evidence={source,destination,bytes:bytes.length,patches,packets:result.packets.length,
  duration:result.format.duration,width:result.streams[0]?.width,height:result.streams[0]?.height};
await writeFile(destination+'.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
