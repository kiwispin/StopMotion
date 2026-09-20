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
  return {quality, encodeFrame, cacheStats, lazyFrame, vp8Payload, drawContained};
})();
