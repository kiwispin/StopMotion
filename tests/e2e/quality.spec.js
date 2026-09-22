import {test, expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {asLegacyProject} from './project-file.js';
import path from 'node:path';

test.beforeEach(async ({page}) => {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.addInitScript(() => {
    window.unhandled = [];
    addEventListener('unhandledrejection', e => unhandled.push(String(e.reason)));
  });
});
test.afterEach(async ({page}) => {
  expect(page.errors).toEqual([]);
  expect(await page.evaluate(() => unhandled)).toEqual([]);
});
async function open(page) {
  await page.goto('/'); await page.evaluate(() => main.project.ready);
  await expect.poll(() => page.evaluate(() => main.animator.video.readyState)).toBeGreaterThanOrEqual(2);
}
async function camera(page, width, height) {
  await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  await page.evaluate(async ({width,height}) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0,0,width,height);
    const stream = canvas.captureStream(30);
    const original = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => stream;
    try { await main.animator.attachStream('canvas-camera'); } finally { navigator.mediaDevices.getUserMedia = original; }
    window.cameraCanvas = canvas;
    await main.animator.video.play();
    // play() has presented the initial solid frame; a static canvas may not emit
    // another distinct video frame merely because requestFrame() is called.
    main.animator.syncCameraDimensions();
  }, {width,height});
}
async function dimensions(page) {
  return page.evaluate(() => ({project:[main.animator.w,main.animator.h],
    snapshot:[main.animator.snapshotCanvas.width,main.animator.snapshotCanvas.height],
    playback:[main.animator.playCanvas.width,main.animator.playCanvas.height]}));
}
async function clear(page) {
  await page.locator('#clearButton').click(); await page.locator('#clearConfirmButton').click();
}
async function download(page) {
  const waiting = page.waitForEvent('download'); await page.locator('#saveProject').click();
  return readFile(await (await waiting).path());
}
async function upload(page, buffer) {
  await page.locator('#projectFile').setInputFiles({name:'resolution.stopmotion',mimeType:'application/json',buffer});
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
}

test('actual HD, lower fallback and letterboxed locked projects without upscale', async ({page}) => {
  await open(page); await camera(page,640,480);
  expect((await dimensions(page)).project).toEqual([640,480]);
  const staleRejected = await page.evaluate(() => {
    const video = main.animator.video;
    Object.defineProperty(video,'videoWidth',{configurable:true,value:1280});
    try { return main.animator.capture() === null && main.animator.frames.length === 0; }
    finally { delete video.videoWidth; }
  });
  expect(staleRejected).toBe(true);
  await page.locator('#captureButton').click();
  await camera(page,1280,720);
  expect(await dimensions(page)).toEqual({project:[640,480],snapshot:[640,480],playback:[640,480]});
  await page.locator('#captureButton').click();
  await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  const region = await page.evaluate(async () => {
    const ctx = (await testFrameCanvas(main.animator.frames[1])).getContext('2d');
    return [0,59,60,419,420,479].map(y => [...ctx.getImageData(320,y,1,1).data]);
  });
  expect(region.map(p => p[0])).toEqual([0,0,255,255,0,0]);
  await clear(page);
  expect(await dimensions(page)).toEqual({project:[1280,720],snapshot:[1280,720],playback:[1280,720]});
  await page.locator('#captureButton').click();
  await camera(page,640,480); await page.locator('#captureButton').click();
  expect((await dimensions(page)).project).toEqual([1280,720]);
  const framing = await page.evaluate(() => {
    const stage = document.getElementById('video-container').getBoundingClientRect();
    const live = main.animator.video.getBoundingClientRect();
    return [live.width/stage.width,live.height/stage.height];
  });
  expect(framing[0]).toBeCloseTo(0.5,2); expect(framing[1]).toBeCloseTo(2/3,2);
  await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  expect(await page.evaluate(async () => {
    const ctx = (await testFrameCanvas(main.animator.frames[1])).getContext('2d');
    return [319,320,959,960].map(x => ctx.getImageData(x,360,1,1).data[0]);
  })).toEqual([0,255,255,0]);
  await clear(page);
  expect((await dimensions(page)).project).toEqual([640,480]);
  await expect(page.locator('#resolutionStatus')).toContainText('Camera 640×480');
  await camera(page,1280,720);
  await page.evaluate(() => main.project.flushed());
  expect(await page.evaluate(async () => {
    const saved = await projectStorage.read(); return [saved.width,saved.height,saved.frames.length];
  })).toEqual([1280,720,0]);
});

