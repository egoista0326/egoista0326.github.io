// Viewport-driven playback for muted clips.
//
// A "unit" is an element with `data-play-unit`; its <video> elements play and pause together.
//   data-play-unit=""      looping clips (one clip, or a row of clips that should move together);
//   data-play-unit="once"  an explanatory animation: plays once and rests on its last frame.
// A looping unit with `data-play-loops="N"` plays at most N loops on its own and then rests on its last frame
// (WCAG 2.2.2: moving content that starts by itself stops); while `data-play-force` is set it plays on, and a loop
// begun after the N loops (a replay) plays to its end, so the unit rests on its last frame again.
// A unit with `data-play-hold` is skipped until the attribute is removed. A unit with
// `data-play-force` was asked for by the user (a selected task, a replay): it plays while visible even
// when videos are paused; the page-level button clears every such request.
// A looping row whose clips wrap into one column (phones) plays clip by clip.
//
// A looping unit plays while any part of it is on screen: a clip the reader can see moves, also a hero cut by the
// bottom of a short screen (a 1280 x 585 laptop window, an iPhone SE). "Enough" of a unit is half of it, or half the
// viewport for tall units: a `once` unit starts only then (the reader sees it from its start), and a loop of a
// `data-play-loops` unit counts only when it ends with enough of it on screen (the N loops are loops the reader saw). At
// most MAX_PLAYING videos play at once (MAX_PLAYING_SMALL on phones); units with enough on screen come first, then
// units are ranked by how much of them is visible, and a unit that is already playing keeps a small advantage so
// playback does not flicker. A unit with only a part on screen starts only while no unit with enough on screen plays
// (a hero cut by the bottom of a short screen; a carousel's cued next clip waits): on a slow link, clips loading at
// the screen's edges would take the connection from the clips the reader looks at. One already playing goes on. A visible
// looping unit left out by that limit goes back to its first frame instead of resting mid-clip.
//
// One page-level button (`data-video-toggle`, labelled with what it will do) pauses and resumes every
// clip; its choice is kept for the tab's session (sessionStorage), so a reload keeps the clips paused. The clips are
// page content, not decoration (owner 2026-11-23): prefers-reduced-motion does not stop them; only a refused autoplay
// (below), that button and a hidden tab do.
//
// Nothing plays while the tab is hidden.
//
// Loading. Clips are `preload="none"` in the markup, so nothing loads that the reader never comes near. Posters given
// as `data-poster` load when the video comes within LAZY_MARGIN of the viewport (three screens: small files, and on a
// slow link a reader's flick outruns a shorter lead). The clips of units within PREFETCH_MARGIN (one screen above and below) are
// then asked to load (`preload="auto"`), nearest first and PREFETCH_AT_ONCE at a time, and only while every clip that
// should be playing already has data: the clips in view get the connection first, and a reader who stops on a clip
// usually finds it loaded.
//
// Recovery. A clip that should be playing is never left to the next scroll: a play() that is interrupted, and a pause
// the page did not ask for, are retried on the clip's own `loadeddata` / `canplay` and by a watchdog (every WATCH_MS,
// running only while such a clip exists); a clip whose loading died (an error, no source, or the network idle without
// enough data for STALL_MS) is loaded again, from where it was, at most MAX_RELOADS times.
// Autoplay refused (play() rejected with NotAllowedError, e.g. iOS Low Power Mode, Safari "Never Auto-Play", Firefox
// "Block Audio and Video", some in-app browsers): the poster stays, the unit gets `data-play-refused` (global.css draws
// a play mark on project clips), and the next gesture anywhere on the page (GESTURES: a press, a tap, a key, a scroll;
// a play() inside a user activation is allowed, a scroll is only a retry) plays every clip that should be playing; the
// mark goes only once a play() succeeds. WeChat's in-app browser allows play() inside its `WeixinJSBridgeReady`.
//
// Other scripts dispatch `clips:refresh` on document after changing a unit (hold, force, src, time). This
// script dispatches `clips:paused` (detail: { paused }) when the page-level button changes state; `isPaused()`
// tells the current state.

