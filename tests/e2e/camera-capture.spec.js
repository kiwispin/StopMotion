import { test, expect } from './fixtures.js';

const cameraDevices = [
  {kind: 'videoinput', deviceId: 'camera-a', label: 'Camera A'},
  {kind: 'videoinput', deviceId: 'camera-b', label: 'Camera B'}
];

test.beforeEach(async ({page}) => {
  page.__stopMotionPageErrors = [];
  page.on('pageerror', error => {
    page.__stopMotionPageErrors.push(error.message);
  });
  page.on('console', message => {
    if (message.type() === 'error')
      page.__stopMotionPageErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__stopMotionUnhandled = [];
    window.addEventListener('unhandledrejection', event => {
      window.__stopMotionUnhandled.push(String(event.reason));
    });
  });
});

test.afterEach(async ({page}) => {
  expect(page.__stopMotionPageErrors).toEqual([]);
  if (!page.isClosed()) {
    await expect.poll(() => page.evaluate(() => __stopMotionUnhandled || []))
        .toEqual([]);
  }
});

async function installCameraStubs(
    page, devices = cameraDevices, afterPermissionDevices = null) {
  await page.addInitScript(({devices, afterPermissionDevices}) => {
    const mediaState = {readyState: 0, videoWidth: 0, videoHeight: 0};
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => mediaState.readyState
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => mediaState.videoWidth
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => mediaState.videoHeight
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get() {
        return this.__stopMotionSrcObject || null;
      },
      set(value) {
        this.__stopMotionSrcObject = value;
      }
    });
    HTMLMediaElement.prototype.play = () => Promise.resolve();

    const requests = [];
    let enumeratedDevices = devices;
    const makeStream = (label, trackStates = ['live'], kind = 'video') => {
      const tracks = trackStates.map((readyState, index) => ({
        kind,
        readyState,
        stopped: false,
        stop() {
          this.stopped = true;
          this.readyState = 'ended';
        }
      }));
      return {
        label,
        active: true,
        getTracks: () => tracks,
        getVideoTracks: () => kind === 'video' ? tracks : [],
        getAudioTracks: () => kind === 'audio' ? tracks : []
      };
    };
    const mediaDevices = {
      enumerateDevices: async () => enumeratedDevices,
      getUserMedia: constraints => new Promise((resolve, reject) => {
        requests.push({constraints, resolve, reject, stream: null});
      })
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices
    });
    window.__camera = {
      requests,
      mediaState,
      resolve(index, label, trackStates = ['live']) {
        const request = requests[index];
        const kind = request.constraints.audio === true &&
            request.constraints.video === false ? 'audio' : 'video';
        const stream = makeStream(label, trackStates, kind);
        request.stream = stream;
        if (afterPermissionDevices)
          enumeratedDevices = afterPermissionDevices;
        request.resolve(stream);
      },
      reject(index, name) {
        requests[index].reject({name});
      }
    };
  }, {devices, afterPermissionDevices});
}

async function openWithPendingCamera(
    page, devices = cameraDevices, afterPermissionDevices = null) {
  await installCameraStubs(page, devices, afterPermissionDevices);
  await page.goto('/');
  if (devices.length > 1)
    await expect(page.locator('#camera-select')).toBeVisible();
  await expect.poll(() => page.evaluate(() => __camera.requests.length)).toBe(1);
}

async function resolveCamera(page, index = 0, label = 'active') {
  await page.evaluate(({index, label}) => __camera.resolve(index, label),
      {index, label});
  await expect.poll(() => page.evaluate(() =>
    document.getElementById('video').srcObject?.label)).toBe(label);
}

test('uses modern constraints and invalidates stale camera selections', async ({page}) => {
  await openWithPendingCamera(page);

  const constraints = await page.evaluate(() => __camera.requests[0].constraints);
  expect(constraints.audio).toBe(false);
  expect(constraints.video.deviceId).toEqual({exact: 'camera-a'});
  expect(constraints.video.width).toEqual({ideal: 1280});
  expect(constraints.video.height).toEqual({ideal: 720});
  expect(constraints.video.frameRate).toEqual({ideal: 15});

  await page.locator('#camera-select').selectOption('camera-b');
  await expect.poll(() => page.evaluate(() => __camera.requests.length)).toBe(2);
  await resolveCamera(page, 1, 'newer');
  await page.evaluate(() => __camera.resolve(0, 'stale'));

  await expect.poll(() => page.evaluate(() =>
    __camera.requests[0].stream.getTracks()[0].stopped)).toBe(true);
  const result = await page.evaluate(() => ({
    current: document.getElementById('video').srcObject.label,
    staleStopped: __camera.requests[0].stream.getTracks()[0].stopped,
    newerStopped: __camera.requests[1].stream.getTracks()[0].stopped
  }));
  expect(result).toEqual({
    current: 'newer',
    staleStopped: true,
    newerStopped: false
  });
});

