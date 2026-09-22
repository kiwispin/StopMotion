import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  page.errors=[]; page.on('pageerror',e=>page.errors.push(e.message));
  await page.addInitScript(() => {
    window.metrics={webp:0,canvases:0,thumbnailSources:0}; window.unhandled=[];
    addEventListener('unhandledrejection',e=>unhandled.push(String(e.reason)));
    navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Fixture','NotAllowedError');};
    const toBlob=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(cb,type,quality) {
      if(type==='image/webp') metrics.webp++;
      return toBlob.call(this,cb,type,quality);
    };
    const create=document.createElement.bind(document);
    document.createElement=function(name,...args) {if(name==='canvas') metrics.canvases++;return create(name,...args);};
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(source,...args) {
      if(this.canvas.width===96 && this.canvas.height===72 && source.width===64 && source.height===48)
        metrics.thumbnailSources++;
      return draw.call(this,source,...args);
    };
  });
});
test.afterEach(async ({page})=>{
  expect(page.errors).toEqual([]); expect(await page.evaluate(()=>unhandled)).toEqual([]);
});
async function capture(page) {
  await page.goto('/'); await page.evaluate(()=>main.project.ready);
  await page.evaluate(async()=>{
    window.fixture=document.createElement('canvas');fixture.width=64;fixture.height=48;
    const ctx=fixture.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,64,48);
    window.fixtureStream=fixture.captureStream(30);
    navigator.mediaDevices.getUserMedia=async()=>fixtureStream;
    await main.animator.attachStream('memory-fixture'); await main.animator.video.play();
    main.animator.syncCameraDimensions();
  });
  for(const color of ['red','lime','blue']) {
    await page.evaluate(async color=>{
      const ready=new Promise(resolve=>main.animator.video.requestVideoFrameCallback(resolve));
      const ctx=fixture.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,64,48);
      fixtureStream.getVideoTracks()[0].requestFrame(); await ready;
    },color);
    await page.locator('#captureButton').click();
    await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  }
  await page.evaluate(()=>main.project.flushed());
}

test('capture and recovery encode zero WebPs until export; original bytes preserved',async({page})=>{
  await capture(page);
  expect(await page.evaluate(()=>metrics.webp)).toBe(0);
  await page.reload(); await page.evaluate(()=>main.project.ready);
  expect(await page.evaluate(()=>({frames:main.animator.frames.length,calls:metrics.webp}))).toEqual({frames:3,calls:0});
  const evidence=await page.evaluate(async()=>{
    const blob=await main.animator.encode('lazy'), afterExport={...metrics}, cache=stopMedia.cacheStats();
    const frames=[]; webm.decode(await blob.arrayBuffer(),null,null,b=>frames.push(b));
    const hash=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
      stopMedia.vp8Payload(await blob.arrayBuffer())))].join(',');
    const actual=await Promise.all(frames.map(hash)), expected=[];
    for(const canvas of main.animator.frames) expected.push(await hash(await stopMedia.encodeFrame(canvas)));
    return {afterExport,cache,actual,expected};
  });
  expect(evidence.afterExport.webp).toBe(3);
  expect(evidence.actual).toEqual(evidence.expected);
  expect(evidence.cache.entries).toBe(1); expect(evidence.cache.bytes).toBeLessThanOrEqual(evidence.cache.maxBytes);
  expect(evidence.cache.inFlight).toBe(0);
  console.log('LAZY '+JSON.stringify({beforeExport:0,exportEncodes:evidence.afterExport.webp,cache:evidence.cache,matchedFrames:evidence.actual.length}));
});

test('thumbnail reuse keeps duplicate nodes distinct and colors correct through edits and undo',async({page})=>{
  await capture(page);
  const before=await page.evaluate(()=>({...metrics}));
  const pixels=()=>page.evaluate(()=>[...document.querySelectorAll('#thumbnail-container canvas')]
    .map(c=>[...c.getContext('2d').getImageData(48,36,1,1).data].slice(0,3)));
  await page.locator('#thumbnail-container canvas').first().click();
  await page.locator('#duplicateFrame').click();
  expect(await pixels()).toEqual([[255,0,0],[255,0,0],[0,255,0],[0,0,255]]);
  expect(await page.evaluate(()=>new Set(document.querySelectorAll('#thumbnail-container canvas')).size)).toBe(4);
  expect(await page.evaluate(()=>main.animator.frameWebps[0]===main.animator.frameWebps[1])).toBe(true);
  await page.locator('#moveRight').click();
  expect(await pixels()).toEqual([[255,0,0],[0,255,0],[255,0,0],[0,0,255]]);
  await page.locator('#frameHold').fill('3'); await page.locator('#frameHold').press('Tab');
  await page.locator('#undoButton').click(); await page.locator('#undoButton').click();
  await page.locator('#undoButton').click();
  expect(await pixels()).toEqual([[255,0,0],[0,255,0],[0,0,255]]);
  const after=await page.evaluate(()=>({...metrics}));
  expect(after.canvases-before.canvases).toBe(1);
  expect(after.thumbnailSources-before.thumbnailSources).toBe(0);
  expect(after.webp).toBe(0);
  console.log('THUMBNAILS '+JSON.stringify({uniqueSourceDraws:before.thumbnailSources,
    editSourceDraws:after.thumbnailSources-before.thumbnailSources,newNodes:after.canvases-before.canvases,webpEncodes:after.webp}));
});
