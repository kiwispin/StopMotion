import {test as base, expect} from './fixtures.js';
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, stat} from 'node:fs/promises';
import path from 'node:path';

const persistent=process.env.STOPMOTION_PERSISTENT==='1';
const test=persistent ? base.extend({context:async ({},use,testInfo)=>{
  const context=await chromium.launchPersistentContext(testInfo.outputPath('browser-profile'),
    {headless:true,baseURL:'http://127.0.0.1:4173',permissions:['camera']});
  try {await use(context);} finally {await context.close();}
}}) : base;

test.beforeEach(async ({page}) => {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', message => { if (message.text().startsWith('LARGE ')) console.log(message.text()); });
  await page.addInitScript(() => {
    // Use our deterministic real canvas stream, not host fake-camera startup.
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture camera', 'NotFoundError'); };
    navigator.mediaDevices.enumerateDevices = async () => [];
    window.unhandled = [];
    addEventListener('unhandledrejection', event => unhandled.push(String(event.reason)));
  });
  await page.goto('/'); await page.evaluate(() => main.project.ready);
});
test.afterEach(async ({page}) => {
  expect(page.errors).toEqual([]);
  expect(await page.evaluate(() => unhandled)).toEqual([]);
});

async function camera(page, width = 1280, height = 720) {
  await page.evaluate(async ({width, height}) => {
    const an = main.animator;
    an.detachStream(); an.clear();
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    window.source = source;
    const ctx = source.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0,0,width,height);
    const stream = source.captureStream(30);
    an.video.srcObject = stream; an.videoStream = stream; an.streamOn = true;
    await an.video.play(); an.syncCameraDimensions(false);
  }, {width, height});
}

