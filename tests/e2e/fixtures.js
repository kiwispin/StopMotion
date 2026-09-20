import {test as base, expect} from '@playwright/test';

// Wrap native calls for observation; do not retry, resume playback, or alter their results.
export const test = base.extend({
  cameraDiagnostics: [async ({page}, use, testInfo) => {
    await page.addInitScript(() => {
      // Explicit test-only decoding; production frames are not canvas-compatible.
      window.testFrameCanvas = async frame => {
        const image = await createImageBitmap(frame.png);
        const canvas = document.createElement('canvas');
        canvas.width = frame.width; canvas.height = frame.height;
        try { canvas.getContext('2d').drawImage(image, 0, 0); }
        finally { image.close(); }
        return canvas;
      };
      const events = [];
      window.cameraDiagnostics = events;
      const record = (event, detail = {}) => events.push({ms: performance.now(), event, ...detail});
      for (const method of ['enumerateDevices','getUserMedia']) {
        const original = navigator.mediaDevices?.[method]?.bind(navigator.mediaDevices);
        if (!original) continue;
        navigator.mediaDevices[method] = async (...args) => {
          record(method + ':start', {constraints: args[0]});
          try {
            const result = await original(...args);
            record(method + ':resolved', {tracks: result.getTracks?.().map(t => ({kind:t.kind,state:t.readyState,settings:t.getSettings()}))});
            return result;
          } catch (error) {
            record(method + ':rejected', {name:error.name,message:error.message}); throw error;
          }
        };
      }
      for (const event of ['loadstart','loadedmetadata','loadeddata','canplay','playing','pause','emptied','error']) {
        document.addEventListener(event, e => {
          if (e.target.id === 'video') record('video:' + event, {readyState:e.target.readyState,paused:e.target.paused});
        }, true);
      }
    });
    await use();
    if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
      const diagnostic = await page.evaluate(() => {
        const an = window.main?.animator, video = an?.video;
        return {events:window.cameraDiagnostics, visibility:document.visibilityState,
          pending:an?.cameraRequestPending, streamOn:an?.streamOn,
          video:video && {readyState:video.readyState,paused:video.paused,autoplay:video.autoplay,
            dimensions:[video.videoWidth,video.videoHeight],error:video.error?.message,
            tracks:video.srcObject?.getTracks?.().map(t => ({state:t.readyState,muted:t.muted,settings:t.getSettings?.()}))}};
      }).catch(error => ({diagnosticError:error.message}));
      await testInfo.attach('camera-startup', {body:JSON.stringify(diagnostic,null,2),contentType:'application/json'});
      console.log('CAMERA STARTUP FAILURE ' + JSON.stringify(diagnostic));
    }
  }, {auto:true}]
});
export {expect};
