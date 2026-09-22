'use strict';

// History owns metadata/reference arrays only; immutable PNG records are shared.
window.stopTimeline = (() => {
  const historyLimit = 50;
  const maxHold = 120;
  const maxExposures = 24000;
  const gap = 10;
  const virtualizationThreshold = 120;
  const overscan = 6;
  const minThumb = 48;
  const maxThumb = 176;

  function validHolds(holds, count) {
    return Array.isArray(holds) && holds.length === count &&
      holds.every(n => Number.isInteger(n) && n >= 1 && n <= maxHold) &&
      holds.reduce((sum, n) => sum + n, 0) <= maxExposures;
  }

  function connect(an) {
    let selected = -1;
    let thumbWidth = 96;
    const past = [], future = [];
    const strip = document.getElementById('thumbnail-container');
    const nodeFrames = new WeakMap();
    const wrapFor = new WeakMap();
    const control = id => document.getElementById(id);
    const blocked = () => an.projectBusy || an.loadInProgress || an.captureBusy;
    const snapshot = () => ({frames: an.frames.slice(), webps: an.frameWebps.slice(),
      holds: an.holds.slice(), selected});
    const stride = () => thumbWidth + gap;
    const cellHeight = () => an.tabletUI ? Math.ceil(thumbWidth * 9 / 16) + 24 : Math.round(thumbWidth * .75) + 20;
    function layout() {
      if (!an.tabletPortrait) return {grid: false, columns: 1, width: thumbWidth,
        step: stride(), row: cellHeight(), viewport: strip.clientWidth || 800, offset: strip.scrollLeft};
      const columns = innerWidth >= 950 ? 6 : 4;
      const width = Math.max(44, (strip.clientWidth - 20 - gap * (columns - 1)) / columns);
      return {grid: true, columns, width, step: width + gap,
        row: Math.ceil(width * 9 / 16) + 30,
        viewport: strip.clientHeight || 300, offset: strip.scrollTop};
    }

    function stop() {
      an.cancelProjectActivity?.();
      an.endPlay();
    }
    function preview() {
      if (an.isPlaying()) return;
      an.cancelDraw(an.playContext);
      an.playContext.clearRect(0, 0, an.w, an.h);
      an.snapshotCanvas.style.visibility = selected >= 0 ? 'hidden' : '';
      if (selected >= 0) an.drawFrame(selected, an.playContext);
    }
    function updateControls() {
      const locked = blocked();
      // Capture stays available while earlier shots finish compressing in the
      // background; other controls wait until the queue drains.
      control('captureButton').disabled = an.projectBusy || an.loadInProgress;
      control('playButton').disabled = locked;
      control('undoButton').disabled = locked || !past.length;
      control('redoButton').disabled = locked || !future.length;
      for (const id of ['duplicateFrame', 'deleteFrame', 'frameHold'])
        control(id).disabled = locked || selected < 0;
      control('moveLeft').disabled = locked || selected <= 0;
      control('moveRight').disabled = locked || selected < 0 || selected >= an.frames.length - 1;
      control('liveButton').disabled = locked;
      control('liveButton').setAttribute('aria-pressed', selected < 0);
      control('selectionStatus').textContent = selected < 0 ? 'Live camera' : `Frame ${selected + 1} of ${an.frames.length}`;
      const selectedHold = an.holds[selected] ?? 1;
      control('holdSummary').textContent = selected < 0 ? '' : `${selectedHold} ${selectedHold === 1 ? 'exposure' : 'exposures'} · ${(selectedHold / an.playbackSpeed).toFixed(2)} sec`;
      control('frameHold').value = selected < 0 ? 1 : an.holds[selected];
      control('goToFrame').max = Math.max(1, an.frames.length);
      const reviewing = selected >= 0;
      const playing = !!an.isPlaying();
      const chip = control('modeChip');
      if (chip) {
        chip.textContent = playing ? 'Playing'
          : !an.streamOn ? 'Camera off'
          : reviewing ? `Reviewing frame ${selected + 1}` : 'Live camera';
        chip.classList.toggle('review', reviewing && an.streamOn && !playing);
        chip.classList.toggle('live', !reviewing || !an.streamOn || playing);
      }
      const liveHeader = control('liveHeader');
      if (liveHeader) liveHeader.hidden = reviewing;
      const nextHint = control('nextFrameHint');
      if (nextHint) nextHint.textContent = reviewing ? '' : `Next frame: ${an.frames.length + 1}`;
      const panel = control('selected-frame-panel');
      if (panel) panel.hidden = !reviewing;
      if (reviewing) {
        const hold = an.holds[selected] ?? 1;
        control('selectedFrameLabel').textContent = `Frame ${selected + 1}`;
        control('selectedHoldLabel').textContent = hold === 1 ? '1 exposure' : `${hold} exposures`;
        control('holdValue').textContent = String(hold);
        control('holdDecrease').disabled = locked || hold <= 1;
        control('holdIncrease').disabled = locked || hold >= 120;
        control('panelDuplicate').disabled = locked;
        control('panelDelete').disabled = locked;
        control('panelMoveLeft').disabled = locked || selected <= 0;
        control('panelMoveRight').disabled = locked || selected >= an.frames.length - 1;
        control('panelBackToLive').disabled = locked;
      }
      for (const cell of strip.querySelectorAll('.thumb')) {
        const index = Number(cell.dataset.index);
        const canvas = cell.querySelector('canvas');
        canvas.setAttribute('aria-pressed', String(index === selected));
        canvas.tabIndex = index === (selected < 0 ? 0 : selected) ? 0 : -1;
        canvas.setAttribute('aria-disabled', String(locked));
        cell.classList.toggle('selected', index === selected);
      }
      an.onModeChange?.();
    }
    function cellCanvas(index) {
      return strip.querySelector(`.thumb[data-index="${index}"] canvas`);
    }
    function ensureScroll(index) {
      if (index < 0) return;
      const m = layout(), position = m.grid ? 'scrollTop' : 'scrollLeft';
      const start = m.grid ? Math.floor(index / m.columns) * m.row : index * m.step;
      const end = start + (m.grid ? m.row : m.width) + 12;
      if (start < m.offset) strip[position] = start;
      else if (end > m.offset + m.viewport) strip[position] = end - m.viewport;
    }
    function reveal(index) {
      ensureScroll(index); render();
    }
    function select(index, focus = false) {
      if (blocked()) return;
      stop();
      selected = Math.max(-1, Math.min(index, an.frames.length - 1));
      if (selected >= 0) {
        ensureScroll(selected);
        render();
      } else {
        updateControls(); preview();
      }
      if (focus && selected >= 0) cellCanvas(selected)?.focus({preventScroll: true});
    }
    function render() {
      const focusedIndex = strip.contains(document.activeElement)
        ? Number(document.activeElement.closest('.thumb')?.dataset.index ?? -1) : -1;
      selected = Math.min(selected, an.frames.length - 1);
      const count = an.frames.length;
      if (!count) {
        strip.replaceChildren();
      } else {
        const m = layout(), s = m.step;
        let start = 0, end = count;
        if (count > virtualizationThreshold) {
          const unit = m.grid ? m.row : s, extra = m.grid ? 1 : overscan;
          start = Math.max(0, Math.floor(m.offset / unit) - extra) * m.columns;
          end = Math.min(count, (Math.ceil((m.offset + m.viewport) / unit) + extra) * m.columns);
        }
        const available = new Map();
        for (const node of strip.querySelectorAll('canvas')) {
          const frame = nodeFrames.get(node);
          if (!available.has(frame)) available.set(frame, []);
          available.get(frame).push(node);
        }
        const track = document.createElement('div');
        track.className = 'thumb-track';
        track.style.width = (m.grid ? m.columns * s - gap : count * s - gap) + 'px';
        track.style.height = (m.grid ? Math.ceil(count / m.columns) * m.row : cellHeight()) + 'px';
        for (let index = start; index < end; index++) {
          const frame = an.frames[index];
          let canvas = available.get(frame)?.shift();
          if (!canvas) {
            canvas = document.createElement('canvas');
            nodeFrames.set(canvas, frame);
          }
          const height = an.tabletUI ? 54 : 72;
          if (canvas.width !== 96 || canvas.height !== height) {
            canvas.width = 96; canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!an.tabletUI) ctx.drawImage(frame.thumbnail, 0, 0);
            else {
              // Remove only the thumbnail's pre-existing letterbox, then contain
              // the original composition in the tablet's landscape thumbnail.
              const ratio = frame.width / frame.height;
              const sw = Math.min(96, 72 * ratio), sh = Math.min(72, 96 / ratio);
              const dw = Math.min(96, height * ratio), dh = Math.min(height, 96 / ratio);
              ctx.drawImage(frame.thumbnail, (96-sw)/2, (72-sh)/2, sw, sh,
                (96-dw)/2, (height-dh)/2, dw, dh);
            }
          }
          let wrap = wrapFor.get(canvas);
          if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'thumb';
            const number = document.createElement('span'); number.className = 'thumb-number';
            const badge = document.createElement('span'); badge.className = 'thumb-hold';
            wrap.append(canvas, number, badge);
            wrapFor.set(canvas, wrap);
          }
          wrap.dataset.index = String(index);
          wrap.style.left = ((m.grid ? index % m.columns : index) * s) + 'px';
          wrap.style.top = (m.grid ? Math.floor(index / m.columns) * m.row : 0) + 'px';
          wrap.style.width = m.width + 'px';
          wrap.querySelector('.thumb-number').textContent = String(index + 1);
          const hold = an.holds[index] ?? 1;
          const badge = wrap.querySelector('.thumb-hold');
          badge.textContent = hold > 1 ? '×' + hold : '';
          badge.hidden = hold <= 1;
          canvas.setAttribute('role', 'button');
          canvas.setAttribute('aria-label', `Frame ${index + 1}, hold ${hold} exposures`);
          canvas.onclick = () => select(index, true);
          canvas.onkeydown = event => {
            const keys = {ArrowLeft: index - 1, ArrowRight: index + 1,
              ...(m.grid ? {ArrowUp: index - m.columns, ArrowDown: index + m.columns} : {}),
              Home: 0, End: count - 1, Enter: index, ' ': index};
            if (!(event.key in keys)) return;
            event.preventDefault(); event.stopPropagation();
            select(Math.max(0, keys[event.key]), true);
          };
          track.appendChild(wrap);
        }
        strip.replaceChildren(track);
      }
      an.cancelDraw(an.snapshotContext);
      an.snapshotContext.clearRect(0, 0, an.w, an.h);
      if (an.frames.length) an.drawFrame(an.frames.length - 1, an.snapshotContext);
      updateControls(); preview(); an.refreshSummary?.();
      if (focusedIndex >= 0) cellCanvas(focusedIndex)?.focus({preventScroll: true});
    }
    function commit(before) {
      past.push(before);
      if (past.length > historyLimit) past.shift();
      future.length = 0;
      render();
    }
    function mutate(action) {
      if (blocked() || selected < 0) return;
      const before = snapshot();
      stop(); action();
      if (!validHolds(an.holds, an.frames.length) || an.frames.length > 2000 ||
          stopFrames.bytes(an.frames) > stopFrames.maxBytes) {
        restore(before);
        control('timelineMessage').textContent = 'Timeline limit: 2,000 frames, 2 GiB compressed media, 1–120 hold, 24,000 exposures.';
        return;
      }
      control('timelineMessage').textContent = '';
      commit(before); an.onProjectChange?.();
    }
    function restore(state) {
      an.frames = state.frames.slice(); an.frameWebps = state.webps.slice();
      an.holds = state.holds.slice(); selected = state.selected;
      render();
    }
    function travel(from, to) {
      if (blocked() || !from.length) return;
      stop(); to.push(snapshot()); restore(from.pop()); an.onProjectChange?.();
    }
    function reset() {
      past.length = 0; future.length = 0; selected = -1;
      control('timelineMessage').textContent = '';
      an.holds = an.frames.map((_, i) => an.holds[i] ?? 1);
      render();
    }
    function duplicate() {
      if (blocked() || selected < 0) return;
      if (stopFrames.bytes(an.frames) + an.frames[selected].png.size > stopFrames.maxBytes) {
        control('timelineMessage').textContent = 'Duplicate would exceed the 2 GiB compressed media limit.';
        return;
      }
      mutate(() => {
        an.frames.splice(selected + 1, 0, an.frames[selected]);
        an.frameWebps.splice(selected + 1, 0, an.frameWebps[selected]);
        an.holds.splice(selected + 1, 0, an.holds[selected]); selected++;
      });
    }
    function remove() {
      mutate(() => {
        an.frames.splice(selected, 1); an.frameWebps.splice(selected, 1); an.holds.splice(selected, 1);
        selected = Math.min(selected, an.frames.length - 1);
      });
    }
    function move(delta) {
      if (selected + delta < 0 || selected + delta >= an.frames.length) return;
      mutate(() => {
        for (const list of [an.frames, an.frameWebps, an.holds])
          [list[selected], list[selected + delta]] = [list[selected + delta], list[selected]];
        selected += delta;
      });
    }
    function setHold(value) {
      if (blocked() || selected < 0) return;
      const clamped = Math.max(1, Math.min(120, Math.round(Number(value) || 1)));
      if (clamped !== an.holds[selected]) mutate(() => { an.holds[selected] = clamped; });
    }
    function goToFrame(value) {
      if (!an.frames.length) return;
      const index = Math.max(0, Math.min(an.frames.length - 1, Math.round(Number(value) || 1) - 1));
      select(index, true);
    }
    function applyZoom(width) {
      thumbWidth = Math.max(minThumb, Math.min(maxThumb, Math.round(width / 8) * 8));
      strip.style.setProperty('--thumb-w', thumbWidth + 'px');
      const range = control('zoomRange');
      if (range && Number(range.value) !== thumbWidth) range.value = String(thumbWidth);
      render();
    }

    control('playbackSpeed').addEventListener('input', updateControls);
    control('liveButton').onclick = () => select(-1);
    control('redoButton').onclick = () => travel(future, past);
    control('duplicateFrame').onclick = duplicate;
    control('deleteFrame').onclick = remove;
    control('moveLeft').onclick = () => move(-1);
    control('moveRight').onclick = () => move(1);
    control('frameHold').onchange = event => setHold(event.target.value);
    control('panelDuplicate').onclick = duplicate;
    control('panelDelete').onclick = remove;
    control('panelMoveLeft').onclick = () => move(-1);
    control('panelMoveRight').onclick = () => move(1);
    control('panelBackToLive').onclick = () => select(-1);
    control('holdDecrease').onclick = () => setHold((an.holds[selected] ?? 1) - 1);
    control('holdIncrease').onclick = () => setHold((an.holds[selected] ?? 1) + 1);
    control('zoomOut').onclick = () => applyZoom(thumbWidth - 16);
    control('zoomIn').onclick = () => applyZoom(thumbWidth + 16);
    control('zoomRange').addEventListener('input', event => applyZoom(Number(event.target.value)));
    control('goToFrameButton').onclick = () => goToFrame(control('goToFrame').value);
    control('goToFrame').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); goToFrame(control('goToFrame').value); }
    });
    strip.addEventListener('scroll', () => {
      if (an.frames.length > virtualizationThreshold) render();
    }, {passive: true});

    const api = {snapshot, commit, reset, render, preview, updateControls,
      undo: () => travel(past, future), live: () => { selected = -1; },
      duplicate, remove, move, setHold, goToFrame, applyZoom, reveal,
      get selected() { return selected; }};
    an.timeline = api;
    applyZoom(Number(control('zoomRange').value) || thumbWidth);
    reset();
    return api;
  }
  return {connect, validHolds, maxExposures};
})();
