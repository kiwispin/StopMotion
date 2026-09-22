'use strict';

// Presentation only: move the existing controls, retaining their handlers/state.
window.stopTablet = (() => {
  function connect(an) {
    const el = id => document.getElementById(id);
    const tablet = matchMedia('(min-width: 651px) and (max-width: 1400px) and (min-height: 500px) and (any-pointer: coarse), (min-width: 651px) and (max-width: 1100px) and (min-height: 500px) and (orientation: portrait)');
    const portrait = matchMedia('(orientation: portrait)');
    const oldLandscape = matchMedia('(min-width: 901px) and (max-width: 1366px) and (max-height: 800px) and (orientation: landscape)');
    const homes = new Map();
    const remember = node => {
      const marker = document.createComment('control home');
      node.before(marker); homes.set(node, marker); return node;
    };
    const capture = remember(el('captureButton'));
    ['playButton', 'liveButton', 'undoButton', 'saveButton',
      'button-container', 'project-controls', 'speed-container', 'resolutionStatus']
      .forEach(id => remember(el(id)));
    const status = remember(document.querySelector('.statusbar'));
    const zoom = remember(document.querySelector('.timeline-zoom'));
    const edits = remember(document.querySelector('.timeline-tools'));
    const rail = el('tabletCaptureControls');
    const shutter = el('tabletShutter');
    const filmstrip = el('tabletFilmstrip');
    let active = false, editing = false, framesOpen = false, lastFrame = null;
    let lastCount = 0, rememberedOnion = an.onionOpacity || 50;
    let previousLayout = '', resizeTask;
    const locked = () => an.projectBusy || an.loadInProgress || an.captureBusy;

    function revealLatest() {
      an.timeline.reveal(an.frames.length - 1);
    }
    function refresh() {
      if (an.onionOpacity > 0) rememberedOnion = an.onionOpacity;
      if (!active) return;
      if (an.timeline.selected >= 0) editing = true;
      else if (lastCount !== an.frames.length) editing = false;
      document.body.dataset.workspace = editing ? 'edit' : 'capture';
      el('captureMode').setAttribute('aria-pressed', !editing);
      el('editMode').setAttribute('aria-pressed', editing);
      filmstrip.hidden = !portrait.matches && !editing && !framesOpen;
      edits.hidden = !editing && !el('timelineMessage').textContent;
      shutter.hidden = editing;
      el('liveButton').hidden = !editing;
      el('onionToggle').hidden = editing;
      el('lastFrameButton').hidden = editing;
      el('framesToggle').textContent = `${an.frames.length} frames`;
      el('framesToggle').setAttribute('aria-expanded', !filmstrip.hidden);
      el('tabletSpeed').textContent = `${an.playbackSpeed} fps · ${(an.exposures() / an.playbackSpeed).toFixed(2)} s`;
      el('onionToggle').textContent = an.onionOpacity ? '◉ Onion on' : '◉ Onion off';
      el('onionToggle').setAttribute('aria-pressed', an.onionOpacity > 0);
      el('onionToggle').setAttribute('aria-label', `Onion skin: ${an.onionOpacity ? 'on' : 'off'}`);
      for (const id of ['captureMode', 'editMode', 'onionToggle', 'lastFrameButton', 'latestFrameButton'])
        el(id).disabled = locked() || (['lastFrameButton', 'latestFrameButton'].includes(id) && !an.frames.length);
      const frame = an.frames.at(-1);
      if (frame !== lastFrame) {
        lastFrame = frame;
        const ctx = el('lastFramePreview').getContext('2d');
        ctx.clearRect(0, 0, 96, 72);
        if (frame) ctx.drawImage(frame.thumbnail, 0, 0);
      }
      if (lastCount !== an.frames.length && !editing) requestAnimationFrame(revealLatest);
      lastCount = an.frames.length;
    }

    function layout() {
      const nextActive = tablet.matches;
      const key = `${nextActive}:${portrait.matches}:${innerWidth >= 1200 && innerHeight >= 780}`;
      if (nextActive !== active || !previousLayout) {
        // Restore in insertion order so nested controls return to their real homes.
        for (const [node, marker] of homes) marker.after(node);
        active = nextActive;
        document.body.classList.toggle('tablet-studio', active);
        for (const id of ['tabletProject', 'tabletSettings']) el(id).close();
        if (active) {
          shutter.prepend(capture);
          rail.prepend(el('playButton'), el('undoButton'), el('liveButton'));
          el('tabletHeaderActions').prepend(status);
          el('tabletHeaderActions').append(el('saveButton'));
          el('tabletProjectContent').append(el('project-controls'));
          el('tabletSettingsContent').append(el('speed-container'), el('button-container'), zoom, el('resolutionStatus'));
          el('top-container').append(edits);
        } else {
          filmstrip.hidden = edits.hidden = el('liveButton').hidden = false;
        }
      }
      // Preserve the existing non-touch desktop layout and its smaller-screen rail.
      if (!active) {
        if (oldLandscape.matches) document.querySelector('.transport').prepend(capture);
        else homes.get(capture).after(capture);
      }
      if (key !== previousLayout) framesOpen = innerWidth >= 1200 && innerHeight >= 780;
      previousLayout = key;
      an.tabletPortrait = active && portrait.matches;
      an.tabletUI = active;
      document.body.classList.toggle('tablet-portrait', an.tabletPortrait);
      if (active) {
        // Anchor the shutter to the actual image, not a taller surrounding panel.
        (portrait.matches ? el('video-container') : rail).append(shutter);
      }
      refresh(); an.timeline.render();
      requestAnimationFrame(() => an.timeline.reveal(an.timeline.selected >= 0 ? an.timeline.selected : an.frames.length - 1));
    }

    function captureMode() {
      if (locked()) return;
      editing = false; el('liveButton').click(); refresh();
    }
    function editMode() {
      if (locked()) return;
      editing = true; refresh();
      if (an.frames.length) an.timeline.goToFrame(an.timeline.selected >= 0 ? an.timeline.selected + 1 : an.frames.length);
    }
    el('captureMode').onclick = captureMode;
    el('editMode').onclick = editMode;
    el('liveButton').addEventListener('click', () => { if (!locked()) { editing = false; refresh(); } });
    el('lastFrameButton').onclick = el('latestFrameButton').onclick = () => {
      if (locked() || !an.frames.length) return;
      editing = true; refresh(); an.timeline.goToFrame(an.frames.length);
    };
    el('framesToggle').onclick = () => { framesOpen = !framesOpen; refresh(); requestAnimationFrame(revealLatest); };
    el('collapseFrames').onclick = () => { framesOpen = false; captureMode(); };
    el('onionToggle').onclick = () => {
      if (locked()) return;
      an.onionOpacity = an.onionOpacity ? 0 : rememberedOnion;
      an.onProjectChange?.();
    };
    const showSettings = () => el('tabletSettings').showModal();
    el('tabletSettingsButton').onclick = el('tabletSpeed').onclick = showSettings;
    el('tabletProjectButton').onclick = () => el('tabletProject').showModal();
    document.querySelectorAll('[data-close-tablet]').forEach(button => {
      button.onclick = () => button.closest('dialog').close();
    });
    for (const id of ['openProject', 'saveProject', 'clearButton', 'loadButton'])
      el(id).addEventListener('click', () => { el('tabletProject').close(); el('tabletSettings').close(); });
    el('tabletBackup').onclick = () => el('saveProject').click();
    el('tabletRetry').onclick = () => el('retrySave').click();
    const report = () => {
      const failed = status.dataset.state === 'error';
      el('tabletSaveAlert').hidden = !active || !failed;
      el('tabletSaveAlert').querySelector('span').textContent = el('project-status').textContent;
      el('tabletRetry').hidden = el('retrySave').hidden;
      status.title = el('project-status').textContent;
    };
    new MutationObserver(report).observe(status, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-state']});
    // A capture/export error must not disappear with the contextual edit toolbar.
    new MutationObserver(refresh).observe(el('timelineMessage'), {childList: true, characterData: true, subtree: true});
    window.addEventListener('resize', () => { cancelAnimationFrame(resizeTask); resizeTask = requestAnimationFrame(() => { layout(); report(); }); });
    layout(); report();
    return {refresh, get active() { return active; }};
  }
  return {connect};
})();
