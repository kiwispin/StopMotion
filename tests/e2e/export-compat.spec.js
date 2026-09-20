import {test, expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('short export preserves exposure timing, own import and final-frame copies', async ({page}, testInfo) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('No camera needed','NotAllowedError');};
    window.unhandled=[]; addEventListener('unhandledrejection',e=>unhandled.push(String(e.reason)));
  });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    function packets(buffer, track) {
      const segment=new webm.Cursor(new Uint8Array(buffer)).findChunk('Segment');
      const cursor=segment.cursor, rows=[]; let cluster;
      while(cluster=cursor.findChunk('Cluster')) {
        const base=Number(webm.decodeUint(cluster.cursor.findChunk('Timecode').cursor));
        const blocks=cluster.cursor; let block;
        while(block=blocks.findChunk()) {
          let duration=null, attributes=[];
          if(block.type==='BlockGroup') {
            const d=block.cursor.findChunk('BlockDuration');
            duration=d ? Number(webm.decodeUint(d.cursor)) : null;
            const children=block.cursor; let child;
            while(child=children.findChunk()) if(child.type!=='Block')
              attributes.push({type:child.type,bytes:[...child.data.subarray(child.idx,child.idx+child.length)]});
            block=block.cursor.findChunk('Block');
          } else if(block.type!=='SimpleBlock') continue;
          const c=block.cursor, number=webm.decodeLength(c);
          if(number!==track) continue;
          const time=base+webm.decodeInt(new webm.Cursor(c.data,c.idx,c.idx+2));
          c.idx+=3;
          rows.push({time,duration,attributes,bytes:[...c.data.subarray(c.idx,c.max)]});
        }
      }
      return rows;
    }
    const cases=[];
    for(const count of [1,6]) {
      const frames=Array.from({length:count},(_,i)=>{
        const c=document.createElement('canvas');c.width=640;c.height=480;
        const ctx=c.getContext('2d');ctx.fillStyle=`hsl(${i*60} 100% 50%)`;ctx.fillRect(0,0,640,480);
        return stopMedia.encodeFrame(c);
      });
      const blob=await webm.encode('compat',640,480,1000/7,frames,null);
      const buffer=await blob.arrayBuffer(), video=packets(buffer,1);
      let imported=0,rate=0;
      webm.decode(buffer,null,r=>rate=r,()=>imported++);
      const player=document.createElement('video');player.muted=true;document.body.append(player);
      const url=URL.createObjectURL(blob);
      await new Promise((resolve,reject)=>{player.onloadedmetadata=resolve;player.onerror=reject;player.src=url;});
      const duration=player.duration;player.remove();player.src='';URL.revokeObjectURL(url);
      // Marker corruption must fail before returning any editing frames.
      const altered=new Uint8Array(buffer.slice(0));
      const marker=new TextEncoder().encode(`StopMotionCompat/1:[${count},`);
      let at=-1; for(let i=0;i<altered.length-marker.length;i++) {
        if(marker.every((v,j)=>altered[i+j]===v)){at=i;break;}
      }
      if(at<0) throw new Error('Missing compatibility marker');
      altered[at+'StopMotionCompat/1:['.length]=0x39;
      let rejected=false, callbacks=0;
      try{webm.decode(altered.buffer,null,null,()=>callbacks++);}catch{rejected=true;}
      cases.push({count,imported,rate,duration,times:video.map(p=>p.time),durations:video.map(p=>p.duration),
        copiesMatch:video.slice(count).every(p=>JSON.stringify(p.bytes)===JSON.stringify(video[count-1].bytes)),
        rejected,callbacks,bytes:[...new Uint8Array(buffer)]});
    }
    return {cases,unhandled};
  });
  expect(errors).toEqual([]); expect(result.unhandled).toEqual([]);
  for(const row of result.cases) {
    expect(row.imported).toBe(row.count); expect(row.rate).toBeCloseTo(7,8);
    expect(row.duration).toBeCloseTo(row.count/7,5);
    expect(row.times).toHaveLength(row.count+7);
    expect(row.times.slice(0,row.count)).toEqual(Array.from({length:row.count},(_,i)=>Math.round(i*1000/7)));
    expect(row.times.at(-1)+row.durations.at(-1)).toBe(Math.round(row.count*1000/7));
    expect(row.times.every((t,i)=>!i || t>row.times[i-1])).toBe(true);
    expect(row.copiesMatch,'final image copies').toBe(true);
    expect(row.rejected,'invalid compatibility marker').toBe(true);
    expect(row.callbacks).toBe(0);
    await writeFile(testInfo.outputPath(`compat-${row.count}.webm`),Buffer.from(row.bytes));
  }
});
