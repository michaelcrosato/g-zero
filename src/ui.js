/** Fullscreen works independently of engine startup and renderer selection. */
export function setupDisplayControls() {
  // Keep the boot failure view inside the native fullscreen element.
  const stage = document.documentElement;
  const button = document.getElementById('fullscreen');
  const announcer = document.getElementById('announcer');
  async function toggle() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        await exit.call(document);
      } else if (stage.requestFullscreen || stage.webkitRequestFullscreen) {
        const enter = stage.requestFullscreen || stage.webkitRequestFullscreen;
        await enter.call(stage);
      }
      else announcer.textContent = 'Browser fullscreen is unavailable. The game still fills this window.';
    } catch {
      announcer.textContent = 'Browser fullscreen was denied. The game still fills this window.';
    }
  }
  function changed() {
    const full = !!(document.fullscreenElement || document.webkitFullscreenElement);
    button.textContent = full ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
    button.setAttribute('aria-pressed', String(full));
  }
  function key(event) {
    if (event.code !== 'KeyF' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || event.target.isContentEditable) return;
    event.preventDefault(); toggle();
  }
  button.addEventListener('click', toggle);
  document.addEventListener('fullscreenchange', changed);
  document.addEventListener('webkitfullscreenchange', changed);
  window.addEventListener('keydown', key);
  changed();
  return () => {
    button.removeEventListener('click', toggle);
    document.removeEventListener('fullscreenchange', changed);
    document.removeEventListener('webkitfullscreenchange', changed);
    window.removeEventListener('keydown', key);
  };
}
