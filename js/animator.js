/* -*- mode: javascript; js-indent-level: 2 -*- */

// Copyright 2022 Stefan Zager <szager@gmail.com>
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

var animator = animator || {};

(() => {
  const STATE_IDLE = 0;
  const STATE_PLAY = 1;

  class Animator {
    constructor(video, snapshotCanvas, playCanvas, messageDiv, retryButton) {
      this.video = video;
      this.videoStream = null;
      this.snapshotCanvas = snapshotCanvas;
      this.snapshotContext = snapshotCanvas.getContext('2d');
      this.playCanvas = playCanvas;
      this.playContext = playCanvas.getContext('2d');
      this.playTimer = null;
      this._flip = false;
      this.messageDiv = messageDiv;
      this.playbackSpeed = 24.0;
      this.frames = [];
      this.frameWebps = [];
      this.holds = [];
      this.streamOn = false;
      this.name = null;
      this.framesInFlight = 0;
      this.loadInProgress = false;
      this.loadFinishPending = false;
      this.retryButton = retryButton || null;
      this.cameraRequestId = 0;
      this.cameraRequestPending = false;
      this.cameraErrorSourceId = null;
      this.videoSourceId = null;
      this.dimensionsLocked = false;
      this.projectGeneration = 0;
      this.drawGenerations = new Map();
      this.playGeneration = 0;
      this.captureBusy = false;
      this.captureQueue = [];
      this.captureActive = null;
      this.captureDraining = false;
      this.video.addEventListener('loadedmetadata', () => this.syncCameraDimensions());
      this.video.addEventListener('loadeddata', () => this.syncCameraDimensions());
      this.video.addEventListener('resize', () => this.syncCameraDimensions());
      this.setDimensions(snapshotCanvas.width, snapshotCanvas.height);
      this.zeroPlayTime = 0;
      this.setCameraMessage('');
    }

    setPlaybackSpeed(speed) {
      if (this.isPlaying()) { this.cancelProjectActivity?.(); this.endPlay(); }
      if (speed > 0)
        this.playbackSpeed = speed;
      this.onProjectChange?.();
    }

    setCameraMessage(message, retrySourceId) {
      this.messageDiv.innerText = message || "";
      this.cameraErrorSourceId = message ? retrySourceId : null;
      if (this.retryButton)
        this.retryButton.hidden = !message;
    }

    cameraErrorMessage(error) {
      if (!error || !error.name)
        return "Cannot connect to camera.";
      switch (error.name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
          return "Camera permission was denied. Allow access, then retry.";
        case "NotFoundError":
        case "DevicesNotFoundError":
          return "No camera was found. Connect a camera, then retry.";
        case "NotReadableError":
        case "TrackStartError":
          return "The camera is already in use. Close other camera apps, then retry.";
        case "OverconstrainedError":
          return "The selected camera does not support the requested settings.";
        case "NotSupportedError":
          return "This browser does not support camera capture.";
        default:
          return "Cannot connect to camera. Check the camera, then retry.";
      }
    }

    videoCannotPlayHandler(error, requestId, sourceId) {
      console.log('navigator.mediaDevices.getUserMedia error: ', error);
      if (requestId !== this.cameraRequestId)
        return null;
      this.cameraRequestPending = false;
      this.streamOn = false;
      this.videoStream = null;
      this.video.srcObject = null;
      this.setCameraMessage(this.cameraErrorMessage(error), sourceId);
      return null;
    }

    showCameraError(error, sourceId) {
      this.setCameraMessage(this.cameraErrorMessage(error), sourceId);
    }

    stopStream(stream) {
      if (!stream || typeof stream.getTracks !== 'function')
        return;
      stream.getTracks().forEach(track => {
        if (track && typeof track.stop === 'function')
          track.stop();
      });
    }

    stopVideoStreams() {
      let streams = [];
      if (this.videoStream)
        streams.push(this.videoStream);
      if (this.video.srcObject && this.video.srcObject !== this.videoStream)
        streams.push(this.video.srcObject);
      streams.forEach(this.stopStream.bind(this));
      this.videoStream = null;
    }

    setDimensions(w, h) {
      this.w = w;
      this.h = h;
      this.video.width = w;
      this.video.height = h;
      this.snapshotCanvas.width = this.w;
      this.snapshotCanvas.height = this.h;
      this.playCanvas.width = w;
      this.playCanvas.height = h;
      this.video.parentElement?.style.setProperty('--stage-ratio', w / h);
      this.refreshSummary?.();
    }

    syncCameraDimensions(notify = true) {
      if (!this.streamOn || this.video.srcObject !== this.videoStream || this.video.readyState < 2) return;
      const w = this.video.videoWidth, h = this.video.videoHeight;
      const settings = this.videoStream?.getVideoTracks()[0]?.getSettings?.();
      // Ignore obsolete metadata while a newly attached stream is still loading.
      if (!w || !h || (settings?.width && settings.width !== w) || (settings?.height && settings.height !== h)) return;
      if (!this.projectBusy && !this.loadInProgress && !this.dimensionsLocked && !this.frames.length &&
          w <= 4096 && h <= 4096 && (w !== this.w || h !== this.h)) {
        this.setDimensions(w, h);
        if (notify) this.onProjectChange?.();
      }
      this.refreshSummary?.();
    }

    flip() {
      this._flip = !this._flip;
      this.onProjectChange?.();
    }

    attachStream(sourceId) {
      const requestId = ++this.cameraRequestId;
      this.cameraRequestPending = true;
      this.videoSourceId = sourceId || null;
      this.setCameraMessage('');
      this.stopVideoStreams();
      this.video.srcObject = null;
      this.streamOn = false;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.resolve(this.videoCannotPlayHandler(
            {name: "NotSupportedError"}, requestId, sourceId));
      }
      let constraints = {
        audio: false,
        video: {
          width: {ideal: 1280},
          height: {ideal: 720},
          frameRate: {ideal: 15}
        }
      };
      if (sourceId)
        constraints.video.deviceId = {exact: sourceId};
      return navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        if (requestId !== this.cameraRequestId) {
          this.stopStream(stream);
          return null;
        }
        this.video.srcObject = stream;
        this.videoStream = stream;
        this.streamOn = true;
        this.cameraRequestPending = false;
        this.setCameraMessage('');
        this.refreshSummary?.();
        this.timeline?.updateControls?.();
        return stream;
      }).catch(error => {
        if (requestId !== this.cameraRequestId)
          return null;
        return this.videoCannotPlayHandler(error, requestId, sourceId);
      });
    }

    detachStream() {
      ++this.cameraRequestId;
      this.cameraRequestPending = false;
      this.video.pause();
      this.stopVideoStreams();
      this.streamOn = false;
      this.video.srcObject = null;
      this.setCameraMessage('');
      this.refreshSummary?.();
      this.timeline?.updateControls?.();
    }

    retryCamera() {
      return this.attachStream(this.cameraErrorSourceId || this.videoSourceId);
    }

    isPlaying() {
      return !!this.playResolve;
    }

    toggleVideo() {
      if (this.streamOn || this.videoStream || this.video.srcObject ||
          this.cameraRequestPending) {
        this.detachStream();
        return Promise.resolve(false);
      }
      return this.attachStream(this.videoSourceId).then(stream => !!stream);
    }

    cancelDraw(context) {
      this.drawGenerations.set(context, (this.drawGenerations.get(context) || 0) + 1);
    }

    invalidateProject() {
      this.projectGeneration++;
      this.cancelDraw(this.snapshotContext);
      this.cancelDraw(this.playContext);
      this.cancelQueuedCaptures();
      stopFrames.clear();
    }

    drawFrame(frameNumber, context) {
      this.cancelDraw(context);
      const token = this.drawGenerations.get(context), frame = this.frames[frameNumber];
      if (!frame) return Promise.resolve(false);
      const current = () => token === this.drawGenerations.get(context);
      return stopFrames.use(frame, image => {
        if (!current()) return false;
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        context.drawImage(image, 0, 0, context.canvas.width, context.canvas.height);
        return true;
      }, current).catch(error => {
        if (current()) document.getElementById('timelineMessage').textContent = 'Frame could not be displayed: ' + error.message;
        return false;
      });
    }

    capture() {
      if (this.projectBusy || !this.streamOn || this.isPlaying() || this.loadInProgress)
        return null;
      let stream = this.videoStream || this.video.srcObject;
      let videoTracks = stream && typeof stream.getVideoTracks === 'function' ?
          stream.getVideoTracks() : [];
      let haveCurrentData = (typeof HTMLMediaElement === 'undefined') ?
          2 : HTMLMediaElement.HAVE_CURRENT_DATA;
      if (!stream || stream.active === false || !videoTracks.length ||
          videoTracks.some(track => track.readyState && track.readyState !== 'live') ||
          this.video.readyState < haveCurrentData ||
          !this.video.videoWidth || !this.video.videoHeight)
        return null;
      const settings = videoTracks[0].getSettings?.();
      if ((settings?.width && settings.width !== this.video.videoWidth) ||
          (settings?.height && settings.height !== this.video.videoHeight)) return null;
      this.syncCameraDimensions(false);
      if (this.captureQueue.length >= 8) {
        document.getElementById('timelineMessage').textContent = 'Still saving the last few shots…';
        return null;
      }
      if (this.frames.length + this.captureQueue.length >= 2000 || !stopFrames.dimensions(this.w, this.h) ||
          stopFrames.bytes(this.frames) >= stopFrames.maxBytes ||
          this.exposures() >= 24000) {
        document.getElementById('timelineMessage').textContent = 'Capture limit reached: 2,000 frames, 24,000 exposures or 2 GiB compressed media. Save Project and start a new project.';
        return null;
      }
      let imageCanvas = document.createElement('canvas');
      imageCanvas.width = this.w;
      imageCanvas.height = this.h;
      let context = imageCanvas.getContext('2d', { alpha: false });
      if (this._flip) {
        context.rotate(Math.PI);
        context.translate(-this.w, -this.h);
      }
      try {
        stopMedia.drawContained(context, this.video, this.w, this.h, true);
      } catch (error) {
        imageCanvas.width = imageCanvas.height = 0;
        return null;
      }
      // The frame is grabbed synchronously; PNG compression runs in the background so
      // the next shot never waits for the previous one to finish encoding.
      const job = {canvas: imageCanvas, generation: this.projectGeneration,
        camera: this.cameraRequestId, cancelled: false};
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      this.captureQueue.push(job);
      this.captureBusy = true;
      this.timeline?.updateControls();
      this.drainCaptures();
      this.onCapture?.();
      this.refreshSummary?.();
      return job.promise;
    }

    cancelQueuedCaptures() {
      for (const job of this.captureQueue) {
        job.cancelled = true;
        job.canvas.width = job.canvas.height = 0;
        job.resolve(null);
      }
      this.captureQueue.length = 0;
      // The active job is left to the drain loop, which resolves it, so awaiting a
      // cancelled capture still means the pipeline has fully stopped.
      if (this.captureActive) this.captureActive.cancelled = true;
    }

    async drainCaptures() {
      if (this.captureDraining) return;
      this.captureDraining = true;
      try {
        while (this.captureQueue.length) {
          const job = this.captureQueue.shift();
          this.captureActive = job;
          let frame = null, error = null;
          try { frame = await stopFrames.fromCanvas(job.canvas); }
          catch (caught) { error = caught; }
          finally { this.captureActive = null; job.canvas.width = job.canvas.height = 0; }
          if (job.cancelled) { job.resolve(null); continue; }
          if (error) {
            if (job.generation === this.projectGeneration)
              document.getElementById('timelineMessage').textContent = 'Capture failed: ' + error.message;
            job.resolve(null); continue;
          }
          const stale = job.generation !== this.projectGeneration ||
            job.camera !== this.cameraRequestId || this.projectBusy;
          if (!frame || stale) { job.resolve(null); continue; }
          if (stopFrames.bytes(this.frames) + frame.png.size > stopFrames.maxBytes) {
            document.getElementById('timelineMessage').textContent = 'Capture failed: 2 GiB compressed media limit reached. No frame added.';
            job.resolve(null); continue;
          }
          const before = this.timeline?.snapshot();
          this.dimensionsLocked = true;
          this.timeline?.live();
          this.frames.push(frame); this.holds.push(1);
          this.frameWebps.push(stopMedia.lazyFrame(frame));
          if (before) this.timeline.commit(before);
          else this.drawFrame(this.frames.length - 1, this.snapshotContext);
          this.onProjectChange?.();
          job.resolve(frame);
        }
      } finally {
        this.captureDraining = false;
        this.captureBusy = false;
        this.timeline?.updateControls();
        this.refreshSummary?.();
      }
    }

    pendingCaptures() {
      return this.captureQueue.length + (this.captureActive ? 1 : 0);
    }

    undoCapture() {
      if (this.timeline) return this.timeline.undo();
      if (this.projectBusy || this.loadInProgress) return;
      if (!this.frames.length)
        return;
      this.frames.pop();
      this.frameWebps.pop();
      this.holds.pop();
      if (this.frames.length)
        this.drawFrame(this.frames.length-1, this.snapshotContext);
      else
        this.snapshotContext.clearRect(0, 0, this.w, this.h);
      this.onProjectChange?.();
    }

    frameTimeout() {
      return 1000.0 / this.playbackSpeed;
    }

    exposures() {
      return this.frames.reduce((sum, _, i) => sum + (this.holds[i] ?? 1), 0);
    }

    startPlay(onReady) {
      return new Promise(resolve => {
        if (!this.frames.length || this.captureBusy || this.projectBusy || this.loadInProgress) {
          resolve(false);
          return;
        }
        this.snapshotCanvas.style.visibility = 'hidden';
        this.video.pause();
        const token = ++this.playGeneration;
        this.playEnds = [];
        let exposures = 0;
        this.frames.forEach((_, i) => {
          exposures += this.holds[i] ?? 1;
          this.playEnds.push(exposures * this.frameTimeout());
        });
        this.playResolve = resolve;
        this.drawFrame(0, this.playContext).then(drawn => {
          if (token !== this.playGeneration) return;
          if (!drawn) { this.endPlay(); return; }
          this.zeroPlayTime = performance.now();
          onReady?.();
          this.playTimer = setTimeout(() => this.playFrame(1, token), this.playEnds[0]);
          this.onPlaybackState?.(true);
        });
      });
    }

    endPlay(cb) {
      this.playGeneration++;
      this.cancelDraw(this.playContext);
      if (this.isPlaying())
        clearTimeout(this.playTimer);
      this.playTimer = null;
      const resolve = this.playResolve;
      this.playResolve = null;
      this.onPlaybackState?.(false);
      this.playContext.clearRect(0, 0, this.w, this.h);
      this.snapshotCanvas.style.visibility = '';
      if (this.streamOn)
        this.video.play().catch(() => {});
      this.timeline?.preview();
      resolve?.(true);
      if (cb)
        cb();
    }

    async playFrame(frameNumber, token) {
      if (token !== this.playGeneration) return;
      if (frameNumber >= this.frames.length) {
        this.endPlay();
      } else {
        await this.drawFrame(frameNumber, this.playContext);
        if (token !== this.playGeneration) return;
        let timeout = this.zeroPlayTime + this.playEnds[frameNumber] - performance.now();
        this.playTimer = setTimeout(() => this.playFrame(frameNumber + 1, token), Math.max(0, timeout));
      }
    }

    togglePlay() {
      if (this.isPlaying())
        return new Promise((resolve, reject) => {
          this.endPlay();
          resolve(true);
        });
      else
        return this.startPlay();
    }

    clear() {
      if (this.projectBusy || this.loadInProgress) return;
      this.invalidateProject();
      this.cancelProjectActivity?.();
      if (this.isPlaying())
        this.endPlay();
      this.frames = [];
      this.frameWebps = [];
      this.snapshotContext.clearRect(0, 0, this.w, this.h);
      this.holds = [];
      this.timeline?.reset();
      this.dimensionsLocked = false;
      this.syncCameraDimensions(false);
      this.playContext.clearRect(0, 0, this.w, this.h);
      this.name = null;
      if (this.onProjectReset) this.onProjectReset();
      else this.onProjectChange?.();
    }

    loadFinished() {
      this.loadInProgress = false;
      this.timeline?.reset();
      this.snapshotContext.clearRect(0, 0, this.w, this.h);
      if (this.frames.length) {
        this.snapshotContext.clearRect(0, 0, this.w, this.h);
        this.drawFrame(this.frames.length - 1, this.snapshotContext);
        this.startPlay();
      }
      this.onProjectLoaded?.();
    }

    save(filename, options) {
      filename = filename || 'StopMotion';
      const format = options?.format === 'mp4' ? 'mp4' : 'webm';
      const extension = '.' + format;
      filename = filename.replace(/\.(webm|mp4)$/i, '') + extension;
      let title = filename.substr(0, filename.length - extension.length);
      return this.encode(title, options).then((blob => {
        this.exported = blob;
        let url = URL.createObjectURL(blob);
        let downloadLink = document.createElement('a');
        downloadLink.download = filename;
        downloadLink.href = url;
        downloadLink.click();
        URL.revokeObjectURL(url);
        return blob;
      }).bind(this));
    }

    encode(title, options = {}) {
      const quality = options && Number.isFinite(options.quality) ? options.quality : undefined;
      const format = options?.format === 'mp4' ? 'mp4' : 'webm';
      const holds = this.frames.map((_, i) => this.holds[i] ?? 1);
      if (!stopTimeline.validHolds(holds, this.frames.length))
        return Promise.reject(new Error('Invalid holds or exposure budget.'));
      // Snapshot references/settings before awaiting; expand references, never canvases.
      const generation = this.projectGeneration;
      const check = () => {
        if (generation !== this.projectGeneration) throw new Error('Export cancelled by project replacement.');
      };
      // Encode a bounded number of frames in flight so canvas WebP encoding can use
      // multiple cores; the muxer still consumes frames strictly in order. This only
      // changes scheduling: each frame is encoded exactly once, at the same quality.
      const sequence = this.frames.flatMap((frame, i) => Array(holds[i]).fill(frame));
      const total = sequence.length;
      if (format === 'mp4') {
        return stopMedia.encodeMp4(sequence, this.w, this.h, this.playbackSpeed, {
          quality,
          check,
          onProgress: update => this.onExportProgress?.(update)
        }).then(blob => { check(); return blob; });
      }
      let done = 0;
      this.onExportProgress?.({phase: 'encoding', done: 0, total});
      const limit = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
      let encoding = 0, failed = null;
      const waiting = [];
      const acquire = () => failed ? Promise.reject(failed) : encoding < limit ?
        (encoding++, Promise.resolve()) :
        new Promise((resolve, reject) => waiting.push({resolve, reject}));
      const release = () => { const next = waiting.shift(); if (next) next.resolve(); else encoding--; };
      const fail = error => { failed = error; while (waiting.length) waiting.shift().reject(error); };
      const frames = sequence.map(frame => {
        let acquired = false;
        const encoded = acquire().then(() => {
          acquired = true;
          check();
          return stopMedia.encodeFrame(frame, quality);
        }).then(blob => {
          done++;
          this.onExportProgress?.({phase: done >= total ? 'finishing' : 'encoding', done, total});
          check(); return blob;
        })
          .finally(() => { if (acquired) release(); })
          .catch(error => { fail(error); throw error; });
        encoded.catch(() => {});  // muxer may not have awaited this frame yet
        return encoded;
      });
      const width = this.w, height = this.h, interval = this.frameTimeout();
      return Promise.resolve().then(() => {
        check(); return webm.encode(title, width, height, interval, frames, null);
      }).then(blob => { check(); return blob; });
    }

    load(file, finishCB, frameRateCB) {
      this.invalidateProject();
      this.cancelProjectActivity?.();
      this.endPlay();
      let an = this;
      const generation = this.projectGeneration;
      this.loadInProgress = true;
      this.timeline?.updateControls();
      let reader = new FileReader();
      let finishLoad = (() => {
        an.loadInProgress = false;
        an.timeline?.updateControls();
        if (finishCB)
          finishCB();
      });
      // Legacy WebM decoding still reads the entire file into an ArrayBuffer.
      if (file.size > 512 * 1024 * 1024) {
        document.getElementById('timelineMessage').textContent = 'WebM import exceeds 512 MiB.';
        finishLoad(); return;
      }
      reader.addEventListener("load", async evt => {
        try {
          const encoded = [], frames = [];
          let width = an.w, height = an.h, rate = an.playbackSpeed, applied = false;
          webm.decode(evt.target.result,
            (w, h) => { width = w; height = h; },
            fps => { rate = fps; }, (blob, idx) => { encoded[idx] = blob; });
          if (!stopFrames.dimensions(width, height) || encoded.length + an.frames.length > 2000)
            throw new Error('WebM dimensions/frame count exceed project limits.');
          if (an.frames.length && (width !== an.w || height !== an.h))
            throw new Error('Imported video dimensions must match the existing project.');
          let bytes = stopFrames.bytes(an.frames);
          for (const blob of encoded) {
            if (generation !== an.projectGeneration) return;
            let image;
            try { image = await createImageBitmap(blob); }
            catch { image = await createImageBitmap(webm.vp8tovp8l(blob)); }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            try {
              canvas.getContext('2d').drawImage(image, 0, 0, width, height);
              const frame = await stopFrames.fromCanvas(canvas);
              bytes += frame.png.size;
              if (bytes > stopFrames.maxBytes) throw new Error('2 GiB compressed media limit reached.');
              frames.push(frame);
            } finally { image.close(); canvas.width = canvas.height = 0; }
          }
          if (generation !== an.projectGeneration || !frames.length) return;
          if (an.exposures() + frames.length > 24000) throw new Error('Exposure limit exceeded.');
          an.dimensionsLocked = true; an.setDimensions(width, height);
          an.frames.push(...frames); an.holds.push(...frames.map(() => 1));
          an.frameWebps.push(...frames.map(stopMedia.lazyFrame));
          applied = true;
          frameRateCB?.(rate);
          an.name = file.name.substring(0, file.name.length - 5);
          an.loadFinished();
        } catch (error) {
          document.getElementById('timelineMessage').textContent = 'WebM not imported: ' + error.message;
        } finally { finishLoad(); }
      });
      reader.addEventListener("error", evt => {
        an.loadInProgress = false;
        finishLoad();
      });
      reader.addEventListener("abort", evt => {
        an.loadInProgress = false;
        finishLoad();
      });
      reader.readAsArrayBuffer(file);
    }

  }


  animator.Animator = Animator;
})();
