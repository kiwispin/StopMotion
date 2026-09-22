/* -*- mode: javascript; js-indent-level: 2 -*- */

// Copyright 2022 Stefan Zager <szager@gmail.com>
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

var main = main || {};

window.addEventListener('load', evt => {
  // Create Animator object and set up callbacks.
  let video = document.getElementById('video');
  let snapshotCanvas = document.getElementById('snapshot-canvas');
  let playCanvas = document.getElementById('play-canvas');
  let videoMessage = document.getElementById('video-message');
  let retryCameraButton = document.getElementById('retryCameraButton');
  let an = new animator.Animator(
      video, snapshotCanvas, playCanvas, videoMessage, retryCameraButton);

  main.animator = an;
  an.onionOpacity = 50;
  an.refreshSummary = () => {
    document.getElementById('frame-count').textContent = an.frames.length;
    document.getElementById('duration').textContent = (an.exposures() / an.playbackSpeed).toFixed(2) + ' s';
    document.getElementById('transportFrames').textContent = an.frames.length + (an.frames.length === 1 ? ' frame' : ' frames');
    document.getElementById('onionOpacity').value = an.onionOpacity;
    document.getElementById('onionValue').textContent = an.onionOpacity + '%';
    snapshotCanvas.style.opacity = an.onionOpacity / 100;
    document.getElementById('flipButton').setAttribute('aria-pressed', an._flip);
    const actual = an.streamOn && video.readyState >= 2 ? `${video.videoWidth}×${video.videoHeight}` : 'waiting';
    if (an.streamOn && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const cropPortrait = video.videoHeight > video.videoWidth && an.w > an.h;
      const scale = Math.min(1, an.w / video.videoWidth, an.h / video.videoHeight);
      // Existing portrait projects fit inside a landscape stage without changing
      // their saved pixels. Live framing must match the capture, not stretch it.
      const stageWidth = an.w < an.h ? an.h * 16 / 9 : an.w;
      const width = (cropPortrait ? an.w : video.videoWidth * scale) / stageWidth * 100;
      const height = (cropPortrait ? an.h : video.videoHeight * scale) / an.h * 100;
      video.style.objectFit = cropPortrait ? 'cover' : 'contain';
      video.style.width = width + '%'; video.style.height = height + '%';
      video.style.left = (100 - width) / 2 + '%'; video.style.top = (100 - height) / 2 + '%';
    }
    document.getElementById('resolutionStatus').textContent = `Project ${an.w}×${an.h} · Camera ${actual}`;
    document.getElementById('captureLimit').textContent = 'Up to 2,000 frames / 2 GiB compressed media. Decoded cache: up to 8 frames / 16 MiPixels. Storage quota varies; download backups.';
    const pending = an.pendingCaptures ? an.pendingCaptures() : 0;
    document.getElementById('capturePending').textContent = pending ? 'Saving ' + pending + '…' : '';
  };
  let captureFlashTimer = null;
  an.onCapture = () => {
    const stage = document.getElementById('video-container');
    stage.classList.remove('capture-flash');
    void stage.offsetWidth;
    stage.classList.add('capture-flash');
    clearTimeout(captureFlashTimer);
    captureFlashTimer = setTimeout(() => stage.classList.remove('capture-flash'), 200);
  };
  document.getElementById('onionOpacity').addEventListener('input', event => {
    if (an.projectBusy || an.loadInProgress) return;
    an.onionOpacity = Number(event.target.value);
    an.onProjectChange?.();
  });
  let progressRequest = null;
  an.onPlaybackState = playing => {
    const button = document.getElementById('playButton');
    button.textContent = playing ? '■ Stop' : '▶ Play';
    button.setAttribute('aria-label', playing ? 'Stop animation' : 'Play animation');
    button.setAttribute('aria-pressed', playing);
    const marker = document.getElementById('progress-marker');
    const progress = document.getElementById('progress-container');
    cancelAnimationFrame(progressRequest);
    const tick = () => {
      const duration = an.playEnds?.at(-1) || 1;
      const percent = Math.min(100, Math.max(0, (performance.now() - an.zeroPlayTime) / duration * 100));
      marker.style.transform = `translateX(${percent - 100}%)`;
      progress.setAttribute('aria-valuenow', Math.round(percent));
      progressRequest = requestAnimationFrame(tick);
    };
    marker.style.transform = 'translateX(-100%)';
    progress.setAttribute('aria-valuenow', 0);
    if (playing) progressRequest = requestAnimationFrame(tick);
    updateCameraCta();
  };
  let cameraRefreshGeneration = 0;
  let refreshCameraList = (() => { return Promise.resolve([]); });
  let attachCamera = (sourceId => {
    cameraRefreshGeneration++;
    return an.attachStream(sourceId).then(stream => {
      if (stream)
        refreshCameraList(sourceId);
      return stream;
    });
  });
  retryCameraButton.addEventListener('click', () => {
    attachCamera(an.cameraErrorSourceId || an.videoSourceId);
  });

  window.addEventListener('pagehide', () => {
    an.invalidateProject();
    an.endPlay();
    an.detachStream();
  });

  let playbackSpeedSelector = document.getElementById('playbackSpeed');
  let playbackSpeed = (() => {
    return Number(playbackSpeedSelector.value);
  });
  let fps = document.getElementById('fps');
  playbackSpeedSelector.addEventListener("input", evt => {
    an.setPlaybackSpeed(playbackSpeed());
    fps.innerText = '  ' + playbackSpeed().toFixed(1);
  });
  an.setPlaybackSpeed(playbackSpeed());

  let captureClicks = (e => { e.stopPropagation() });
  let showSpinner = (() => {
    let topContainer = document.getElementById('top-container');
    topContainer.style.opacity = 0.5;
    topContainer.addEventListener('click', captureClicks, true);
  });
  let hideSpinner = (() => {
    let topContainer = document.getElementById('top-container');
    topContainer.style.opacity = null;
    topContainer.removeEventListener('click', captureClicks, true);
  });

  let saveDialog = document.getElementById('saveDialog');
  let fileNameInput = document.getElementById('movieName');
  let qualitySelect = document.getElementById('exportQuality');
  let exportSummary = document.getElementById('exportSummary');
  let exportProgress = document.getElementById('exportProgress');
  let exportBarFill = document.getElementById('exportBarFill');
  let exportProgressText = document.getElementById('exportProgressText');
  let exportUnsupported = document.getElementById('exportUnsupported');
  let saveConfirmButton = document.getElementById('saveConfirmButton');
  let saveCancelButtonEl = document.getElementById('saveCancelButton');
  let exportCapability = null;
  let exportCapabilityPromise = null;
  let selectedExport = null;
  let exportRunning = false;

  async function detectExportCapability() {
    if (exportCapability) return exportCapability;
    if (exportCapabilityPromise) return exportCapabilityPromise;
    exportCapabilityPromise = (async () => {
      try {
        const probe = document.createElement('canvas');
        probe.width = probe.height = 2;
        const blob = await new Promise(resolve => probe.toBlob(resolve, 'image/webp', 0.9));
        if (blob?.type === 'image/webp') {
          stopMedia.vp8Payload(await blob.arrayBuffer());
          return {format: 'webm', extension: '.webm', label: 'Export WebM'};
        }
      } catch {}
      if (stopMedia.mp4MimeType())
        return {format: 'mp4', extension: '.mp4', label: 'Export MP4'};
      return {format: null, extension: '', label: 'Export unavailable'};
    })().then(result => (exportCapability = result));
    return exportCapabilityPromise;
  }
  function openExportDialog() {
    exportSummary.textContent = `${an.w} × ${an.h} · ${an.playbackSpeed.toFixed(1)} fps · ` +
      `${(an.exposures() / an.playbackSpeed).toFixed(2)} s`;
    exportProgress.hidden = true;
    exportProgressText.textContent = '';
    exportBarFill.style.width = '0%';
    exportUnsupported.hidden = true;
    selectedExport = null;
    saveConfirmButton.textContent = 'Checking export…';
    saveConfirmButton.disabled = true;
    saveConfirmButton.onclick = () => saveCB();
    saveCancelButtonEl.disabled = false;
    saveDialog.showModal();
    detectExportCapability().then(capability => {
      if (!saveDialog.open || exportRunning) return;
      selectedExport = capability;
      exportUnsupported.hidden = !!capability.format;
      saveConfirmButton.textContent = capability.label;
      saveConfirmButton.disabled = !capability.format;
    });
  }
  let saveCB = () => {
    if (exportRunning || an.projectBusy || an.loadInProgress || !an.frames.length || !selectedExport?.format) return;
    let value = fileNameInput.value;
    if (!value.length)
      value = 'StopMotion';
    value = value.replace(/\s+/g, '_');
    value = value.replace(/[^\w\-\.]+/g, '');
    if (value.endsWith('.mng'))
      value = value.substring(0, value.length - 4);
    value = value.replace(/\.(webm|mp4)$/i, '') + selectedExport.extension;
    exportRunning = true;
    saveConfirmButton.disabled = true;
    saveCancelButtonEl.disabled = true;
    saveConfirmButton.textContent = 'Exporting…';
    exportProgress.hidden = false;
    exportProgressText.textContent = 'Starting…';
    exportBarFill.style.width = '0%';
    let topContainer = document.getElementById('top-container');
    topContainer.style.opacity = 0.5;
    topContainer.addEventListener('click', captureClicks, true);
    const finish = () => {
      exportRunning = false;
      topContainer.style.opacity = null;
      topContainer.removeEventListener('click', captureClicks, true);
      saveCancelButtonEl.disabled = false;
    };
    an.onExportProgress = ({phase, done, total}) => {
      exportProgressText.textContent = phase === 'finishing'
        ? 'Finishing the movie…' : phase === 'recording'
          ? `Creating MP4 frame ${done} of ${total}` : `Encoding frame ${done} of ${total}`;
      exportBarFill.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    };
    an.save(value, {quality: Number(qualitySelect.value), format: selectedExport.format}).then(() => {
      an.onExportProgress = null;
      finish();
      exportBarFill.style.width = '100%';
      exportProgressText.textContent = 'Your movie is downloading. Play it on this device, in VLC or in your browser; add music in Canva.';
      saveConfirmButton.textContent = 'Done';
      saveConfirmButton.disabled = false;
      saveConfirmButton.onclick = () => saveDialog.close();
    }).catch(err => {
      an.onExportProgress = null;
      finish();
      exportProgress.hidden = true;
      document.getElementById('timelineMessage').textContent = 'Export failed: ' + (err.message || err);
      saveDialog.close();
      saveConfirmButton.textContent = selectedExport?.label || 'Export Video';
      saveConfirmButton.disabled = false;
      saveConfirmButton.onclick = () => saveCB();
    });
  };

  let captureButton = document.getElementById('captureButton');
  const captureHome = captureButton.previousElementSibling;
  const landscapeWorkspace = matchMedia('(min-width: 901px) and (max-width: 1366px) and (max-height: 800px) and (orientation: landscape)');
  const placeCapture = () => {
    if (landscapeWorkspace.matches) document.querySelector('.transport').prepend(captureButton);
    else captureHome.after(captureButton);
  };
  landscapeWorkspace.addEventListener('change', placeCapture);
  placeCapture();
  let undoButton = document.getElementById('undoButton');
  let clearConfirmDialog = document.getElementById('clearConfirmDialog');
  window.addEventListener("keydown", (e => {
    if (an.projectBusy || an.loadInProgress) return;
    if (e.repeat || e.metaKey || e.target.closest('input, button, select, textarea, [contenteditable], [role="button"], dialog')) return;
    if (e.altKey || e.ctrlKey || e.shiftKey || clearConfirmDialog.open || saveDialog.open)
      return;
    if (e.code == "Space") {
      e.preventDefault();
      captureButton.click();
    }
    if (e.code == "Backspace") {
      e.preventDefault();
      undoButton.click();
    }
  }));

  let toggleButton = document.getElementById('toggleButton');
  let startCameraButton = document.getElementById('startCameraButton');
  let cameraOff = false;
  // The off-state prompt/CTA must never cover playback or a reviewed frame.
  function updateCameraCta() {
    const reviewing = (an.timeline?.selected ?? -1) >= 0;
    const playing = !!an.isPlaying();
    const show = cameraOff && !reviewing && !playing;
    startCameraButton.hidden = !show;
    if (show) {
      if (!videoMessage.textContent || videoMessage.textContent === 'Starting camera…')
        videoMessage.textContent = 'Camera is off.';
    } else if (videoMessage.textContent === 'Camera is off.') {
      videoMessage.textContent = '';
    }
  }
  function showCameraOff() {
    cameraOff = true;
    retryCameraButton.hidden = true;
    startCameraButton.disabled = false;
    toggleButton.textContent = 'Turn camera on';
    updateCameraCta();
  }
  function toggleCamera() {
    cameraRefreshGeneration++;
    an.toggleVideo().then(isPlaying => {
      if (isPlaying) {
        cameraOff = false;
        toggleButton.textContent = 'Camera On/Off';
        refreshCameraList(an.videoSourceId);
      } else {
        showCameraOff();
      }
      an.timeline?.updateControls();
      an.refreshSummary?.();
      updateCameraCta();
    }).catch(err => {
      cameraOff = false;
      toggleButton.textContent = 'Retry camera';
      an.timeline?.updateControls();
      updateCameraCta();
    });
  }
  toggleButton.addEventListener("click", toggleCamera);
  startCameraButton.addEventListener("click", () => {
    videoMessage.textContent = 'Starting camera…';
    startCameraButton.hidden = true;
    startCameraButton.disabled = true;
    toggleCamera();
  });

  let pressButton = (button => {
    button.classList.add('pressed');
    setTimeout(() => { button.classList.remove('pressed') }, 250);
  });

  let thumbnailContainer = document.getElementById('thumbnail-container');
  captureButton.addEventListener("click", async evt => {
    let frame = await an.capture();
    if (!frame)
      return;
    pressButton(captureButton);
  });

  undoButton.addEventListener("click", evt => {
    an.undoCapture();
    pressButton(undoButton);
  });

  let progressMarker = document.getElementById("progress-marker");

  let flipButton = document.getElementById('flipButton');
  flipButton.addEventListener("click", evt => {
    video.classList.toggle('rotated');
    an.flip();
  });

  let clockContainer = document.getElementById('clockContainer');
  let clockHand = document.getElementById("clock-hand");
  let clockNumRotations = 1000;
  let clockZeroTime = 0;

  let startClock = ((t, skew) => {
    skew = (skew ? Number(skew) : 0);
    clockZeroTime = t - skew;
    let angle = 360 * clockNumRotations;
    let duration = clockNumRotations - (skew/1000);
    clockHand.style.transition = "transform " + String(duration) + "s linear";
    clockHand.style.transform = "rotate(" + String(angle) + "deg)";
  });

  let stopClock = (() => {
    clockHand.style.transform = getComputedStyle(clockHand).transform;
  });
  
  let resetClock = (() => {
    clockHand.style.transition = "";
    clockHand.style.transform = "";
  });
  
  clockHand.addEventListener("transitionend", evt => {
    resetClock();
    requestAnimationFrame(() => { requestAnimationFrame(() => {
      let t = performance.now();
      let skew = (t - clockZeroTime) % 1000;
      startClock(t, skew);
    }) });
  });

  let clockButton = document.getElementById('clockButton');
  clockButton.addEventListener("click", evt => {
    if (clockContainer.style.display == "none") {
      clockContainer.style.display = "";
    } else {
      clockContainer.style.display = "none";
    }
    clockButton.setAttribute('aria-pressed', clockContainer.style.display !== 'none');
  });

  let playButton = document.getElementById('playButton');
  playButton.addEventListener("click", evt => {
    if (an.projectBusy || an.loadInProgress) return;
    let p = an.togglePlay();
    if (an.isPlaying()) {
      startClock(performance.now(), 0);
      p.then(resetClock);
    } else {
      progressMarker.classList.remove("slide-right");
      resetClock();
    }
  });

  let clearButton = document.getElementById('clearButton');
  clearButton.addEventListener("click", evt => {
    clearConfirmDialog.showModal();
  });

  let clearConfirmButton = document.getElementById('clearConfirmButton');
  clearConfirmButton.addEventListener("click", evt => {
    an.clear();
    thumbnailContainer.innerHTML = "";
    clearConfirmDialog.close();
  });

  let clearCancelButton = document.getElementById('clearCancelButton');
  clearCancelButton.addEventListener("click", evt => {
    clearConfirmDialog.close();
  });

  let saveButton = document.getElementById('saveButton');
  saveButton.addEventListener("click", () => {
    if (!an.frames.length)
      return;
    if (an.name)
      fileNameInput.value = an.name;
    openExportDialog();
  });

  let saveCancelButton = document.getElementById('saveCancelButton');
  saveCancelButton.addEventListener("click", evt => {
    saveDialog.close();
  });

  let loadButton = document.getElementById('loadButton');
  loadButton.addEventListener("click", evt => {
    let fileInput = document.createElement('input');
    fileInput.type = "file";
    fileInput.addEventListener("change", evt => {
      if (evt.target.files[0]) {
        if (an.projectBusy || an.loadInProgress) return;
        showSpinner();
        an.load(evt.target.files[0], hideSpinner, frameRate => {
          playbackSpeedSelector.value = frameRate;
          an.setPlaybackSpeed(frameRate);
        });
      }
    }, false);
    fileInput.click();
  });

  let cameraSelect = null;
  let updateCameraSelect = ((cameras, selectedId) => {
    cameras = cameras || [];
    if (cameras.length < 2) {
      if (cameraSelect) {
        cameraSelect.parentElement.remove();
        cameraSelect = null;
      }
      return;
    }
    if (!cameraSelect) {
      let videoColumnDiv = document.getElementById('camera-settings');
      let selectDiv = document.createElement('div');
      videoColumnDiv.appendChild(selectDiv);
      cameraSelect = document.createElement('select');
      cameraSelect.id = 'camera-select';
      cameraSelect.setAttribute('aria-label', 'Camera device');
      selectDiv.appendChild(cameraSelect);
      cameraSelect.onchange = e => {
        attachCamera(e.target.value || undefined);
      };
    }
    let currentId = selectedId || cameraSelect.value;
    cameraSelect.innerHTML = '';
    cameras.forEach((camera, index) => {
      let cameraOption = document.createElement('option');
      cameraOption.value = camera.deviceId;
      cameraOption.innerText = camera.label || 'Camera ' + (index + 1);
      cameraSelect.appendChild(cameraOption);
    });
    if (cameras.some(camera => camera.deviceId === currentId))
      cameraSelect.value = currentId;
    else if (cameras.length)
      cameraSelect.value = cameras[0].deviceId;
  });

  refreshCameraList = (selectedId => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
      return Promise.resolve([]);
    let refreshGeneration = ++cameraRefreshGeneration;
    return navigator.mediaDevices.enumerateDevices().then(devices => {
      if (refreshGeneration !== cameraRefreshGeneration)
        return [];
      let cameras = devices.filter(d => { return d.kind == 'videoinput'; });
      updateCameraSelect(cameras, selectedId);
      return cameras;
    }).catch(() => {
      return [];
    });
  });

  let setUpCameraSelectAndAttach = cameras => {
    cameras = cameras || [];
    updateCameraSelect(cameras, cameras.length ? cameras[0].deviceId : undefined);
    attachCamera(cameras.length ? cameras[0].deviceId : undefined);
  };

  main.timeline = stopTimeline.connect(an);
  main.project = stopProject.connect(an);
  an.onModeChange = updateCameraCta;

  // Privacy: the camera stays off until the student explicitly starts it. An inline
  // ?camera=1 deep link or the test hook window.__stopmotionAutoCamera may opt in.
  const autoStart = new URLSearchParams(location.search).has('camera') ||
    window.__stopmotionAutoCamera === true;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    an.showCameraError({name: 'NotSupportedError'});
  } else if (autoStart) {
    if (navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        setUpCameraSelectAndAttach(
            devices.filter(d => { return d.kind == 'videoinput'; }));
      }).catch(error => {
        an.showCameraError(error);
        attachCamera();
      });
    } else {
      setUpCameraSelectAndAttach();
    }
  } else {
    showCameraOff();
  }
});
