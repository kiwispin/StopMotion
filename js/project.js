'use strict';

window.stopProject = (() => {
  const format = 'stopmotion-project';
  const maxBytes = stopFrames.maxBytes;
  const legacyMaxBytes = 512 * 1024 * 1024;
  const magic = 'STOPMOT2', headerBytes = 12, maxMetadataBytes = 1024 * 1024;
  async function snapshot(an) {
    const metadata = {format, version: 1, width: an.w, height: an.h,
      fps: an.playbackSpeed, flip: an._flip, onionOpacity: an.onionOpacity ?? 50,
      holds: an.holds.slice(), name: an.name || ''};
    validate({...metadata, frames: an.frames});
    if (an.frames.some(frame => frame.width !== metadata.width || frame.height !== metadata.height))
      throw new Error('Frame dimensions do not match the project.');
    const data = {...metadata, frames: an.frames.map(frame => frame.png)};
    validateMedia(data);
    return data;
  }
  function validate(data) {
    if (!data || data.format !== format || data.version !== 1 ||
        !Number.isInteger(data.width) || !Number.isInteger(data.height) ||
        data.width < 1 || data.height < 1 || data.width > 4096 || data.height > 4096 ||
        !Number.isFinite(data.fps) || data.fps < 1 || data.fps > 120 ||
        (data.onionOpacity !== undefined && (!Number.isFinite(data.onionOpacity) || data.onionOpacity < 0 || data.onionOpacity > 100)) ||
        typeof data.flip !== 'boolean' || typeof data.name !== 'string' || data.name.length > 200 ||
        !Array.isArray(data.frames) || data.frames.length > 2000 ||
        !stopFrames.dimensions(data.width, data.height))
      throw new Error('Invalid or unsupported project.');
    if (data.holds !== undefined && !stopTimeline.validHolds(data.holds, data.frames.length))
      throw new Error('Invalid holds: one integer 1–120 per frame, maximum 24,000 exposures.');
  }
  function validateMedia(data) {
    validate(data);
    let bytes = 0;
    for (const blob of data.frames) {
      if (!(blob instanceof Blob) || !blob.size) throw new Error('Invalid project media.');
      bytes += blob.size;
    }
    if (bytes > maxBytes)
      throw new Error('Unsupported project media or project too large.');
    if (data.frames.some(blob => blob.type !== 'image/png'))
      throw new Error('Project frames must be PNG.');
  }
  async function prepare(data) {
    validateMedia(data);
    const frames = [];
    for (const blob of data.frames) {
      if (blob.type !== 'image/png') throw new Error('Project frames must be PNG.');
      frames.push(await stopFrames.fromPNG(blob, data.width, data.height));
    }
    // Validated PNG originals can be recovered even when optional video encoding fails.
    const webps = frames.map(frame => stopMedia.lazyFrame(frame));
    return {data, frames, webps};
  }
  function apply(an, prepared) {
    const {data, frames, webps} = prepared;
    an.invalidateProject();
    an.endPlay();
    an.dimensionsLocked = true;
    an.setDimensions(data.width, data.height);
    an.playCanvas.width = data.width; an.playCanvas.height = data.height;
    an.frames = frames; an.frameWebps = webps.slice();
    an.holds = data.holds ? data.holds.slice() : frames.map(() => 1);
    an.playbackSpeed = data.fps; an._flip = data.flip; an.name = data.name;
    an.onionOpacity = data.onionOpacity ?? 50;
    an.snapshotContext.clearRect(0, 0, an.w, an.h);
    if (frames.length) an.drawFrame(frames.length - 1, an.snapshotContext);
    an.timeline?.reset();
  }
  function fromURL(value) {
    if (typeof value !== 'string' || value.length > legacyMaxBytes)
      throw new Error('Invalid media encoding.');
    const match = /^data:([^,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
    if (!match) throw new Error('Invalid media encoding.');
    return new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], {type: match[1]});
  }
  async function portable(data) {
    validateMedia(data);
    const descriptor = blob => ({size:blob.size, type:blob.type});
    const metadata = new Blob([JSON.stringify({...data, version:2,
      frames:data.frames.map(descriptor)})]);
    if (metadata.size > maxMetadataBytes) throw new Error('Project metadata exceeds 1 MiB.');
    const header = new Uint8Array(headerBytes);
    header.set(new TextEncoder().encode(magic));
    new DataView(header.buffer).setUint32(8, metadata.size, true);
    // Blob parts retain binary PNG payloads: no base64 or giant JS string.
    return new Blob([header, metadata, ...data.frames], {type:'application/x-stopmotion'});
  }
  async function parse(file) {
    if (!Number.isSafeInteger(file.size) || file.size > maxBytes + headerBytes + maxMetadataBytes)
      throw new Error('Project file exceeds the 2 GiB media budget.');
    const header = await file.slice(0, headerBytes).arrayBuffer();
    if (new TextDecoder().decode(header.slice(0, 8)) === magic) {
      if (header.byteLength !== headerBytes) throw new Error('Truncated project header.');
      const length = new DataView(header).getUint32(8, true);
      if (!length || length > maxMetadataBytes || headerBytes + length > file.size)
        throw new Error('Invalid project metadata length.');
      const data = JSON.parse(await file.slice(headerBytes, headerBytes + length).text());
      if (data.version !== 2) throw new Error('Unsupported binary project version.');
      validate({...data, version:1});
      const descriptors = data.frames;
      let mediaBytes = 0;
      for (const entry of descriptors) {
        if (!entry || !Number.isSafeInteger(entry.size) || entry.size <= 0 ||
            entry.type !== 'image/png')
          throw new Error('Invalid binary media descriptor.');
        mediaBytes += entry.size;
        if (!Number.isSafeInteger(mediaBytes) || mediaBytes > maxBytes)
          throw new Error('Project media exceeds 2 GiB.');
      }
      let offset = headerBytes + length;
      if (offset + mediaBytes !== file.size) throw new Error('Truncated project or unexpected trailing bytes.');
      // Validate every length/type and the exact end BEFORE slicing or decoding.
      const media = descriptors.map(entry => {
        const blob = file.slice(offset, offset + entry.size, entry.type);
        offset += entry.size;
        return blob;
      });
      return prepare({...data, version:1, frames:media});
    }
    if (file.size > legacyMaxBytes) throw new Error('Legacy JSON project exceeds 512 MiB.');
    const data = JSON.parse(await file.text());
    validate(data);
    data.frames = data.frames.map(fromURL);
    return prepare(data);
  }
  function connect(an) {
    const status = document.getElementById('project-status');
    const retry = document.getElementById('retrySave');
    const input = document.getElementById('projectFile');
    let initialized = false, busy = false, recoveryProtected = false;
    let revision = 0, tail = Promise.resolve(), persistenceError = '';
    let active = false, latest = null;
    const controls = [...document.querySelectorAll('#top-container button, #top-container input, #project-controls button, #saveDialog input, #saveConfirmButton')];
    function lock(value) {
      if (value) { an.invalidateProject(); an.cancelProjectActivity?.(); an.endPlay(); }
      busy = value; an.projectBusy = value;
      controls.forEach(control => { control.disabled = value; });
      an.timeline?.updateControls();
      if (!value) an.syncCameraDimensions();
    }
    function report(message, error = false) {
      if (error) persistenceError = message;
      status.textContent = persistenceError && persistenceError !== message ?
        message + ' ' + persistenceError : message;
      retry.hidden = !persistenceError || recoveryProtected;
    }
    function refresh() {
      an.refreshSummary?.();
      an.timeline?.render();
      const slider = document.getElementById('playbackSpeed');
      slider.min = 1; slider.max = 120; slider.step = 'any'; slider.value = an.playbackSpeed;
      document.getElementById('fps').textContent = an.playbackSpeed.toFixed(1);
      an.video.classList.toggle('rotated', an._flip);
    }
    function changed() {
      an.refreshSummary?.();
      if (!initialized || busy || an.loadInProgress) return;
      if (recoveryProtected) {
        report('Recovery data protected. Save Project for your current work; Clear or Open Project to intentionally replace stored data.');
        return;
      }
      const current = ++revision;
      // Snapshot immutable blobs/settings now. Only the latest waiting snapshot
      // survives; an active IndexedDB transaction is never overlapped.
      const pending = snapshot(an);
      pending.catch(() => {});
      report('Saving…');
      latest = {current, pending};
      if (active) return;
      active = true;
      tail = (async () => {
        while (latest) {
          const work = latest; latest = null;
          try {
            await projectStorage.write(await work.pending);
            if (work.current === revision) { persistenceError = ''; report('Saved on this device'); }
          } catch (error) {
            const detail = error?.message || error?.name || String(error);
            if (work.current === revision) {
              const message = error?.name === 'QuotaExceededError' ?
                'Autosave failed: Browser storage limit reached (QuotaExceededError). ' +
                'Save Project now before closing or reloading. For large projects, use a normal ' +
                '(non-private) window with available storage. Last saved project retained.' :
                'Autosave failed: ' + detail + ' Last saved project retained. ' +
                'Save Project or Retry autosave after resolving the error.';
              report(message, true);
            }
          }
        }
        active = false;
      })();
    }
    an.onProjectChange = changed;
    an.onProjectReset = () => { recoveryProtected = false; persistenceError = ''; changed(); };
    an.onProjectLoaded = () => { refresh(); changed(); };
    retry.onclick = changed;
    document.getElementById('saveProject').onclick = async () => {
      try {
        const blob = await portable(await snapshot(an));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url;
        link.download = 'StopMotion.stopmotion'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { report('Project download failed: ' + error.message, true); }
    };
    document.getElementById('openProject').onclick = () => input.click();
    input.onchange = async () => {
      const file = input.files[0]; input.value = '';
      if (!file || busy) return;
      if (an.loadInProgress) { report('Wait for WebM import to finish before opening a project.'); return; }
      lock(true); report('Opening project…');
      try {
        const prepared = await parse(file);
        apply(an, prepared); refresh();
        recoveryProtected = false; persistenceError = '';
        lock(false); changed();
      } catch (error) {
        report('Project not opened. Current project preserved: ' + error.message);
      } finally { lock(false); }
    };
    lock(true); report('Recovering project…');
    const ready = (async () => {
      try {
        const stored = await projectStorage.read();
        if (stored) { apply(an, await prepare(stored)); refresh(); }
        report(stored ? 'Recovered saved project' : 'Ready — changes save automatically');
      } catch (error) {
        recoveryProtected = true;
        report('Recovery unavailable. Stored data is protected until Clear or Open Project. Save Project to keep current work.', true);
      } finally { initialized = true; lock(false); }
    })();
    return {ready, changed, refresh, flushed: () => tail,
      queueState: () => ({active: Number(active), pending: Number(!!latest)})};
  }
  return {connect};
})();
