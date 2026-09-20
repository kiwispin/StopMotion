// Bounded app-encoder / native browser / VLC comparison, separate from Playwright suite.
import {chromium} from '@playwright/test';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {variant, measureNative, ffmpegFrames, inspect} from './short-webm.mjs';

await mkdir('test-results',{recursive:true});
const root = await mkdtemp(path.resolve('test-results/vlc-app-'));
console.log(`Artifacts: ${root}`);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror',error => errors.push(error.message));
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Diagnostic has no camera','NotAllowedError'); };
});
const cases = [
  ...[7,12,24].flatMap(fps => [1,2,6,9].map(count => ({name:`n${count}-${fps}`,count,fps,width:640,height:480}))),
  {name:'twenty-one-7',count:21,fps:7,width:640,height:480},
  {name:'hd-holds-12',count:6,fps:12,width:1280,height:720,holds:[1,2,1,3,2,1]}
];
const results = [];
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4174');
  for (const config of cases.filter(item => !process.env.CASES || process.env.CASES.split(',').includes(item.name))) {
    const bytes = Buffer.from(await page.evaluate(async config => {
      const promises = [];
      for (let i=0;i<config.count;i++) {
        const canvas = document.createElement('canvas'); canvas.width=config.width; canvas.height=config.height;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle=`hsl(${i*137.5%360} 100% 50%)`; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='#fff'; ctx.font='bold 80px sans-serif'; ctx.fillText(String(i+1),20,110);
        const encoded = stopMedia.encodeFrame(canvas);
        for(let j=0;j<(config.holds?.[i] || 1);j++) promises.push(encoded);
      }
      const blob = await webm.encode(config.name,config.width,config.height,1000/config.fps,promises,null);
      return [...new Uint8Array(await blob.arrayBuffer())];
    },config));
    let baseline;
    for (const [suffix,data] of [['original',bytes],['subdivided',variant(bytes,{blockDuration:true,subdivisions:8})]]) {
      const file = path.join(root,`${config.name}-${suffix}.webm`);
      await writeFile(file,data);
      const check = await page.evaluate(async ({base64,config}) => {
        const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes],{type:'video/webm'}));
        const video=document.createElement('video'); video.muted=true;
        document.body.append(video);
        const canvas=document.createElement('canvas'); canvas.width=config.width; canvas.height=config.height;
        const ctx=canvas.getContext('2d');
        const timeout = (promise) => Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Native video timeout')),5000))]);
        try {
          const loaded=new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Native decode failed'));});
          video.src=url; await timeout(loaded);
          const duration=video.duration, frames=[];
          let exposures=0;
          for (let i=0;i<config.count;i++) {
            const hold=config.holds?.[i] || 1;
            const time=(exposures+hold/2)/config.fps; exposures+=hold;
            const seeked=new Promise(resolve=>video.onseeked=resolve); video.currentTime=time; await timeout(seeked);
            await timeout(new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            ctx.drawImage(video,0,0); frames.push([...ctx.getImageData(config.width-10,config.height-10,1,1).data].slice(0,3));
          }
          const seeked=new Promise(resolve=>video.onseeked=resolve); video.currentTime=duration-0.001; await timeout(seeked);
          await timeout(new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          ctx.drawImage(video,0,0); const tail=[...ctx.getImageData(config.width-10,config.height-10,1,1).data].slice(0,3);
          return {duration,frames,tail};
        } finally {video.remove();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
      },{base64:data.toString('base64'),config});
      // Previously measured original failures are retained; do not rerun each refused baseline.
      const native = suffix==='original' ? null : measureNative(file,null,{width:config.width,height:config.height});
      const result=native?.result;
      if(native) {
        await writeFile(file+'.vlc.log',native.log); await writeFile(file+'.native.json',JSON.stringify(result,null,2));
      }
      const row={name:config.name,suffix,bytes:data.length,browser:check,
        ffmpegHashes:ffmpegFrames(file),deadlock:result?.deadlock,
        displayTransitions:result?.displayed.filter((x,i,a)=>!i||x.hash!==a[i-1].hash),nativeState:result?.state};
      results.push(row);
      await writeFile(path.join(root,'summary.json'),JSON.stringify({errors,results},null,2));
      if(suffix==='original') baseline=row;
      else {
        assert.equal(row.browser.duration,baseline.browser.duration,'duration must remain exact');
        const decoded=spawnSync('ffmpeg',['-v','error','-i',path.join(root,`${config.name}-original.webm`),
          '-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','-'],{windowsHide:true,maxBuffer:128*1024*1024});
        assert.equal(decoded.status,0);
        const sourcePixels=[]; let exposure=0;
        for(let i=0;i<config.count;i++) {
          const offset=exposure*config.width*config.height*3+((config.height-10)*config.width+config.width-10)*3;
          sourcePixels.push([...decoded.stdout.subarray(offset,offset+3)]);
          exposure+=config.holds?.[i] || 1;
        }
        const close=(a,b)=>a.every((channel,i)=>Math.abs(channel-b[i])<=4);
        row.sourcePixels=sourcePixels;
        await writeFile(path.join(root,'summary.json'),JSON.stringify({errors,results},null,2));
        if(config.height>=720) {
          // Existing Chromium/FFmpeg HD colour interpretation differs. Compare the
          // same browser's old/new output exactly; decoded packet hashes below
          // independently require the original pixels, not a relaxed RGB tolerance.
          assert.deepEqual(row.browser,baseline.browser,'HD browser poses/tail must remain identical to original export');
        } else {
          assert(row.browser.frames.every((rgb,i)=>close(rgb,sourcePixels[i])),'browser must show the actual encoded source at each pose');
          assert(close(row.browser.tail,sourcePixels.at(-1)),'browser tail must remain final source image');
        }
        assert.deepEqual(row.ffmpegHashes,[...baseline.ffmpegHashes,...Array(7).fill(baseline.ffmpegHashes.at(-1))],
          'only seven identical final-image packets may be added');
        assert.deepEqual(inspect(data).packets.slice(0,inspect(bytes).packets.length).map(p=>p.time),
          inspect(bytes).packets.map(p=>p.time),'all original exposure onsets remain identical');
        assert.equal(row.deadlock,false,'default VLC must not deadlock');
        assert.equal(row.displayTransitions.length,config.count,'VLC must render every distinct pose');
        assert(row.displayTransitions.every((picture,i)=>close(picture.rgb,sourcePixels[i])),
          'VLC actual display pixels must match source poses in order');
        assert.equal(row.nativeState,6,'VLC must finish naturally');
      }
      console.log(JSON.stringify({name:row.name,suffix,deadlock:row.deadlock,displayTransitions:row.displayTransitions?.length,
        expected:config.count,ffmpegFrames:row.ffmpegHashes.length,browserDuration:check.duration,tail:check.tail}));
      await writeFile(path.join(root,'summary.json'),JSON.stringify({errors,results},null,2));
    }
  }
} finally {await browser.close();}
if(errors.length) throw new Error(errors.join('\n'));