const MAX_PLAYING = 6;
const MAX_PLAYING_SMALL = 4;
const SMALL_SCREEN = '(max-width: 639px), (max-height: 500px)';
const VISIBLE_RATIO = 0.5;
const LAZY_MARGIN = '300% 0px';
const PREFETCH_MARGIN = '100% 0px';
const PREFETCH_AT_ONCE = 1;
const PREFETCH_START_MS = 2000;
const WATCH_MS = 1000;
const STALL_MS = 4000;
const MAX_RELOADS = 3;
const FORCED_BONUS = 1e6;
const FULL_BONUS = 1e5;
// Events that retry the clips that should be playing (see Recovery). The activating ones (HTML user activation:
// keydown, mousedown/pointerdown of a mouse, pointerup/touchend of a touch, click) run their play() inside the
// gesture; touchstart, scroll and wheel are retries only, at most one per RETRY_MS.
const GESTURES = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown', 'scroll', 'wheel'] as const;
const PASSIVE_GESTURES = new Set<string>(['touchstart', 'scroll', 'wheel']);
const RETRY_MS = 250;

type Mode = 'loop' | 'once';

interface Unit {
  el: HTMLElement;
  videos: HTMLVideoElement[];
  mode: Mode;
  /** On screen enough to play: any part (looping units) or `full` (`once` units). */
  visible: boolean;
  /** Half of it, or half the viewport, is on screen ("enough", see the visibility rule). */
  full: boolean;
  visibleHeight: number;
  playing: boolean;
  /** For one clip of a looping row: that row (whose attributes apply). */
  row?: Unit;
  /** `data-play-loops`: loops it may still play on its own (Infinity when unlimited). */
  loopsLeft: number;
  /** A loop begun after the loops were used up (a replay): it plays to its end even once no longer forced. */
  replaying: boolean;
}

/** Loading state of one video while it should be playing (see Recovery). */
interface Health {
  /** performance.now() of the last sign of life: chosen, playing with data, data arriving (`progress`), a reload. */
  alive: number;
  reloads: number;
  /** play() was refused (NotAllowedError): waits for a user gesture. */
  refused: boolean;
}

const smallScreen = window.matchMedia(SMALL_SCREEN);
const toggle = document.querySelector<HTMLButtonElement>('[data-video-toggle]');
const PAUSED_KEY = 'clips:paused';
// The page-level button's last choice in this tab ('1' paused, '0' playing); storage may be unavailable.
const storedPaused = (() => {
  try {
    return window.sessionStorage.getItem(PAUSED_KEY);
  } catch {
    return null;
  }
})();
// A page with the button starts as it was left in this tab; every other page plays.
let paused = toggle !== null && storedPaused === '1';
// Set while something heavier (the interactive demo) runs in view; separate from the user's toggle.
let suspended = false;

const modeOf = (el: HTMLElement): Mode => (el.dataset.playUnit === 'once' ? 'once' : 'loop');
const newUnit = (el: HTMLElement, videos: HTMLVideoElement[], mode: Mode, row?: Unit): Unit => ({
  el,
  videos,
  mode,
  visible: false,
  full: false,
  visibleHeight: 0,
  playing: false,
  row,
  loopsLeft: mode === 'loop' && el.dataset.playLoops ? Number(el.dataset.playLoops) : Infinity,
  replaying: false
});

// Looping rows of several clips also get one unit per clip; layout decides which of the two plays.
const units = new Map<Element, Unit>();
const rows: Unit[] = [];
for (const el of document.querySelectorAll<HTMLElement>('[data-play-unit]')) {
  const unit = newUnit(el, [...el.querySelectorAll('video')], modeOf(el));
  units.set(el, unit);
  if (unit.mode !== 'loop' || unit.videos.length < 2) continue;
  rows.push(unit);
  for (const video of unit.videos) units.set(video, newUnit(video, [video], 'loop', unit));
}

