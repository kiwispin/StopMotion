'use strict';

// Read-only playback of the existing PNG frames using the shared bounded cache.
// No encoding, extra frame copies, project edits or changes to exported duration.
window.stopWatch = (() => {
  function connect(an) {
    const el = id => document.getElementById(id);
    const dialog = el('watchDialog'), canvas = el('watchCanvas');
    const context = canvas.getContext('2d');
    let running = false, loop = true, elapsed = 0, origin = 0, duration = 0;
    let timer = null, generation = 0, projectGeneration = 0, ends = [];
    const blocked = () => an.projectBusy || an.loadInProgress || an.captureBusy || !an.frames.length;

    function controls() {
      el('watchPlay').textContent = running ? '❚❚ Pause' : elapsed >= duration ? '↻ Replay' : '▶ Play';
      el('watchPlay').setAttribute('aria-label', running ? 'Pause animation' : 'Play animation');
      el('watchPlay').setAttribute('aria-pressed', running);
      el('watchLoop').textContent = loop ? '↻ Loop on' : '↻ Loop off';
      el('watchLoop').setAttribute('aria-pressed', loop);
    }
    function pause() {
      if (running) {
        elapsed = Math.max(0, performance.now() - origin);
        elapsed = loop ? elapsed % duration : Math.min(elapsed, duration);
      }
      running = false; generation++;
      clearTimeout(timer); timer = null;
      an.cancelDraw(context); controls();
    }
    function close() {
      pause();
      if (dialog.open) dialog.close();
      // Release the full-resolution display buffer; shared frame cache stays bounded.
      canvas.width = canvas.height = 1;
    }
    async function tick(token) {
      if (!running || token !== generation || !dialog.open) return;
      if (projectGeneration !== an.projectGeneration) { close(); return; }
      let time = Math.max(0, performance.now() - origin);
      if (time >= duration && loop) {
        origin += Math.floor(time / duration) * duration;
        time %= duration;
      }
      let index = 0;
      while (index < ends.length - 1 && time >= ends[index]) index++;
      const drawn = await an.drawFrame(index, context);
      if (token !== generation || !dialog.open) return;
      if (!drawn) {
        pause(); el('watchMessage').hidden = false;
        el('watchMessage').textContent = 'This frame could not be displayed. Return to the studio and try again.';
        return;
      }
      el('watchPosition').textContent = `Frame ${index + 1} of ${ends.length}`;
      if (time >= duration) {
        running = false; elapsed = duration; timer = null; controls();
        return;
      }
      timer = setTimeout(() => tick(token), Math.max(0, origin + ends[index] - performance.now()));
    }
    function play() {
      if (!dialog.open || blocked() || running) return;
      if (elapsed >= duration) elapsed = 0;
      el('watchMessage').hidden = true;
      running = true; origin = performance.now() - elapsed;
      controls(); tick(++generation);
    }
    function open() {
      if (blocked() || dialog.open) return;
      an.endPlay();
      projectGeneration = an.projectGeneration;
      let exposures = 0;
      ends = an.frames.map((_, index) => (exposures += an.holds[index] ?? 1) * 1000 / an.playbackSpeed);
      duration = ends.at(-1); elapsed = 0;
      canvas.width = an.w; canvas.height = an.h;
      canvas.style.setProperty('--watch-ratio', an.w / an.h);
      el('watchSummary').textContent = `${an.frames.length} frames · ${(duration / 1000).toFixed(2)} s · ${an.playbackSpeed} fps`;
      el('watchPosition').textContent = '';
      dialog.showModal(); play();
    }
    function refresh() {
      el('watchButton').disabled = blocked();
      if (dialog.open && (an.projectBusy || projectGeneration !== an.projectGeneration || !an.frames.length)) close();
    }
    el('watchButton').onclick = open;
    el('watchPlay').onclick = () => running ? pause() : play();
    el('watchLoop').onclick = () => { loop = !loop; controls(); };
    el('watchClose').onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (running || canvas.width !== 1) close(); });
    window.addEventListener('pagehide', close);
    document.addEventListener('visibilitychange', () => { if (document.hidden && dialog.open) pause(); });
    refresh();
    return {refresh};
  }
  return {connect};
})();
