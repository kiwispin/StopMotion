'use strict';

window.stopMedia = (() => {
  // Below 1 deliberately: browsers may choose lossless VP8L at quality 1.
  const quality = 0.98;
  function vp8Payload(buffer) {
    const bytes = new Uint8Array(buffer);
    const text = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (bytes.length < 20 || text(0) !== 'RIFF' || text(8) !== 'WEBP')
      throw new Error('WebM export requires a supported WebP/VP8 encoder. Save Project preserves your originals.');
    const view = new DataView(buffer);
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      if (offset + 8 + size > bytes.length) break;
      if (text(offset) === 'VP8L')
        throw new Error('Lossless VP8L cannot be used as VP8 video. Save Project preserves your originals.');
      if (text(offset) === 'VP8 ' && size > 0) return bytes.slice(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    throw new Error('WebP contains no supported VP8 video frame.');
  }
  // A single most-recent compressed frame reuses holds and transport copies.
  // Its identity key never retains a full canvas; active exports have separate memory.
  const maxBytes = 16 * 1024 * 1024;
  const keys = new WeakMap(), pending = new WeakMap();
  let cachedKey = null, cachedBlob = null, cachedQuality = null, calls = 0, inFlight = 0;
  function encodeFrame(canvas, level = quality) {
    level = Number.isFinite(level) ? level : quality;
    if (!keys.has(canvas)) keys.set(canvas, {});
    const key = keys.get(canvas);
    if (key === cachedKey && level === cachedQuality) return Promise.resolve(cachedBlob);
    const request = pending.get(canvas);
    if (request && request.level === level) return request.promise;
    calls++; inFlight++;
    const compress = source => new Promise((resolve, reject) => {
        source.toBlob(blob => {
          if (!blob || blob.type !== 'image/webp') {
            reject(new Error('WebP encoding failed. Try export again or Save Project for a lossless backup.'));
            return;
          }
          blob.arrayBuffer().then(buffer => { vp8Payload(buffer); return blob; }).then(resolve, reject);
        }, 'image/webp', level);
    });
    const encoded = canvas.png ? stopFrames.use(canvas, image => {
      const surface = document.createElement('canvas');
      surface.width = canvas.width; surface.height = canvas.height;
      surface.getContext('2d').drawImage(image, 0, 0);
      return surface;
    }).then(surface => compress(surface).finally(() => { surface.width = surface.height = 0; }))
      : compress(canvas);
    const result = encoded.then(blob => {
      if (!blob) throw new Error('Export cancelled by project replacement.');
      if (blob.size <= maxBytes) { cachedKey = key; cachedBlob = blob; cachedQuality = level; }
      return blob;
    });
    pending.set(canvas, {level, promise: result});
    result.then(() => { pending.delete(canvas); inFlight--; }, () => { pending.delete(canvas); inFlight--; });
    return result;
  }
  function mp4MimeType() {
    if (typeof MediaRecorder !== 'function' ||
        typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
    const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4'];
    if (typeof MediaRecorder.isTypeSupported !== 'function') return types[1];
    return types.find(type => MediaRecorder.isTypeSupported(type)) || null;
  }
  async function encodeMp4(sequence, width, height, fps, options = {}) {
    const mimeType = mp4MimeType();
    if (!mimeType)
      throw new Error('MP4 export is not supported on this device. Save Project preserves your originals.');
    if (!sequence.length || !Number.isFinite(fps) || fps <= 0)
      throw new Error('Invalid MP4 export settings.');

    const check = options.check || (() => {});
    const progress = options.onProgress || (() => {});
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    const draw = (frame, targetTime) => stopFrames.use(frame, async image => {
      if (Number.isFinite(targetTime)) {
        const delay = targetTime - performance.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      }
      check();
      drawContained(context, image, width, height);
      check();
    }, () => {
      try { check(); return true; } catch { return false; }
    });

    // Seed the stream before starting the recorder. Older Safari versions may not
    // dispatch MediaRecorder's start event until the canvas has produced a frame.
    await draw(sequence[0]);
    check();
    const stream = canvas.captureStream(fps);
    const tracks = stream.getTracks();
    const videoTrack = stream.getVideoTracks()[0];
    const chunks = [];
    const level = Number.isFinite(options.quality) ? options.quality : quality;
    const pixelsPerSecond = width * height * fps;
    const bitsPerSecond = Math.round(Math.max(2_000_000,
      Math.min(20_000_000, pixelsPerSecond * 0.35 * (level >= 0.95 ? 1 : 0.65))));
    let recorder;
    try {
      try { recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: bitsPerSecond}); }
      catch { recorder = new MediaRecorder(stream, {mimeType}); }
      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size) chunks.push(event.data);
      });
      let recorderFailure = null;
      const recorderError = new Promise((_, reject) => recorder.addEventListener('error', event => {
        recorderFailure = event.error || new Error('MP4 encoder failed.');
        reject(recorderFailure);
      }, {once: true}));
      recorderError.catch(() => {});
      const checkRecorder = () => { if (recorderFailure) throw recorderFailure; };
      const withTimeout = (promise, milliseconds, message) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), milliseconds);
        promise.then(value => { clearTimeout(timer); resolve(value); }, error => {
          clearTimeout(timer); reject(error);
        });
      });
      const started = new Promise(resolve => recorder.addEventListener('start', resolve, {once: true}));
      recorder.start();
      await Promise.race([withTimeout(started, 5000, 'MP4 encoder did not start.'), recorderError]);
      checkRecorder();
      check();

      const interval = 1000 / fps;
      const zero = performance.now();
      for (let i = 0; i < sequence.length; i++) {
        checkRecorder();
        if (i) {
          check();
          await draw(sequence[i], zero + i * interval);
          videoTrack?.requestFrame?.();
        }
        progress({phase: 'recording', done: i + 1, total: sequence.length});
      }
      // Add one identical final sample just before the intended end. MediaRecorder
      // otherwise gives its last sample only a nominal duration, shortening short films.
      const tailSampleDelay = zero + sequence.length * interval - Math.min(50, interval / 4) - performance.now();
      if (tailSampleDelay > 0) await new Promise(resolve => setTimeout(resolve, tailSampleDelay));
      checkRecorder();
      check();
      await draw(sequence[sequence.length - 1]);
      videoTrack?.requestFrame?.();
      const tailDelay = zero + sequence.length * interval - performance.now();
      if (tailDelay > 0) await new Promise(resolve => setTimeout(resolve, tailDelay));
      check();
      progress({phase: 'finishing', done: sequence.length, total: sequence.length});
      const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, {once: true}));
      recorder.stop();
      await Promise.race([withTimeout(stopped, 15000, 'MP4 encoder did not finish.'), recorderError]);
      check();
      const blob = new Blob(chunks, {type: recorder.mimeType || mimeType});
      if (!blob.size) throw new Error('MP4 encoder produced an empty movie.');
      return blob;
    } finally {
      if (recorder?.state && recorder.state !== 'inactive') recorder.stop();
      tracks.forEach(track => track.stop());
      canvas.width = canvas.height = 0;
    }
  }
  const cacheStats = () => ({bytes:cachedBlob?.size || 0, maxBytes, entries:cachedBlob ? 1 : 0, inFlight, calls});
  // History may retain these handles; they retain no encoded blob after awaiting.
  function lazyFrame(canvas) {
    return {then:(resolve,reject) => window.stopMedia.encodeFrame(canvas).then(resolve,reject)};
  }
  function drawContained(context, source, width, height, noUpscale = false) {
    const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
    const scale = Math.min(width / sw, height / sh, noUpscale ? 1 : Infinity);
    context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
    context.drawImage(source, (width - sw * scale) / 2, (height - sh * scale) / 2, sw * scale, sh * scale);
  }
  function drawCamera(context, source, width, height) {
    const sw = source.videoWidth, sh = source.videoHeight;
    if (sh > sw && width > height) {
      // The same centered landscape window shown by the live preview's cover fit.
      const cropHeight = sw * height / width;
      context.drawImage(source, 0, (sh - cropHeight) / 2, sw, cropHeight, 0, 0, width, height);
    } else drawContained(context, source, width, height, true);
  }
  return {quality, encodeFrame, encodeMp4, mp4MimeType, cacheStats, lazyFrame, vp8Payload, drawContained, drawCamera};
})();