test('opened and recovered empty dimensions stay locked until explicit Clear', async ({page}) => {
  await open(page); await camera(page,640,480);
  const buffer = await download(page);
  await camera(page,1280,720);
  await upload(page, buffer);
  expect((await dimensions(page)).project).toEqual([640,480]);
  await camera(page,1920,1080);
  expect((await dimensions(page)).project).toEqual([640,480]);
  await page.evaluate(() => main.project.flushed());
  await page.reload(); await page.evaluate(() => main.project.ready);
  await expect.poll(() => page.evaluate(() => main.animator.video.readyState)).toBeGreaterThanOrEqual(2);
  expect((await dimensions(page)).project).toEqual([640,480]);
  await camera(page,1920,1080); await clear(page);
  expect((await dimensions(page)).project).toEqual([1920,1080]);
  await expect(page.locator('#captureLimit')).toContainText('2,000 frames');
});

test('late recovery wins camera metadata and stale camera results are stopped', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window,'projectStorage',{configurable:true,set(storage) {
      Object.defineProperty(window,'projectStorage',{value:storage,configurable:true});
      storage.read = () => new Promise(resolve => { window.finishRecovery = () => resolve({format:'stopmotion-project',version:1,
        width:320,height:240,fps:7,flip:false,name:'empty',frames:[]}); });
    }});
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => main.animator.video.readyState)).toBeGreaterThanOrEqual(2);
  expect((await dimensions(page)).project).toEqual([640,480]);
  await page.evaluate(() => finishRecovery()); await page.evaluate(() => main.project.ready);
  expect((await dimensions(page)).project).toEqual([320,240]);
  await page.evaluate(async () => {
    const pending = [];
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => pending.push(resolve));
    const first = main.animator.attachStream('old');
    const second = main.animator.attachStream('new');
    const make = (w,h) => { const c = document.createElement('canvas'); c.width=w;c.height=h; return c.captureStream(); };
    window.oldStream = make(1920,1080); window.newStream = make(640,480);
    pending[1](newStream); await second; pending[0](oldStream); await first;
  });
  expect(await page.evaluate(() => oldStream.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
  expect((await dimensions(page)).project).toEqual([320,240]);
});

test('HD allocation guard enforces frame count before creating a canvas', async ({page}) => {
  await open(page); await camera(page,1280,720); await page.locator('#captureButton').click();
  await expect(page.locator('#captureLimit')).toContainText('2,000 frames');
  await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  const allocated = await page.evaluate(() => {
    const an = main.animator;
    an.frames = Array(2000).fill(an.frames[0]); an.holds = Array(2000).fill(1);
    const create = document.createElement.bind(document); let count = 0;
    document.createElement = (...args) => { if (args[0] === 'canvas') count++; return create(...args); };
    try { an.capture(); return count; } finally { document.createElement = create; }
  });
  expect(allocated).toBe(0);
  await expect(page.locator('#timelineMessage')).toContainText('Capture limit reached');
});

