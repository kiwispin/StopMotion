import {test, expect} from './fixtures.js';
import {writeFile} from 'node:fs/promises';

test('isolated natural quota and IndexedDB failure identity', async ({page}, testInfo) => {
  test.setTimeout(45000);
  await page.addInitScript(()=>{
    navigator.mediaDevices.enumerateDevices=async()=>[];
    navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('No camera in quota probe','NotFoundError');};
  });
  await page.goto('/'); await page.evaluate(()=>main.project.ready);
  const evidence=await page.evaluate(async()=>{
    const natural=await navigator.storage.estimate();
    // Composite Blob references one small buffer; do not allocate a quota-sized
    // JS ArrayBuffer, capture cameras, or decode any frame for this diagnostic.
    const chunk=new Blob([new Uint8Array(1024*1024)]);
    const target=natural.quota<=1.1*1024**3 ? natural.quota+chunk.size : 600*1024*1024;
    const payload=new Blob(Array(Math.ceil(target/chunk.size)).fill(chunk));
    await projectStorage.write({probe:'last-good'});
    let failure=null;
    try {await projectStorage.write({probe:payload});}
    catch(error){failure={name:error?.name||null,message:error?.message||'',text:String(error)};}
    const retained=await projectStorage.read();
    // Verify the production fallback with the actual blank-message exception.
    const write=projectStorage.write;
    projectStorage.write=async()=>{throw new DOMException('',failure?.name||'QuotaExceededError');};
    main.project.changed();await main.project.flushed();projectStorage.write=write;
    return {natural,probed:true,attemptedBytes:payload.size,failure,
      retained:retained?.probe==='last-good',storedBytes:retained?.probe?.size||0,
      status:document.getElementById('project-status').textContent,
      after:await navigator.storage.estimate()};
  });
  await writeFile(testInfo.outputPath('QUOTA.json'),JSON.stringify(evidence,null,2));
  console.log('QUOTA '+JSON.stringify(evidence));
  if(evidence.failure) expect(evidence.retained).toBe(true);
  else expect(evidence.storedBytes).toBe(evidence.attemptedBytes);
  if(!evidence.failure || evidence.failure.name==='QuotaExceededError') {
    expect(evidence.status).toContain('Browser storage limit reached');
    expect(evidence.status).toContain('Save Project now before closing or reloading');
    expect(evidence.status).toContain('(non-private) window with available storage');
  }
});
