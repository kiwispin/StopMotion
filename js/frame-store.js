'use strict';

// Immutable compressed originals; decoded images are leased serially to prevent
// eviction while a draw or asynchronous encoder still uses the image.
window.stopFrames = (() => {
  const maxBytes = 2 * 1024 * 1024 * 1024, maxPixels = 16 * 1024 * 1024, maxEntries = 8;
  const cache = new Map();
  let pixels = 0, peakPixels = 0, peakEntries = 0, closed = 0;
  let epoch = 0, queue = Promise.resolve();
  const dimensions = (w, h) => Number.isInteger(w) && Number.isInteger(h) &&
    w > 0 && h > 0 && w <= 4096 && h <= 4096 && w * h <= maxPixels;
  const bytes = frames => frames.reduce((n, f) => n + f.png.size, 0);
  function thumbnail(source) {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 72;
    stopMedia.drawContained(canvas.getContext('2d'), source, 96, 72);
    return canvas;
  }
  async function fromCanvas(canvas) {
    if (!dimensions(canvas.width, canvas.height)) throw new Error('Unsupported frame dimensions.');
    const width = canvas.width, height = canvas.height;
    const png = await new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob?.type === 'image/png' && blob.size) resolve(blob);
      else reject(new Error('PNG capture failed; no frame was added.'));
    }, 'image/png'));
    if (png.size > maxBytes) throw new Error('Frame exceeds compressed media budget.');
    return Object.freeze({width, height, png, thumbnail: thumbnail(canvas)});
  }
  async function fromPNG(png, width, height) {
    if (!dimensions(width, height) || png?.type !== 'image/png' || !png.size || png.size > maxBytes)
      throw new Error('Invalid PNG frame.');
    const image = await createImageBitmap(png);
    try {
      if (image.width !== width || image.height !== height)
        throw new Error('Frame dimensions do not match the project.');
      return Object.freeze({width, height, png, thumbnail: thumbnail(image)});
    } finally { image.close(); }
  }
  function remove(record) {
    cache.get(record).close(); closed++;
    pixels -= record.width * record.height; cache.delete(record);
  }
  function use(record, callback, current = () => true) {
    const generation = epoch;
    const result = queue.then(async () => {
      if (generation !== epoch || !current()) return false;
      let image = cache.get(record);
      if (!image) {
        if (!dimensions(record.width, record.height)) throw new Error('Unsupported frame dimensions.');
        const size = record.width * record.height;
        while (cache.size && (cache.size >= maxEntries || pixels + size > maxPixels))
          remove(cache.keys().next().value);
        image = await createImageBitmap(record.png);
        if (generation !== epoch || !current()) { image.close(); closed++; return false; }
        cache.set(record, image); pixels += size;
        peakEntries = Math.max(peakEntries, cache.size); peakPixels = Math.max(peakPixels, pixels);
      } else { cache.delete(record); cache.set(record, image); }
      return callback(image);
    });
    queue = result.catch(() => {});
    return result;
  }
  function clear() {
    epoch++;
    const result = queue.then(() => { for (const record of cache.keys()) remove(record); });
    queue = result.catch(() => {});
    return result;
  }
  const stats = () => ({entries:cache.size, pixels, peakEntries, peakPixels, maxEntries, maxPixels, closed});
  return {fromCanvas, fromPNG, use, clear, stats, dimensions, bytes, maxBytes, maxPixels};
})();