test('turning camera off while a request is pending prevents reattachment', async ({page}) => {
  await openWithPendingCamera(page);
  await page.locator('#toggleButton').click();
  await page.evaluate(() => __camera.resolve(0, 'late'));

  await expect.poll(() => page.evaluate(() =>
    __camera.requests[0].stream.getTracks()[0].stopped)).toBe(true);
  const result = await page.evaluate(() => ({
    current: document.getElementById('video').srcObject,
    streamOn: main.animator.streamOn,
    requestCount: __camera.requests.length
  }));
  expect(result.current).toBeNull();
  expect(result.streamOn).toBe(false);
  expect(result.requestCount).toBe(1);
});

test('permission failure exposes a retry that can recover the camera', async ({page}) => {
  await openWithPendingCamera(page);
  await page.evaluate(() => __camera.reject(0, 'NotAllowedError'));

  await expect(page.locator('#retryCameraButton')).toBeVisible();
  await expect(page.locator('#video-message')).toHaveText(
      'Camera permission was denied. Allow access, then retry.');
  await page.locator('#retryCameraButton').click();
  await expect.poll(() => page.evaluate(() => __camera.requests.length)).toBe(2);
  await resolveCamera(page, 1, 'retried');

  await expect(page.locator('#retryCameraButton')).toBeHidden();
  await expect(page.locator('#video-message')).toHaveText('');
});

test('refreshes cameras revealed after permission without reattaching the active stream', async ({page}) => {
  const initiallyHiddenCamera = [
    {kind: 'videoinput', deviceId: 'camera-a', label: ''}
  ];
  const camerasAfterPermission = [
    {kind: 'videoinput', deviceId: 'camera-a', label: 'Camera A'},
    {kind: 'videoinput', deviceId: 'camera-b', label: 'Camera B'}
  ];
  await openWithPendingCamera(page, initiallyHiddenCamera, camerasAfterPermission);
  await resolveCamera(page, 0, 'active');

  await expect(page.locator('#camera-select')).toBeVisible();
  await expect(page.locator('#camera-select option')).toHaveCount(2);
  await expect(page.locator('#camera-select option').nth(1)).toHaveText('Camera B');
  expect(await page.locator('#camera-select').inputValue()).toBe('camera-a');
  expect(await page.evaluate(() => __camera.requests.length)).toBe(1);

  await page.locator('#camera-select').selectOption('camera-b');
  await expect.poll(() => page.evaluate(() => __camera.requests.length)).toBe(2);
  const constraints = await page.evaluate(() => __camera.requests[1].constraints);
  expect(constraints.video.deviceId).toEqual({exact: 'camera-b'});
});

test('capture does not mutate frames or thumbnails without a live ready frame', async ({page}) => {
  await openWithPendingCamera(page);
  await resolveCamera(page);

  await page.locator('#captureButton').click();
  let result = await page.evaluate(() => ({
    frames: main.animator.frames.length,
    thumbnails: document.querySelectorAll('#thumbnail-container canvas').length
  }));
  expect(result).toEqual({frames: 0, thumbnails: 0});

  await page.evaluate(() => {
    __camera.mediaState.readyState = 4;
    __camera.mediaState.videoWidth = 640;
    __camera.mediaState.videoHeight = 480;
    main.animator.loadInProgress = true;
  });
  await page.locator('#captureButton').click();
  result = await page.evaluate(() => ({
    frames: main.animator.frames.length,
    thumbnails: document.querySelectorAll('#thumbnail-container canvas').length
  }));
  expect(result).toEqual({frames: 0, thumbnails: 0});

  await page.evaluate(async () => {
    main.animator.loadInProgress = false;
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    main.animator.frames = [await stopFrames.fromCanvas(canvas)];
    canvas.width = canvas.height = 0;
    main.animator.frameWebps = [Promise.resolve(new Blob())];
    main.animator.startPlay();
  });
  await page.locator('#captureButton').click();
  result = await page.evaluate(() => ({
    frames: main.animator.frames.length,
    thumbnails: document.querySelectorAll('#thumbnail-container canvas').length
  }));
  expect(result).toEqual({frames: 1, thumbnails: 0});
  await page.evaluate(() => main.animator.endPlay());
});