test('native decoded detail quality improves and fresh/recovered/open encodings match', async ({page}) => {
  test.setTimeout(30000);
  await open(page); await camera(page,1280,720);
  await page.evaluate(async () => {
    const ctx = cameraCanvas.getContext('2d');
    const image = ctx.createImageData(1280,720); let seed = 123456;
    for (let y=0;y<720;y++) for (let x=0;x<1280;x++) {
      seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
      const v = Math.max(0,Math.min(255,Math.round(35 + 170*x/1279 + 20*Math.sin(y/5) + ((seed>>>24)-128)/4 + ((x%17<2 && y%13<2)?40:0))));
      const i=(y*1280+x)*4;
      image.data[i]=v;
      image.data[i+1]=x<640?v:Math.round(255*y/719);
      image.data[i+2]=x<640?v:((x%19<3)?255:Math.round(127+110*Math.sin((x+y)/21)));
      image.data[i+3]=255;
    }
    ctx.putImageData(image,0,0);
    ctx.fillStyle='#111';ctx.fillRect(680,40,550,75);
    ctx.font='bold 28px system-ui';ctx.fillStyle='#ffcc00';ctx.fillText('HD detail · blue / red edges',695,85);
    await new Promise(resolve => { main.animator.video.requestVideoFrameCallback(resolve); main.animator.videoStream.getVideoTracks()[0].requestFrame(); });
  });
  await page.locator('#captureButton').click();
  await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  const evidence = await page.evaluate(async () => {
    const source = await testFrameCanvas(main.animator.frames[0]), original = source.getContext('2d').getImageData(0,0,1280,720).data;
    const raw = q => new Promise(resolve => source.toBlob(resolve,'image/webp',q));
    const baseline = await raw(undefined), high = await stopMedia.encodeFrame(source), one = await raw(1);
    let qualityOne;
    try { stopMedia.vp8Payload(await one.arrayBuffer()); qualityOne = 'VP8'; } catch(e) { qualityOne = e.message; }
    async function score(blob, width=1280, height=720) {
      const muxed = await webm.encode('quality',width,height,100,[Promise.resolve(blob),Promise.resolve(blob)],null);
      const video = document.createElement('video'), url = URL.createObjectURL(muxed);
      try {
        await new Promise((resolve,reject) => { video.onloadedmetadata=resolve; video.onerror=()=>reject(new Error('native decode failed')); video.src=url; });
        await new Promise(resolve => { video.onseeked=resolve; video.currentTime=0.05; });
        const canvas = document.createElement('canvas'); canvas.width=1280;canvas.height=720;
        canvas.getContext('2d').drawImage(video,0,0,1280,720);
        const decoded = canvas.getContext('2d').getImageData(0,0,1280,720).data;
        let sum=0, squared=0, gray=0, graySquared=0, color=0;
        for(let i=0;i<decoded.length;i++) if(i%4!==3) {
          const d=decoded[i]-original[i];sum+=Math.abs(d);squared+=d*d;
          if((Math.floor(i/4)%1280)<640) { gray+=Math.abs(d);graySquared+=d*d; } else color+=Math.abs(d);
        }
        const count=1280*720*3;
        return {mae:sum/count,grayMAE:gray/(count/2),grayPSNR:10*Math.log10(255*255/(graySquared/(count/2))),colorMAE:color/(count/2),psnr:10*Math.log10(255*255/(squared/count)),webpBytes:blob.size,webmBytes:muxed.size,
          resolution:[video.videoWidth,video.videoHeight]};
      } finally {video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
    }
    window.highHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',await high.arrayBuffer()))].join(',');
    const low = document.createElement('canvas');low.width=640;low.height=360;
    low.getContext('2d').drawImage(source,0,0,640,360);
    return {baseline:await score(baseline),high:await score(high),
      halfResolutionHigh:await score(await stopMedia.encodeFrame(low),640,360),qualityOne};
  });
  console.log('QUALITY ' + JSON.stringify(evidence));
  expect(evidence.high.grayMAE).toBeLessThan(evidence.baseline.grayMAE * 0.9);
  expect(evidence.high.grayPSNR).toBeGreaterThan(evidence.baseline.grayPSNR + 1);
  expect(evidence.high.mae).toBeLessThan(evidence.baseline.mae);
  expect(evidence.high.mae).toBeLessThan(evidence.halfResolutionHigh.mae);
  expect(evidence.high.resolution).toEqual([1280,720]);
  const encoded = await page.evaluate(() => highHash);
  await page.evaluate(() => main.project.flushed());
  const buffer = await download(page);
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect(await page.evaluate(async () => [...new Uint8Array(await crypto.subtle.digest('SHA-256',await (await stopMedia.encodeFrame(main.animator.frames[0])).arrayBuffer()))].join(','))).toEqual(encoded);
  await clear(page); await upload(page,buffer);
  expect(await page.evaluate(async () => [...new Uint8Array(await crypto.subtle.digest('SHA-256',await (await stopMedia.encodeFrame(main.animator.frames[0])).arrayBuffer()))].join(','))).toEqual(encoded);
});

test('valid PNG recovery and Open fall back to MP4 when WebP encoding is unavailable', async ({page}) => {
  await open(page); await camera(page,640,480); await page.locator('#captureButton').click();
  const buffer = await download(page);
  await page.evaluate(() => main.project.flushed());
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(cb,type,quality) {
      if(type==='image/webp') { cb(null); return; }
      return encode.call(this,cb,type,quality);
    };
  });
  await page.reload(); await page.evaluate(() => main.project.ready);
  await expect(page.locator('#frame-count')).toHaveText('1');
  await expect(page.locator('#project-status')).toHaveText('Recovered saved project');
  await clear(page); await upload(page,buffer);
  await expect(page.locator('#frame-count')).toHaveText('1');
  await page.locator('#saveButton').click();
  await expect(page.locator('#saveConfirmButton')).toHaveText('Export MP4');
  const movie = page.waitForEvent('download');
  await page.locator('#saveConfirmButton').click();
  expect((await movie).suggestedFilename()).toBe('StopMotion.mp4');
  await expect(page.locator('#saveConfirmButton')).toHaveText('Done');
  await page.locator('#saveConfirmButton').click();
  const backup = await download(page);
  expect(asLegacyProject(backup).frames[0]).toBe(asLegacyProject(buffer).frames[0]);
});