const owner = (unit: Unit) => unit.row ?? unit;
const held = (unit: Unit) => owner(unit).el.hasAttribute('data-play-hold');
const forced = (unit: Unit) => owner(unit).el.hasAttribute('data-play-force');
const finished = (unit: Unit) =>
  (unit.mode === 'once' && unit.videos.every((v) => v.ended)) || (unit.loopsLeft <= 0 && !forced(unit) && !unit.replaying);
const wanted = (unit: Unit) =>
  unit.visible &&
  !held(unit) &&
  !finished(unit) &&
  !suspended &&
  document.visibilityState === 'visible' &&
  (forced(unit) || !paused);

// A row is stacked when its second clip starts below its first (hidden rows have no size).
const stacked = (row: Unit) => {
  const [first, second] = row.videos.map((video) => video.getBoundingClientRect());
  return first.width > 0 && second.top >= first.bottom - 1;
};

// The videos that should be playing now (those of the units reconcile chose), with their unit.
const chosenVideos = new Map<HTMLVideoElement, Unit>();
const health = new Map<HTMLVideoElement, Health>();
// Prefetch: the units near the viewport, and the videos asked to load ahead with the time they were asked.
const near = new Set<Unit>();
const prefetching = new Map<HTMLVideoElement, number>();
let pumpTimer = 0;
// Posters requested and not yet arrived (loadPoster): loading ahead waits for them.
let postersLoading = 0;
const restsAtEnd = (video: HTMLVideoElement, unit: Unit) => unit.mode !== 'loop' && video.ended;

let watchTimer = 0;
const watch = () => {
  if (!watchTimer) watchTimer = window.setTimeout(check, WATCH_MS);
};

const markRefused = (unit: Unit) => {
  const { el, videos } = owner(unit);
  el.toggleAttribute('data-play-refused', videos.some((video) => health.get(video)?.refused));
};

const playVideo = (video: HTMLVideoElement) => {
  // A clip asked to play loads now, whatever its preload hint said.
  if (video.preload !== 'auto') video.preload = 'auto';
  video.play().then(
    () => {
      const state = health.get(video);
      const unit = chosenVideos.get(video);
      if (state) state.refused = false;
      if (unit && owner(unit).el.hasAttribute('data-play-refused')) markRefused(unit);
    },
    (error: unknown) => {
      const state = health.get(video);
      const unit = chosenVideos.get(video);
      if (!state || !unit) return;
      if ((error as { name?: string } | null)?.name === 'NotAllowedError') {
        // Autoplay refused: the poster stays until a user gesture (unlock below).
        state.refused = true;
        markRefused(unit);
      } else {
        // Interrupted (a pause or a new load before playback began) or failed: the watchdog looks again.
        watch();
      }
    }
  );
};

const start = (unit: Unit) => {
  unit.playing = true;
  if (unit.loopsLeft <= 0) unit.replaying = true;
  for (const video of unit.videos) {
    if (restsAtEnd(video, unit)) continue;
    playVideo(video);
  }
  watch();
};

const stop = (unit: Unit) => {
  unit.playing = false;
  for (const video of unit.videos) video.pause();
};

// Loads `video` again from where it was: its loading died (see Recovery).
const reload = (video: HTMLVideoElement, state: Health) => {
  state.reloads += 1;
  state.alive = performance.now();
  const at = video.currentTime;
  video.load();
  if (at > 0) video.currentTime = at;
  playVideo(video);
};

// The watchdog: one pass over the videos that should be playing; it runs again only while one of them does not.
function check() {
  watchTimer = 0;
  const now = performance.now();
  let again = false;
  for (const [video, unit] of chosenVideos) {
    const state = health.get(video);
    if (!state || state.refused || restsAtEnd(video, unit)) continue;
    if (!video.paused && video.readyState >= video.HAVE_FUTURE_DATA) {
      state.alive = now;
      continue;
    }
    again = true;
    if (video.paused) {
      playVideo(video);
      continue;
    }
    // Waiting for data: wait while it arrives; load again once none came for STALL_MS (doubled per reload). A load
    // that failed (an error, or no source left, e.g. a request dropped while loading ahead) is loaded again at once.
    const failed = video.error !== null || video.networkState === video.NETWORK_NO_SOURCE;
    const limit = STALL_MS * (failed ? 2 ** state.reloads - 1 : 2 ** state.reloads);
    if (now - state.alive >= limit && state.reloads < MAX_RELOADS) reload(video, state);
  }
  if (again) watch();
  pump();
}