test('ended video tracks cannot be captured even when the stream remains active', async ({page}) => {
  await openWithPendingCamera(page);
  await page.evaluate(() => __camera.resolve(0, 'ended', ['ended']));
  await expect.poll(() => page.evaluate(() =>
    document.getElementById('video').srcObject?.label)).toBe('ended');
  await page.evaluate(() => {
    __camera.mediaState.readyState = 4;
    __camera.mediaState.videoWidth = 640;
    __camera.mediaState.videoHeight = 480;
  });
  await page.locator('#captureButton').click();

  await expect.poll(() => page.evaluate(() => main.animator.frames.length)).toBe(0);
  await expect(page.locator('#thumbnail-container canvas')).toHaveCount(0);
});

test('import failure paths clear the capture guard', async ({page}) => {
  await openWithPendingCamera(page);
  await resolveCamera(page);

  const results = await page.evaluate(async () => {
    const animator = main.animator;
    const originalFileReader = window.FileReader;
    const originalDecode = webm.decode;
    const run = mode => new Promise(resolve => {
      class TestFileReader extends EventTarget {
        constructor() {
          super();
          this.result = null;
        }

        readAsArrayBuffer() {
          queueMicrotask(() => {
            if (mode === 'abort' || mode === 'error') {
              this.dispatchEvent(new Event(mode));
              return;
            }
            this.result = new ArrayBuffer(0);
            this.dispatchEvent(new Event('load'));
          });
        }
      }
      Object.defineProperty(window, 'FileReader', {
        configurable: true,
        value: TestFileReader
      });
      webm.decode = mode === 'zero' ? () => {} : () => {
        throw new Error('malformed input');
      };
      animator.load({name: `${mode}.webm`}, () => resolve(true));
    });

    const values = {};
    for (const mode of ['throw', 'zero', 'error', 'abort']) {
      values[mode] = await run(mode);
      values[`${mode}Guard`] = animator.loadInProgress;
    }
    animator.loadInProgress = true;
    animator.loadFinished();
    values.successGuard = animator.loadInProgress;
    window.FileReader = originalFileReader;
    webm.decode = originalDecode;
    return values;
  });

  expect(results).toEqual({
    throw: true,
    throwGuard: false,
    zero: true,
    zeroGuard: false,
    error: true,
    errorGuard: false,
    abort: true,
    abortGuard: false,
    successGuard: false
  });
});

test('pagehide stops every camera track and detaches the stream', async ({page}) => {
  await openWithPendingCamera(page);
  await page.evaluate(() => __camera.resolve(0, 'pagehide', ['live', 'live', 'live']));
  await expect.poll(() => page.evaluate(() =>
    document.getElementById('video').srcObject?.label)).toBe('pagehide');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  const result = await page.evaluate(() => ({
    stopped: __camera.requests[0].stream.getTracks().map(track => track.stopped),
    current: document.getElementById('video').srcObject
  }));
  expect(result.stopped).toEqual([true, true, true]);
  expect(result.current).toBeNull();
});

test('Chromium fake camera captures frames, thumbnails, and a decodable WebM', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => {
    const video = document.getElementById('video');
    return main.animator.streamOn && video.readyState >= 2 &&
        video.videoWidth > 0 && video.videoHeight > 0;
  }), {timeout: 10000}).toBe(true);

  for (let index = 1; index <= 3; index++) {
    await page.locator('#captureButton').click();
    await expect.poll(() => page.evaluate(() => ({
      frames: main.animator.frames.length,
      thumbnails: document.querySelectorAll('#thumbnail-container canvas').length
    }))).toEqual({frames: index, thumbnails: index});
  }

  const exportResult = await page.evaluate(async () => {
    const animator = main.animator;
    await Promise.all(animator.frameWebps);
    const blob = await animator.encode('camera-smoke');
    const buffer = await blob.arrayBuffer();
    let dimensions = null;
    let decodedFrames = 0;
    let decodedFrameRate = null;
    webm.decode(buffer,
        (width, height) => { dimensions = {width, height}; },
        frameRate => { decodedFrameRate = frameRate; },
        () => { decodedFrames++; });
    animator.startPlay();
    const playing = animator.isPlaying();
    animator.endPlay();
    return {
      type: blob.type,
      size: blob.size,
      dimensions,
      decodedFrames,
      decodedFrameRate,
      playing,
      expectedDimensions: {width: animator.w, height: animator.h}
    };
  });
  expect(exportResult.type).toBe('video/webm');
  expect(exportResult.size).toBeGreaterThan(0);
  expect(exportResult.dimensions).toEqual(exportResult.expectedDimensions);
  expect(exportResult.decodedFrames).toBeGreaterThanOrEqual(3);
  expect(exportResult.decodedFrameRate).toBeGreaterThan(0);
  expect(exportResult.playing).toBe(true);
});
