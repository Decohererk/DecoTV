import type Artplayer from 'artplayer';

import { SHORTCUTS_DATA } from './shortcuts-data';

/**
 * Apply DecoDock glassmorphism theme to an ArtPlayer instance.
 * Returns a cleanup function that must be called before player.destroy().
 */
export function applyDecoDockTheme(art: Artplayer): () => void {
  const player = art.template.$player;
  let observer: MutationObserver | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let originalPlaceholder = '';

  // Mark the controls dock
  const controls = art.template.$controls;
  controls.classList.add('deco-dock-active');

  // Patch danmaku input (may mount async)
  const patchDanmakuInput = () => {
    const input = player.querySelector<HTMLInputElement>(
      '.art-danmuku-send-input',
    );
    if (!input) return false;
    originalPlaceholder = input.placeholder;
    input.placeholder = '友善发言，享受观影';
    input.classList.add('deco-danmaku-input');
    return true;
  };

  if (!patchDanmakuInput()) {
    observer = new MutationObserver(() => {
      if (patchDanmakuInput() && observer) {
        observer.disconnect();
        observer = null;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    });
    observer.observe(player, { childList: true, subtree: true });
    timeoutId = setTimeout(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      timeoutId = null;
    }, 5000);
  }

  return () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    controls.classList.remove('deco-dock-active');
    const input = player.querySelector<HTMLInputElement>(
      '.art-danmuku-send-input',
    );
    if (input) {
      input.classList.remove('deco-danmaku-input');
      if (originalPlaceholder) {
        input.placeholder = originalPlaceholder;
      }
    }
  };
}

// ── Feature 1: Next Episode Countdown Capsule ──────────────────────

const CAPSULE_LAYER = 'deco-next-episode-capsule';

export function attachNextEpisodeCountdown(
  art: Artplayer,
  opts: {
    hasNextEpisode: () => boolean;
    onNextEpisode: () => void;
  },
): { cleanup: () => void; isCancelled: () => boolean } {
  let dismissed = false;
  let wasShownThisEpisode = false;
  let isVisible = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastCheckSecond = -1;

  const showCapsule = (seconds: number) => {
    if (isVisible) return;
    isVisible = true;
    wasShownThisEpisode = true;

    art.layers.add({
      name: CAPSULE_LAYER,
      html: `<div class="deco-capsule">
        <span class="deco-capsule-text">下一集将在 <span class="deco-capsule-countdown">${Math.ceil(seconds)}</span> 秒后播放</span>
        <button class="deco-capsule-play">立即播放</button>
        <button class="deco-capsule-cancel">取消</button>
      </div>`,
      style: { zIndex: '50' },
      mounted(el) {
        const playBtn = el.querySelector('.deco-capsule-play');
        const cancelBtn = el.querySelector('.deco-capsule-cancel');
        if (playBtn) {
          art.proxy(playBtn as unknown as HTMLDivElement, 'click', () => {
            hideCapsule();
            opts.onNextEpisode();
          });
        }
        if (cancelBtn) {
          art.proxy(cancelBtn as unknown as HTMLDivElement, 'click', () => {
            hideCapsule();
            dismissed = true;
          });
        }
        intervalId = setInterval(() => {
          const remaining = art.duration - art.currentTime;
          const span = el.querySelector('.deco-capsule-countdown');
          if (span)
            span.textContent = String(Math.max(0, Math.ceil(remaining)));
          if (remaining <= 0) hideCapsule();
        }, 1000);
      },
    });
  };

  const hideCapsule = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (isVisible) {
      art.layers.remove(CAPSULE_LAYER);
      isVisible = false;
    }
  };

  const onTimeUpdate = () => {
    const remaining = art.duration - art.currentTime;
    if (remaining <= 0 || !Number.isFinite(remaining)) return;
    const currentSecond = Math.floor(remaining);
    if (currentSecond === lastCheckSecond) return;
    lastCheckSecond = currentSecond;
    if (remaining <= 90 && opts.hasNextEpisode() && !dismissed && !isVisible) {
      showCapsule(remaining);
    }
  };

  const onLoadedData = () => {
    dismissed = false;
    wasShownThisEpisode = false;
    hideCapsule();
  };

  const onEnded = () => {
    hideCapsule();
    if (!dismissed && wasShownThisEpisode && opts.hasNextEpisode()) {
      opts.onNextEpisode();
    }
  };

  art.on('video:timeupdate', onTimeUpdate);
  art.on('video:loadeddata', onLoadedData);
  art.on('video:ended', onEnded);

  return {
    cleanup: () => {
      art.off('video:timeupdate', onTimeUpdate);
      art.off('video:loadeddata', onLoadedData);
      art.off('video:ended', onEnded);
      hideCapsule();
    },
    isCancelled: () => dismissed || !wasShownThisEpisode,
  };
}

// ── Feature 2: Long-press Temporary Speed ──────────────────────────

const SPEED_LAYER = 'deco-speed-boost-indicator';