const maxPlaying = () => (smallScreen.matches ? MAX_PLAYING_SMALL : MAX_PLAYING);

const reconcile = () => {
  const split = new Set(rows.filter(stacked));
  const active = (unit: Unit) => (unit.row ? split.has(unit.row) : !split.has(unit));
  const ordered = [...units.values()].filter((unit) => active(unit) && wanted(unit));
  const score = (unit: Unit) =>
    (forced(unit) ? FORCED_BONUS : 0) + (unit.full ? FULL_BONUS : 0) + unit.visibleHeight * (unit.playing ? 1.25 : 1);
  ordered.sort((a, b) => score(b) - score(a));
  let budget = maxPlaying();
  const chosen = new Set<Unit>();
  for (const unit of ordered) {
    if (unit.videos.length > budget) continue;
    chosen.add(unit);
    budget -= unit.videos.length;
  }
  // Units with only a part on screen start only while no unit with enough on screen is chosen (see above).
  const primary = (unit: Unit) => unit.full || forced(unit);
  if ([...chosen].some(primary)) {
    for (const unit of [...chosen]) if (!primary(unit) && !unit.playing) chosen.delete(unit);
  }
  // Stop before starting: a row and its own clips share videos.
  const skipped = new Set(ordered.filter((unit) => !chosen.has(unit) && unit.mode !== 'once'));
  for (const unit of units.values()) {
    if (chosen.has(unit)) continue;
    if (unit.playing) stop(unit);
    if (!skipped.has(unit)) continue;
    for (const video of unit.videos) {
      if (video.currentTime > 0) video.currentTime = 0;
    }
  }
  const now = performance.now();
  const previous = new Set(chosenVideos.keys());
  chosenVideos.clear();
  for (const unit of chosen) {
    for (const video of unit.videos) {
      chosenVideos.set(video, unit);
      if (!previous.has(video)) health.set(video, { alive: now, reloads: 0, refused: false });
    }
  }
  for (const video of previous) {
    if (chosenVideos.has(video)) continue;
    health.delete(video);
  }
  // A unit no longer chosen loses its play mark (its videos have no health entry left).
  for (const unit of units.values()) {
    if (unit.el.hasAttribute('data-play-refused')) markRefused(unit);
  }
  for (const unit of chosen) {
    if (!unit.playing || unit.videos.some((v) => v.paused && !restsAtEnd(v, unit))) start(unit);
  }
  pump();
};

const setPaused = (value: boolean) => {
  const changed = paused !== value;
  paused = value;
  // A text button says what it will do; an icon button (`data-toggle-icon`, the /dexgo/ nav) says it in its name and
  // shows the matching glyph (global.css, [data-paused]).
  if (toggle?.hasAttribute('data-toggle-icon')) {
    toggle.setAttribute('aria-label', paused ? 'Play all motion' : 'Pause all motion');
    toggle.toggleAttribute('data-paused', paused);
  } else if (toggle) toggle.textContent = paused ? 'Play videos' : 'Pause videos';
  reconcile();
  if (changed) document.dispatchEvent(new CustomEvent('clips:paused', { detail: { paused } }));
};

/** True while the page's clips are paused (the page-level button, or its choice kept for this tab). */
export const isPaused = (): boolean => paused;

// Loop-limited units: each loop end counts; the clip restarts until its loops are used up (or while forced).
for (const unit of units.values()) {
  if (unit.loopsLeft === Infinity) continue;
  for (const video of unit.videos) {
    video.loop = false;
    video.addEventListener('ended', () => {
      // A loop counts only when the reader could see it (see the visibility rule above).
      if (unit.full || forced(unit)) unit.loopsLeft -= 1;
      unit.replaying = false;
      if (wanted(unit)) {
        if (unit.loopsLeft <= 0) unit.replaying = true;
        video.currentTime = 0;
        video.play().catch(() => undefined);
      } else {
        unit.playing = false;
        reconcile();
      }
    });
  }
}