test('null unsupported and VP8L encodings reject without hanging and export UI recovers', async ({page}) => {
  await open(page); await camera(page,640,480); await page.locator('#captureButton').click();
  const results = await page.evaluate(async () => {
    const rejected = async fn => { try { await fn(); return false; } catch { return true; } };
    const lossless = new Blob([new Uint8Array([82,73,70,70,14,0,0,0,87,69,66,80,86,80,56,76,1,0,0,0,0,0])],{type:'image/webp'});
    const nullCanvas = document.createElement('canvas'); nullCanvas.toBlob = cb => cb(null);
    const pngCanvas = document.createElement('canvas'); pngCanvas.toBlob = cb => cb(new Blob(['png'],{type:'image/png'}));
    return Promise.all([
      rejected(() => stopMedia.encodeFrame(nullCanvas)), rejected(() => stopMedia.encodeFrame(pngCanvas)),
      rejected(() => webm.encode('bad',640,480,100,[Promise.resolve(lossless)],null)),
      rejected(() => webm.encode('bad',640,480,100,[Promise.reject(new Error('encode failed'))],null)),
      rejected(() => webm.encode('bad',640,480,100,[Promise.resolve(null)],null))
    ]);
  });
  expect(results).toEqual([true,true,true,true,true]);
  await page.evaluate(() => {
    const source = main.animator.frames[0];
    window.originalEncode = stopMedia.encodeFrame;
    stopMedia.encodeFrame = () => Promise.reject(new Error('Simulated encoder unavailable'));
  });
  await page.locator('#saveButton').click(); await page.locator('#saveConfirmButton').click();
  await expect(page.locator('#timelineMessage')).toContainText('Export failed: Simulated encoder unavailable');
  await expect(page.locator('#top-container')).toHaveCSS('opacity','1');
  await page.evaluate(() => { stopMedia.encodeFrame = originalEncode; });
  const waiting = page.waitForEvent('download');
  await page.locator('#saveButton').click(); await page.locator('#saveConfirmButton').click(); await waiting;
});

for (const [width,height] of [[1024,768],[390,844]]) {
  test(`HD aspect layout ${width}`, async ({page}) => {
    await page.setViewportSize({width,height}); await open(page); await camera(page,1280,720);
    for(let i=0;i<3;i++) await page.locator('#captureButton').click();
    const box = await page.locator('#video-container').boundingBox();
    expect(Math.abs(box.width/box.height - 16/9)).toBeLessThan(0.01);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if(width===1024) expect(box.width).toBeGreaterThanOrEqual(850);
    await page.screenshot({path:path.resolve(`test-results/hd-${width}.png`),fullPage:true});
  });
}