test('700 distinct textured 720p captures recover in order and export with bounded decoded cache', async ({page}, testInfo) => {
  test.skip(!persistent, 'Run with STOPMOTION_PERSISTENT=1; private storage cannot retain this fixture.');
  // Work scales with 700 real PNG captures + 700 VP8 encodes, not a startup retry.
  test.setTimeout(300000);
  const naturalQuota=await page.evaluate(()=>navigator.storage.estimate());
  await camera(page);
  const captured = await page.evaluate(async () => {
    const started = performance.now();
    const an = main.animator, ctx = source.getContext('2d');
    const texture = document.createElement('canvas'); texture.width = 160; texture.height = 90;
    const t = texture.getContext('2d'), pixels = t.createImageData(160,90);
    let seed = 12345;
    for (let i=0;i<pixels.data.length;i+=4) {
      seed = (Math.imul(seed,1664525)+1013904223)>>>0;
      pixels.data[i]=80+(seed>>>27); pixels.data[i+1]=110+(seed>>>27);
      pixels.data[i+2]=130+(seed>>>27); pixels.data[i+3]=255;
    }
    t.putImageData(pixels,0,0);
    const pattern = ctx.createPattern(texture,'repeat');
    const hashes = [];
    for (let i=0;i<700;i++) {
      ctx.fillStyle=pattern; ctx.fillRect(0,0,1280,720);
      const gradient=ctx.createLinearGradient(0,0,1280,720);
      gradient.addColorStop(0,'rgba(255,70,30,.25)'); gradient.addColorStop(1,'rgba(0,40,255,.35)');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,1280,720);
      ctx.fillStyle=`hsl(${i*137.5%360} 90% 55%)`;
      ctx.fillRect((i*17)%1100,(i*13)%550,180,170);
      ctx.fillStyle='#fff';ctx.font='36px sans-serif';ctx.fillText(`Scene ${i.toString().padStart(3,'0')}`,30,65);
      await new Promise(resolve => { an.video.requestVideoFrameCallback(resolve); an.videoStream.getVideoTracks()[0].requestFrame(); });
      const frame = await an.capture();
      if (!frame) throw new Error('Capture refused at '+i+': '+document.getElementById('timelineMessage').textContent);
      hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',await frame.png.arrayBuffer()))].join(','));
      if ((i+1)%100===0) console.log('LARGE captured '+(i+1));
    }
    texture.width=texture.height=0;
    an.setPlaybackSpeed(24); await main.project.flushed();
    return {hashes, captureMs:performance.now()-started, bytes:stopFrames.bytes(an.frames), size:[an.w,an.h],
      canvasFrames:an.frames.filter(f=>f instanceof HTMLCanvasElement).length,
      cache:stopFrames.stats(), queue:main.project.queueState(), webp:stopMedia.cacheStats().calls};
  });
  expect(captured.size).toEqual([1280,720]); expect(captured.canvasFrames).toBe(0);
  expect(new Set(captured.hashes).size).toBe(700); expect(captured.webp).toBe(0);
  expect(captured.bytes).toBeGreaterThan(512*1024*1024);
  expect(captured.bytes).toBeLessThan(2*1024*1024*1024);
  const metrics={phase:'captured',uniqueFrames:700,pngBytes:captured.bytes,pngAverageBytes:captured.bytes/700,
    captureMs:captured.captureMs,capturedCache:captured.cache,
    context:persistent ? 'persistent' : 'incognito',naturalQuota,quotaOverride:false};
  await writeFile(testInfo.outputPath('RESULT.json'),JSON.stringify(metrics,null,2));
  await writeFile(testInfo.outputPath('HASHES.json'),JSON.stringify(captured.hashes));
  console.log('LARGE CAPTURE '+JSON.stringify(metrics));
  // Preserve the complete originals BEFORE either a status assertion or reload.
  const portableSaveStart=Date.now(), projectPath=testInfo.outputPath('700-frames.stopmotion');
  const projectDownload=page.waitForEvent('download'); await page.locator('#saveProject').click();
  await (await projectDownload).saveAs(projectPath);
  const portableBytes=(await stat(projectPath)).size, portableSaveMs=Date.now()-portableSaveStart;
  Object.assign(metrics,{phase:'backed-up',portableBytes,portableSaveMs});
  await writeFile(testInfo.outputPath('RESULT.json'),JSON.stringify(metrics,null,2));
  console.log('LARGE BACKUP '+JSON.stringify({projectPath,portableBytes,portableSaveMs}));
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
  const recoveryStart=Date.now();
  await page.reload(); await page.evaluate(() => main.project.ready);
  const recoveryMs=Date.now()-recoveryStart;
  const restored = await page.evaluate(async () => {
    const hashes=[];
    for (const frame of main.animator.frames)
      hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',await frame.png.arrayBuffer()))].join(','));
    await main.animator.drawFrame(699,main.animator.playContext);
    return {hashes,fps:main.animator.playbackSpeed,frames:main.animator.frames.length,
      visibleThumbs:document.querySelectorAll('#thumbnail-container canvas').length,
      tailRGB:[...main.animator.playContext.getImageData(970,370,1,1).data].slice(0,3)};
  });
  expect(restored.hashes).toEqual(captured.hashes); expect(restored.fps).toBe(24);
  expect(restored.frames).toBe(700);
  // The filmstrip virtualizes large projects: only a window of cells is rendered.
  expect(restored.visibleThumbs).toBeGreaterThan(0);
  expect(restored.visibleThumbs).toBeLessThanOrEqual(80);
  Object.assign(metrics,{phase:'recovered',recoveryMs,orderHashesEqual:true});
  await writeFile(testInfo.outputPath('RESULT.json'),JSON.stringify(metrics,null,2));
  console.log('LARGE recovered 700');
  const portableOpenStart=Date.now();
  await page.evaluate(()=>main.animator.clear()); await page.evaluate(()=>main.project.flushed());
  // Local file path: never read a >1GiB container into a Node Buffer or page string.
  await page.locator('#projectFile').setInputFiles(projectPath);
  await expect(page.locator('#project-status')).toHaveText('Saved on this device',{timeout:60000});
  const portableHashes=await page.evaluate(async()=>{
    const hashes=[];
    for(const frame of main.animator.frames)
      hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',await frame.png.arrayBuffer()))].join(','));
    return hashes;
  });
  expect(portableHashes).toEqual(captured.hashes);
  Object.assign(metrics,{phase:'portable-restored',portableOpenMs:Date.now()-portableOpenStart,portableHashesEqual:true});
  await writeFile(testInfo.outputPath('RESULT.json'),JSON.stringify(metrics,null,2));
  console.log('LARGE portable restored 700');
  const downloading=page.waitForEvent('download');
  const exportStart=Date.now();
  await page.evaluate(async () => { await main.animator.save('700-frames'); });
  const videoPath=testInfo.outputPath('700-frames.webm'); await (await downloading).saveAs(videoPath);
  const exportMs=Date.now()-exportStart;
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_streams','-show_format','-of','json',videoPath],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true}));
  expect(probe.packets).toHaveLength(707);
  expect(Number(probe.format.duration)).toBeCloseTo(700/24,3);
  expect([probe.streams[0].width,probe.streams[0].height]).toEqual([1280,720]);
  for(let i=0;i<700;i++) expect(Math.abs(Number(probe.packets[i].pts_time)-i/24)).toBeLessThanOrEqual(.001);
  const cache=await page.evaluate(()=>stopFrames.stats());
  expect(cache.peakEntries).toBeLessThanOrEqual(8); expect(cache.peakPixels).toBeLessThanOrEqual(16*1024*1024);
  expect(cache.closed).toBeGreaterThan(600);
  const decodedTail=execFileSync('ffmpeg',['-v','error','-ss',String(700/24-.02),'-i',videoPath,
    '-frames:v','1','-vf','crop=2:2:970:370','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
  expect(decodedTail.length).toBe(12);
  const tailRGB=[...decodedTail.subarray(0,3)];
  for(let i=0;i<3;i++) expect(Math.abs(tailRGB[i]-restored.tailRGB[i])).toBeLessThanOrEqual(8);
  Object.assign(metrics,{phase:'complete',exportMs,tailRGB,originalTailRGB:restored.tailRGB,
    recoveredAndExportedCache:cache,packets:probe.packets.length,
    duration:probe.format.duration,webmBytes:probe.format.size});
  await writeFile(testInfo.outputPath('RESULT.json'),JSON.stringify(metrics,null,2));
  console.log('LARGE RESULT '+JSON.stringify(metrics));
});

test('async cancellation, shared edits, portable recovery, byte guards and coalesced autosave', async ({page}) => {
  test.setTimeout(45000);
  await camera(page,64,48);
  await page.evaluate(async () => { await main.animator.capture(); });
  const result=await page.evaluate(async () => {
    const an=main.animator; await main.project.flushed();
    const original=an.frames[0];
    document.querySelector('#thumbnail-container canvas').click();
    document.getElementById('duplicateFrame').click();
    const shared=an.frames[0]===an.frames[1];
    document.getElementById('undoButton').click(); document.getElementById('redoButton').click();
    const restoredIdentity=an.frames[0]===original && an.frames[1]===original;
    await main.project.flushed();
    const write=projectStorage.write.bind(projectStorage), writes=[];
    let release;
    projectStorage.write=async data=>{
      writes.push(data.fps);
      if(writes.length===1) await new Promise(resolve=>{release=resolve});
      return write(data);
    };
    an.setPlaybackSpeed(4);
    await Promise.resolve();
    for(let i=5;i<=120;i++) an.setPlaybackSpeed(i);
    const queue=main.project.queueState();
    release(); await main.project.flushed(); projectStorage.write=write;
    return {shared,restoredIdentity,writes,queue};
  });
  expect(result).toEqual({shared:true,restoredIdentity:true,writes:[4,120],queue:{active:1,pending:1}});
  const downloading=page.waitForEvent('download'); await page.locator('#saveProject').click();
  const buffer=await readFile(await (await downloading).path());
  await page.evaluate(()=>main.animator.clear()); await page.evaluate(()=>main.project.flushed());
  await page.locator('#projectFile').setInputFiles({name:'saved.stopmotion',mimeType:'application/json',buffer});
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
  expect(await page.evaluate(()=>({count:main.animator.frames.length,fps:main.animator.playbackSpeed}))).toEqual({count:2,fps:120});
  const played=await page.evaluate(async()=>{
    const an=main.animator; an.setPlaybackSpeed(12);
    const completed=await an.startPlay();
    return {completed,playing:an.isPlaying(),frames:an.frames.length};
  });
  expect(played).toEqual({completed:true,playing:false,frames:2});
  const cancellation=await page.evaluate(async () => {
    const an=main.animator;
    await stopFrames.clear();
    const decode=createImageBitmap; let release;
    window.createImageBitmap=async (...args)=>{
      await new Promise(resolve=>{release=resolve}); window.createImageBitmap=decode; return decode(...args);
    };
    const draw=an.drawFrame(0,an.playContext);
    while(!release) await Promise.resolve();
    an.clear(); release(); await draw;
    const stalePaint=[...an.playContext.getImageData(0,0,1,1).data];
    await stopFrames.clear();
    const native=HTMLCanvasElement.prototype.toBlob; let releasePNG;
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){
      releasePNG=()=>native.call(this,callback,...args);
    };
    const capture=an.capture();
    const second=an.capture();
    const queuedSecond=!!second && typeof second.then==='function';
    const disabled=document.getElementById('captureButton').disabled;
    an.clear(); releasePNG(); await Promise.all([capture,second]);
    HTMLCanvasElement.prototype.toBlob=native;
    return {stalePaint,queuedSecond,disabled,frames:an.frames.length,busy:an.captureBusy};
  });
  expect(cancellation).toEqual({stalePaint:[0,0,0,0],queuedSecond:true,disabled:false,frames:0,busy:false});
  const guards=await page.evaluate(async () => {
    const an=main.animator; await an.capture();
    const original=an.frames[0];
    // Model size without allocating a 2GiB test blob.
    const huge=Object.freeze({...original,png:{size:stopFrames.maxBytes/2+1}});
    an.frames=[huge]; an.holds=[1]; an.timeline.reset();
    document.querySelector('#thumbnail-container canvas').click(); document.getElementById('duplicateFrame').click();
    const duplicateRefused=an.frames.length===1;
    an.frames=[huge,huge];an.holds=[1,1];
    const captureRefused=an.capture()===null;
    an.frames=[original];an.holds=[1];an.timeline.reset();
    return {duplicateRefused,captureRefused};
  });
  expect(guards).toEqual({duplicateRefused:true,captureRefused:true});
  console.log('LARGE SAFETY '+JSON.stringify({result,cancellation,guards,played}));
});