for (const unit of units.values()) {
  if (unit.row || unit.mode !== 'once') continue;
  for (const video of unit.videos) {
    video.loop = false;
    video.addEventListener('ended', () => {
      unit.playing = false;
      reconcile();
    });
  }
}

// Recovery and prefetch react to each clip's own loading events, not only to scrolling.
const allVideos = new Set([...units.values()].flatMap((unit) => unit.videos));
for (const video of allVideos) {
  const ready = () => {
    const unit = chosenVideos.get(video);
    if (unit && video.paused && !health.get(video)?.refused && !restsAtEnd(video, unit)) playVideo(video);
    pump();
  };
  video.addEventListener('loadeddata', ready);
  video.addEventListener('canplay', ready);
  for (const type of ['loadedmetadata', 'canplaythrough', 'suspend']) video.addEventListener(type, () => pump());
  video.addEventListener('progress', () => {
    const state = health.get(video);
    if (state) state.alive = performance.now();
  });
  const look = () => {
    if (chosenVideos.has(video)) watch();
    pump();
  };
  for (const type of ['pause', 'stalled', 'waiting', 'emptied']) video.addEventListener(type, look);
  // A failed <source> fires its `error` on the source element; capture sees it on the video.
  video.addEventListener('error', look, true);
}

// The page-level button applies to every clip, including those the user started one by one.
toggle?.addEventListener('click', () => {
  for (const el of document.querySelectorAll('[data-play-force]')) el.removeAttribute('data-play-force');
  setPaused(!paused);
  try {
    window.sessionStorage.setItem(PAUSED_KEY, paused ? '1' : '0');
  } catch {
    // Without storage the choice holds only until the page is left.
  }
});
// "Replay" buttons restart the explanatory animations inside their `data-replay-scope`.
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-replay]')) {
  button.addEventListener('click', () => {
    const scope = button.closest('[data-replay-scope]');
    for (const el of scope?.querySelectorAll<HTMLElement>('[data-play-unit="once"]') ?? []) {
      for (const video of el.querySelectorAll('video')) video.currentTime = 0;
      el.setAttribute('data-play-force', '');
    }
    reconcile();
  });
}
// Autoplay refused: a gesture anywhere retries every clip that should be playing and does not (see Recovery); an
// activating one is a user activation, inside which play() is allowed. The play mark stays until a play() succeeds.
let lastRetry = -Infinity;
let retryTimer = 0;
const retry = () => {
  lastRetry = performance.now();
  for (const [video, unit] of chosenVideos) {
    const state = health.get(video);
    if (!state || !video.paused || restsAtEnd(video, unit)) continue;
    state.refused = false;
    playVideo(video);
  }
};
const unlock = (event: Event) => {
  // A passive gesture within RETRY_MS of the last retry is folded into one retry at its end (the last of a scroll counts).
  const wait = PASSIVE_GESTURES.has(event.type) ? lastRetry + RETRY_MS - performance.now() : 0;
  if (wait <= 0) return retry();
  if (!retryTimer) {
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      retry();
    }, wait);
  }
};
for (const type of GESTURES) document.addEventListener(type, unlock, { capture: true, passive: true });
// WeChat's in-app browser lets a play() inside this event start a muted clip that would otherwise be refused.
document.addEventListener('WeixinJSBridgeReady', unlock);
document.addEventListener('clips:suspend', () => {
  suspended = true;
  reconcile();
});
document.addEventListener('clips:resume', () => {
  suspended = false;
  reconcile();
});
document.addEventListener('visibilitychange', reconcile);
smallScreen.addEventListener('change', reconcile);
if (toggle) setPaused(paused);