test('portrait camera stays landscape without stretching live, captured or reviewed image', async ({page}) => {
  test.setTimeout(30000);
  await page.setViewportSize({width:744,height:1024}); await open(page);
  await camera(page,720,1280);
  expect((await dimensions(page)).project).toEqual([720,405]);
  await page.evaluate(async () => {
    const ctx = cameraCanvas.getContext('2d');
    ctx.fillStyle = '#0000ff'; ctx.fillRect(0,0,720,1280);
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0,400,720,480);
    ctx.fillStyle = '#00ff00'; ctx.beginPath(); ctx.arc(360,640,90,0,2*Math.PI); ctx.fill();
    await new Promise(resolve => {
      main.animator.video.requestVideoFrameCallback(resolve);
      main.animator.videoStream.getVideoTracks()[0].requestFrame();
    });
  });
  const stage = page.locator('#video-container');
  const box = await stage.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(710);
  expect(box.width/box.height).toBeCloseTo(16/9,2);
  await expect(page.locator('#video')).toHaveCSS('object-fit','cover');
  const preview = (await stage.screenshot()).toString('base64');
  const previewCircle = await page.evaluate(async base64 => {
    const blob = await (await fetch('data:image/png;base64,'+base64)).blob();
    const image = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width=image.width;c.height=image.height;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();
    const pixels=ctx.getImageData(0,0,c.width,c.height).data;
    let left=c.width,right=0,top=c.height,bottom=0;
    for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) {
      const i=(y*c.width+x)*4;
      if(pixels[i]<40 && pixels[i+1]>200 && pixels[i+2]<40) {
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      }
    }
    return {width:right-left+1,height:bottom-top+1};
  },preview);
  expect(previewCircle.width).toBeGreaterThan(170);
  expect(Math.abs(previewCircle.width-previewCircle.height)).toBeLessThanOrEqual(2);
  await page.locator('#captureButton').click();
  await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  const saved = await page.evaluate(async () => {
    const c=await testFrameCanvas(main.animator.frames[0]),ctx=c.getContext('2d');
    const green=(x,y)=>{const p=ctx.getImageData(x,y,1,1).data;return p[0]<40 && p[1]>200 && p[2]<40;};
    return {size:[c.width,c.height],corner:[...ctx.getImageData(10,10,1,1).data],
      circleWidth:Array.from({length:c.width},(_,x)=>green(x,202)).filter(Boolean).length,
      circleHeight:Array.from({length:c.height},(_,y)=>green(360,y)).filter(Boolean).length};
  });
  expect(saved.size).toEqual([720,405]);
  expect(saved.corner[0]).toBeGreaterThan(240); expect(saved.corner[2]).toBeLessThan(10);
  expect(saved.circleWidth).toBeGreaterThan(175);
  expect(Math.abs(saved.circleWidth-saved.circleHeight)).toBeLessThanOrEqual(2);
  const movies = await page.evaluate(async () => {
    const an=main.animator, results=[];
    an.holds[0]=6; an.setPlaybackSpeed(6);
    for (const format of ['webm','mp4']) {
      const blob=await an.encode('portrait-camera',{format});
      const v=document.createElement('video'),url=URL.createObjectURL(blob);
      try {
        await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(new Error('Cannot decode '+format));v.src=url;});
        results.push({format,width:v.videoWidth,height:v.videoHeight,bytes:blob.size});
      } finally { v.removeAttribute('src');v.load();URL.revokeObjectURL(url); }
    }
    return results;
  });
  for(const movie of movies) {
    expect([movie.width,movie.height]).toEqual(saved.size);
    expect(movie.bytes).toBeGreaterThan(0);
  }
  await page.locator('#thumbnail-container canvas').first().click();
  await page.evaluate(() => scrollTo(0,0));
  expect((await stage.boundingBox()).width/(await stage.boundingBox()).height).toBeCloseTo(16/9,2);
  await page.screenshot({path:path.resolve('test-results/portrait-camera-circle.png'),fullPage:true});
  await page.setViewportSize({width:1133,height:600}); await camera(page,1280,720);
  expect((await dimensions(page)).project).toEqual([720,405]);
  await page.locator('#liveButton').click();
  await page.locator('#captureButton').click();
  await expect(page.locator('#frame-count')).toHaveText('2');
  console.log('PORTRAIT CAMERA '+JSON.stringify({stage:{width:box.width,height:box.height},previewCircle,saved,movies}));
});

test('existing portrait frames retain their dimensions inside a landscape stage', async ({page}) => {
  await page.setViewportSize({width:744,height:1024}); await open(page);
  await page.evaluate(async () => {
    const an=main.animator,c=document.createElement('canvas');c.width=720;c.height=1280;
    c.getContext('2d').fillRect(0,0,720,1280);
    window.originalPortraitFrame=await stopFrames.fromCanvas(c);
    an.frames=[originalPortraitFrame];an.holds=[1];an.frameWebps=[stopMedia.lazyFrame(originalPortraitFrame)];
    an.dimensionsLocked=true;an.setDimensions(720,1280);an.timeline.reset();
  });
  for(const [width,height] of [[744,1024],[1133,600],[744,1024]]) {
    await page.setViewportSize({width,height});
    const stage=await page.locator('#video-container').boundingBox();
    expect(stage.width/stage.height).toBeCloseTo(16/9,2);
    expect((await dimensions(page)).project).toEqual([720,1280]);
    expect(await page.evaluate(()=>main.animator.frames[0]===originalPortraitFrame)).toBe(true);
    await expect(page.locator('#play-canvas')).toHaveCSS('object-fit','contain');
  }
});