test('binary descriptor/length guards preserve current state; legacy JSON v1 still opens', async ({page}) => {
  await camera(page,64,48);
  await page.evaluate(async()=>{await main.animator.capture(); await main.project.flushed();});
  const pending=page.waitForEvent('download'); await page.locator('#saveProject').click();
  const valid=await readFile(await (await pending).path());
  expect(valid.subarray(0,8).toString()).toBe('STOPMOT2');
  const metadataLength=valid.readUInt32LE(8);
  const metadata=JSON.parse(valid.subarray(12,12+metadataLength).toString());
  const payload=valid.subarray(12+metadataLength);
  expect(metadata.version).toBe(2); expect(metadata.frames[0]).toEqual({size:payload.length,type:'image/png'});
  const binary=data=>{
    const json=Buffer.from(JSON.stringify(data)), header=Buffer.alloc(12);
    header.write('STOPMOT2'); header.writeUInt32LE(json.length,8);
    return Buffer.concat([header,json,payload]);
  };
  const headerTooLarge=Buffer.from(valid);headerTooLarge.writeUInt32LE(1024*1024+1,8);
  const malformed=[headerTooLarge,valid.subarray(0,valid.length-1),Buffer.concat([valid,Buffer.from([0])])];
  for(const size of [-1,0,1.5,Number.MAX_SAFE_INTEGER+1,2*1024*1024*1024+1])
    malformed.push(binary({...metadata,frames:[{size,type:'image/png'}]}));
  malformed.push(binary({...metadata,frames:[{size:payload.length,type:'image/jpeg'}]}));
  malformed.push(binary({...metadata,version:3}));
  await page.evaluate(()=>{
    window.beforeBinaryFrame=main.animator.frames[0];window.binaryValidationCalls=0;
    const validate=stopFrames.fromPNG;
    stopFrames.fromPNG=(...args)=>{binaryValidationCalls++;return validate(...args);};
  });
  for(const buffer of malformed) {
    await page.locator('#projectFile').setInputFiles({name:'bad.stopmotion',mimeType:'application/x-stopmotion',buffer});
    await expect(page.locator('#project-status')).toContainText('Current project preserved');
    expect(await page.evaluate(()=>main.animator.frames[0]===beforeBinaryFrame)).toBe(true);
  }
  expect(await page.evaluate(()=>binaryValidationCalls)).toBe(0);
  const legacy={...metadata,version:1,frames:['data:image/png;base64,'+payload.toString('base64')]};
  delete legacy.holds;
  await page.locator('#projectFile').setInputFiles({name:'v1.stopmotion',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
  expect(await page.evaluate(()=>({frames:main.animator.frames.length,holds:main.animator.holds}))).toEqual({frames:1,holds:[1]});
  expect(await page.evaluate(()=>binaryValidationCalls)).toBe(1);
  console.log('LARGE BINARY '+JSON.stringify({malformedRejected:malformed.length,legacyFrames:1,legacyDefaultHold:1}));
});

test('resume export from saved large project without recapture', async ({page},testInfo)=>{
  const backup=process.env.STOPMOTION_RESUME_PROJECT;
  test.skip(!backup,'Explicit existing backup required; never recapture here.');
  test.setTimeout(180000);
  const hashes=JSON.parse(await readFile(path.join(path.dirname(backup),'HASHES.json'),'utf8'));
  const openStarted=Date.now();
  await page.locator('#projectFile').setInputFiles(backup);
  await expect(page.locator('#project-status')).toHaveText('Saved on this device',{timeout:60000});
  const actual=await page.evaluate(async()=>{
    const an=main.animator,hashes=[];
    for(const frame of an.frames)
      hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',await frame.png.arrayBuffer()))].join(','));
    await an.drawFrame(an.frames.length-1,an.playContext);
    return {hashes,fps:an.playbackSpeed,width:an.w,height:an.h,
      tailRGB:[...an.playContext.getImageData(970,370,1,1).data].slice(0,3)};
  });
  expect(actual.hashes).toEqual(hashes);expect(actual.hashes).toHaveLength(700);
  expect(actual.fps).toBe(24);
  const metrics={phase:'opened-backup',backup,hashesEqual:true,frames:hashes.length,
    openMs:Date.now()-openStarted,context:persistent?'persistent':'incognito',quotaOverride:false};
  await writeFile(testInfo.outputPath('RESULT.json'),JSON.stringify(metrics,null,2));
  const downloading=page.waitForEvent('download');downloading.catch(()=>{});
  const exportStarted=Date.now();
  await page.evaluate(()=>main.animator.save('700-frames'));
  const videoPath=testInfo.outputPath('700-frames.webm');await(await downloading).saveAs(videoPath);
  const exportMs=Date.now()-exportStarted;
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_streams','-show_format','-of','json',videoPath],
    {encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true}));
  expect(probe.packets).toHaveLength(707);
  expect(Number(probe.format.duration)).toBeCloseTo(700/24,3);
  expect([probe.streams[0].width,probe.streams[0].height]).toEqual([1280,720]);
  const maxTimestampErrorMs=Math.max(...probe.packets.slice(0,700).map((packet,i)=>Math.abs(Number(packet.pts_time)*1000-i*1000/24)));
  expect(maxTimestampErrorMs).toBeLessThanOrEqual(1);
  const tail=execFileSync('ffmpeg',['-v','error','-ss',String(700/24-.02),'-i',videoPath,
    '-frames:v','1','-vf','crop=2:2:970:370','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
  expect(tail.length).toBe(12);
  const tailRGB=[...tail.subarray(0,3)];
  for(let i=0;i<3;i++)expect(Math.abs(tailRGB[i]-actual.tailRGB[i])).toBeLessThanOrEqual(8);
  const cache=await page.evaluate(()=>stopFrames.stats());
  expect(cache.peakEntries).toBeLessThanOrEqual(8);expect(cache.peakPixels).toBeLessThanOrEqual(16*1024*1024);
  expect(cache.closed).toBeGreaterThan(600);
  Object.assign(metrics,{phase:'complete',exportMs,packets:probe.packets.length,
    duration:probe.format.duration,webmBytes:probe.format.size,maxTimestampErrorMs,tailRGB,
    originalTailRGB:actual.tailRGB,cache});
  await writeFile(testInfo.outputPath('RESULT.json'),JSON.stringify(metrics,null,2));
  console.log('LARGE RESUMED '+JSON.stringify(metrics));
});