export function attachLongPressSpeed(
  art: Artplayer,
  opts?: { speed?: number; thresholdMs?: number },
): { cleanup: () => void } {
  const speed = opts?.speed ?? 2.0;
  const thresholdMs = opts?.thresholdMs ?? 300;
  const MOVE_CANCEL = 10;

  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let isBoosted = false;
  let originalRate = 1;
  let startX = 0;
  let startY = 0;

  const video = art.template.$video;

  const activateBoost = () => {
    pressTimer = null;
    if (art.video.paused) return;
    originalRate = art.playbackRate;
    art.playbackRate = speed;
    isBoosted = true;
    art.layers.add({
      name: SPEED_LAYER,
      html: `<div class="deco-speed-boost">临时 ${speed}x</div>`,
      style: { zIndex: '45', pointerEvents: 'none' },
    });
  };

  const deactivateBoost = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (isBoosted) {
      art.playbackRate = originalRate;
      art.layers.remove(SPEED_LAYER);
      isBoosted = false;
    }
  };

  const isInControls = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !!(
      target.closest('.art-controls') ||
      target.closest('.art-progress') ||
      target.closest('.art-setting-panel')
    );
  };

  const onPressStart = (e: Event) => {
    if (isInControls(e.target)) return;
    const me = e as MouseEvent;
    const te = e as TouchEvent;
    startX = te.touches ? te.touches[0].clientX : me.clientX;
    startY = te.touches ? te.touches[0].clientY : me.clientY;
    pressTimer = setTimeout(activateBoost, thresholdMs);
  };

  const onPressEnd = () => {
    deactivateBoost();
  };

  const onTouchMove = (e: Event) => {
    if (isBoosted || !pressTimer) return;
    const te = e as TouchEvent;
    if (!te.touches.length) return;
    const dx = te.touches[0].clientX - startX;
    const dy = te.touches[0].clientY - startY;
    if (Math.hypot(dx, dy) > MOVE_CANCEL) {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }
  };

  const vEl = video as unknown as HTMLDivElement;
  const c1 = art.proxy(vEl, 'mousedown', onPressStart);
  const c2 = art.proxy(vEl, 'mouseup', onPressEnd);
  const c3 = art.proxy(vEl, 'mouseleave', onPressEnd);
  const c4 = art.proxy(vEl, 'touchstart', onPressStart);
  const c5 = art.proxy(vEl, 'touchend', onPressEnd);
  const c6 = art.proxy(vEl, 'touchcancel', onPressEnd);
  const c7 = art.proxy(vEl, 'touchmove', onTouchMove);

  return {
    cleanup: () => {
      c1();
      c2();
      c3();
      c4();
      c5();
      c6();
      c7();
      deactivateBoost();
    },
  };
}

// ── Feature 3: Keyboard Shortcuts Overlay ──────────────────────────

const SHORTCUTS_LAYER = 'deco-shortcuts-overlay';
const SHORTCUTS_CTRL = 'deco-shortcuts-btn';

function buildShortcutsHTML(): string {
  let body = '';
  for (const section of SHORTCUTS_DATA) {
    let rows = '';
    for (const item of section.items) {
      rows += `<div class="deco-shortcuts-row"><kbd>${item.keys}</kbd><span>${item.description}</span></div>`;
    }
    body += `<div class="deco-shortcuts-category"><div class="deco-shortcuts-category-title">${section.category}</div>${rows}</div>`;
  }
  return `<div class="deco-shortcuts-backdrop"><div class="deco-shortcuts-modal">
    <div class="deco-shortcuts-header"><span>键盘快捷键</span><button class="deco-shortcuts-close">&times;</button></div>
    <div class="deco-shortcuts-body">${body}</div>
  </div></div>`;
}

export function attachShortcutsOverlay(art: Artplayer): {
  cleanup: () => void;
  toggle: () => void;
} {
  let isVisible = false;

  const show = () => {
    if (isVisible) return;
    isVisible = true;
    art.layers.add({
      name: SHORTCUTS_LAYER,
      html: buildShortcutsHTML(),
      style: { zIndex: '60' },
      mounted(el) {
        const backdrop = el.querySelector('.deco-shortcuts-backdrop');
        const modal = el.querySelector('.deco-shortcuts-modal');
        const closeBtn = el.querySelector('.deco-shortcuts-close');
        if (backdrop) {
          art.proxy(
            backdrop as unknown as HTMLDivElement,
            'click',
            (e: Event) => {
              if (!modal || !modal.contains(e.target as Node)) hide();
            },
          );
        }
        if (closeBtn) {
          art.proxy(closeBtn as unknown as HTMLDivElement, 'click', () =>
            hide(),
          );
        }
      },
    });
  };

  const hide = () => {
    if (!isVisible) return;
    art.layers.remove(SHORTCUTS_LAYER);
    isVisible = false;
  };

  const toggle = () => {
    if (isVisible) hide();
    else show();
  };

  art.controls.add({
    name: SHORTCUTS_CTRL,
    position: 'right',
    index: 1,
    html: '<i class="art-icon flex"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></i>',
    tooltip: '快捷键帮助 (?)',
    click: toggle,
  });

  return {
    cleanup: () => {
      hide();
      art.controls.remove(SHORTCUTS_CTRL);
    },
    toggle,
  };
}
