import {test as base, expect} from './fixtures.js';
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

const persistent=process.env.STOPMOTION_PERSISTENT==='1';
const test=persistent ? base.extend({context:async ({},use,testInfo)=>{
  const context=await chromium.launchPersistentContext(testInfo.outputPath('browser-profile'),
    {headless:true,baseURL:'http://127.0.0.1:4173'});
  try {await use(context);} finally {await context.close();}
}}) : base;

test('incremental distinct blob saves expose actual storage failure', async ({page}, testInfo) => {
  test.setTimeout(150000);
  await page.addInitScript(()=>{
    navigator.mediaDevices.enumerateDevices=async()=>[];
    navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Storage diagnostic','NotFoundError');};
  });
  await page.exposeFunction('storageProgress',async value=>{
    await writeFile(testInfo.outputPath('UNIQUE.json'),JSON.stringify(value,null,2));
    console.log('UNIQUE '+JSON.stringify(value));
  });
  await page.goto('/');await page.evaluate(()=>main.project.ready);
  const evidence=await page.evaluate(async()=>{
    const started=performance.now(),natural=await navigator.storage.estimate();
    const an=main.animator,write=projectStorage.write.bind(projectStorage);
    let failure=null,writes=0,lastGood=0,generated=0;
    projectStorage.write=async data=>{
      if(failure) throw new Error('Diagnostic stopped after first storage failure.');
      writes++;
      try {await write(data);lastGood=data.frames.length;}
      catch(error){
        failure={name:error?.name||null,message:error?.message||'',text:String(error),
          cause:error?.cause ? String(error.cause) : null,frames:data.frames.length,
          bytes:data.frames.reduce((sum,blob)=>sum+blob.size,0),estimate:await navigator.storage.estimate()};
        throw error;
      }
    };
    an.setDimensions(1280,720);an.dimensionsLocked=true;
    for(let i=0;i<700&&!failure;i++) {
      const bytes=new Uint8Array(1525000);
      for(let offset=0;offset<bytes.length;offset+=65536)
        crypto.getRandomValues(bytes.subarray(offset,Math.min(offset+65536,bytes.length)));
      // Distinct backing bytes per Blob; intentionally not decoded as an image.
      const png=new Blob([bytes],{type:'image/png'});
      an.frames.push(Object.freeze({width:1280,height:720,png}));an.holds.push(1);
      generated++;main.project.changed();
      if(generated%100===0) await storageProgress({phase:'writing',generated,writes,lastGood,
        logicalBytes:generated*1525000,elapsedMs:performance.now()-started,natural});
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await main.project.flushed();
    const stored=await projectStorage.read();
    return {phase:'complete',generated,writes,lastGood,storedFrames:stored?.frames?.length||0,
      logicalBytes:generated*1525000,elapsedMs:performance.now()-started,natural,
      failure,after:await navigator.storage.estimate()};
  });
  evidence.context=persistent ? 'persistent' : 'incognito';
  await writeFile(testInfo.outputPath('UNIQUE.json'),JSON.stringify(evidence,null,2));
  console.log('UNIQUE RESULT '+JSON.stringify(evidence));
  expect(evidence.storedFrames).toBe(evidence.lastGood);
});