// Prefetch (see Loading): units near the viewport, nearest first, while every clip in view has data. A prefetch is
// under way until the video has enough data, failed, or its network went idle (iOS Safari loads only the metadata).
function pump() {
  // Nothing loads ahead while the clips are paused or suspended (the running demo needs the connection) or the tab is
  // hidden.
  if (paused || suspended || postersLoading > 0 || document.visibilityState !== 'visible') return;
  for (const [video, unit] of chosenVideos) {
    const state = health.get(video);
    const waiting = state && !state.refused && state.reloads < MAX_RELOADS && video.readyState < video.HAVE_FUTURE_DATA;
    if (waiting && !restsAtEnd(video, unit)) return;
  }
  const now = performance.now();
  let grace = Infinity;
  for (const [video, asked] of prefetching) {
    // A video just asked may not have started its network yet.
    const loading = video.networkState === video.NETWORK_LOADING || now - asked < PREFETCH_START_MS;
    if (!loading || video.error !== null || video.readyState >= video.HAVE_ENOUGH_DATA) prefetching.delete(video);
    else if (video.networkState !== video.NETWORK_LOADING) grace = Math.min(grace, asked + PREFETCH_START_MS - now);
  }
  if (grace !== Infinity && !pumpTimer) {
    pumpTimer = window.setTimeout(() => {
      pumpTimer = 0;
      pump();
    }, grace + 50);
  }
  if (prefetching.size >= PREFETCH_AT_ONCE || near.size === 0) return;
  const middle = window.innerHeight / 2;
  const candidates = [...near]
    .flatMap((unit) => unit.videos)
    .filter((video) => video.preload === 'none' && video.readyState === video.HAVE_NOTHING)
    .map((video) => {
      const box = video.getBoundingClientRect();
      return { video, distance: Math.abs(box.top + box.height / 2 - middle) };
    })
    .sort((a, b) => a.distance - b.distance);
  for (const { video } of candidates) {
    if (prefetching.size >= PREFETCH_AT_ONCE) break;
    video.preload = 'auto';
    prefetching.set(video, now);
  }
}

if (units.size > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const unit = units.get(entry.target);
        if (!unit) continue;
        const viewport = entry.rootBounds?.height ?? window.innerHeight;
        unit.visibleHeight = entry.isIntersecting ? entry.intersectionRect.height : 0;
        unit.full =
          entry.isIntersecting &&
          (entry.intersectionRatio >= VISIBLE_RATIO || entry.intersectionRect.height >= viewport * VISIBLE_RATIO);
        unit.visible = unit.mode === 'once' ? unit.full : unit.visibleHeight > 0;
      }
      reconcile();
    },
    { threshold: [0, 0.25, VISIBLE_RATIO, 0.75, 1] }
  );

  for (const el of units.keys()) observer.observe(el);
  document.addEventListener('clips:refresh', reconcile);

  // Only whole units (not the clips of a row) are prefetched.
  const nearObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const unit = units.get(entry.target);
        if (!unit) continue;
        if (entry.isIntersecting) near.add(unit);
        else near.delete(unit);
      }
      pump();
    },
    { rootMargin: PREFETCH_MARGIN }
  );
  for (const [el, unit] of units) if (!unit.row) nearObserver.observe(el);
}

// Lazy posters: hidden panels (e.g. the second hand) never come near the viewport until shown. Each poster is set at
// once and also requested as an image (the same request, from the browser's memory cache), which tells when it has
// arrived: while any is on its way, nothing is loaded ahead (pump), so on a slow link the posters of the clips coming
// into view are not queued behind clips loading ahead (a white box where a poster should be). Clips asked to play
// still load at once.
function loadPoster(video: HTMLVideoElement, url: string) {
  video.poster = url;
  postersLoading += 1;
  const image = new Image();
  const done = () => {
    postersLoading -= 1;
    pump();
  };
  image.addEventListener('load', done, { once: true });
  image.addEventListener('error', done, { once: true });
  image.src = url;
}
const lazy = [...document.querySelectorAll<HTMLVideoElement>('video[data-poster]')];
if (lazy.length > 0) {
  const posterObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const video = entry.target as HTMLVideoElement;
        const poster = video.dataset.poster;
        if (poster) loadPoster(video, poster);
        posterObserver.unobserve(video);
      }
    },
    { rootMargin: LAZY_MARGIN }
  );
  for (const video of lazy) posterObserver.observe(video);
}
