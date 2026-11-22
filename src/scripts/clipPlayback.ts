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
// when videos are paused or reduced motion is on; the page-level button clears every such request.
// A looping row whose clips wrap into one column (phones) plays clip by clip.
//
// A unit plays while enough of it is visible (half of it, or half the viewport for tall units). At
// most MAX_PLAYING videos play at once; units are ranked by how much of them is visible, and a unit
// that is already playing keeps a small advantage so playback does not flicker. A visible looping unit
// left out by that limit goes back to its first frame instead of resting mid-clip.
//
// One page-level button (`data-video-toggle`, labelled with what it will do) pauses and resumes every
// clip; its choice is kept for the tab's session (sessionStorage), so a reload keeps the clips paused. With
// prefers-reduced-motion nothing autoplays and the button starts as "Play videos"; pages without that button
// give videos native controls instead (or only their poster with `data-reduced-motion="poster"`).
//
// Nothing plays while the tab is hidden.
//
// Posters given as `data-poster` load only when the video comes within LAZY_MARGIN of the viewport; under
// reduced motion a video with `data-poster-still` takes that one.
// Other scripts dispatch `clips:refresh` on document after changing a unit (hold, force, src, time). This
// script dispatches `clips:paused` (detail: { paused }) when the page-level button changes state; `isPaused()`
// tells the current state.

const MAX_PLAYING = 6;
const VISIBLE_RATIO = 0.5;
const LAZY_MARGIN = '800px 0px';
const FORCED_BONUS = 1e6;

type Mode = 'loop' | 'once';

interface Unit {
  el: HTMLElement;
  videos: HTMLVideoElement[];
  mode: Mode;
  visible: boolean;
  visibleHeight: number;
  playing: boolean;
  /** For one clip of a looping row: that row (whose attributes apply). */
  row?: Unit;
  /** `data-play-loops`: loops it may still play on its own (Infinity when unlimited). */
  loopsLeft: number;
  /** A loop begun after the loops were used up (a replay): it plays to its end even once no longer forced. */
  replaying: boolean;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
// Reduced motion always starts paused; otherwise a page with the button starts as it was left.
let paused = reducedMotion || (toggle !== null && storedPaused === '1');
// Set while something heavier (the interactive demo) runs in view; separate from the user's toggle.
let suspended = false;

const modeOf = (el: HTMLElement): Mode => (el.dataset.playUnit === 'once' ? 'once' : 'loop');
const newUnit = (el: HTMLElement, videos: HTMLVideoElement[], mode: Mode, row?: Unit): Unit => ({
  el,
  videos,
  mode,
  visible: false,
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

if (reducedMotion && !toggle) {
  for (const unit of units.values()) {
    for (const video of unit.videos) {
      if (video.dataset.reducedMotion !== 'poster') video.controls = true;
    }
  }
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
  (forced(unit) || (!paused && (toggle !== null || !reducedMotion)));

// A row is stacked when its second clip starts below its first (hidden rows have no size).
const stacked = (row: Unit) => {
  const [first, second] = row.videos.map((video) => video.getBoundingClientRect());
  return first.width > 0 && second.top >= first.bottom - 1;
};

const start = (unit: Unit) => {
  unit.playing = true;
  if (unit.loopsLeft <= 0) unit.replaying = true;
  for (const video of unit.videos) {
    if (unit.mode !== 'loop' && video.ended) continue;
    video.play().catch(() => {
      // Playback can be refused (e.g. data saver); the poster stays visible.
    });
  }
};

const stop = (unit: Unit) => {
  unit.playing = false;
  for (const video of unit.videos) video.pause();
};

const reconcile = () => {
  const split = new Set(rows.filter(stacked));
  const active = (unit: Unit) => (unit.row ? split.has(unit.row) : !split.has(unit));
  const ordered = [...units.values()].filter((unit) => active(unit) && wanted(unit));
  const score = (unit: Unit) =>
    (forced(unit) ? FORCED_BONUS : 0) + unit.visibleHeight * (unit.playing ? 1.25 : 1);
  ordered.sort((a, b) => score(b) - score(a));
  let budget = MAX_PLAYING;
  const chosen = new Set<Unit>();
  for (const unit of ordered) {
    if (unit.videos.length > budget) continue;
    chosen.add(unit);
    budget -= unit.videos.length;
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
  for (const unit of chosen) {
    if (!unit.playing || unit.videos.some((v) => v.paused && !(unit.mode !== 'loop' && v.ended))) start(unit);
  }
};

const setPaused = (value: boolean) => {
  const changed = paused !== value;
  paused = value;
  if (toggle) toggle.textContent = paused ? 'Play videos' : 'Pause videos';
  reconcile();
  if (changed) document.dispatchEvent(new CustomEvent('clips:paused', { detail: { paused } }));
};

/** True while the page's clips are paused (the page-level button, or reduced motion before any click). */
export const isPaused = (): boolean => paused;

// Loop-limited units: each loop end counts; the clip restarts until its loops are used up (or while forced).
for (const unit of units.values()) {
  if (unit.loopsLeft === Infinity) continue;
  for (const video of unit.videos) {
    video.loop = false;
    video.addEventListener('ended', () => {
      unit.loopsLeft -= 1;
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
document.addEventListener('clips:suspend', () => {
  suspended = true;
  reconcile();
});
document.addEventListener('clips:resume', () => {
  suspended = false;
  reconcile();
});
document.addEventListener('visibilitychange', reconcile);
if (toggle) setPaused(paused);

if (units.size > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const unit = units.get(entry.target);
        if (!unit) continue;
        const viewport = entry.rootBounds?.height ?? window.innerHeight;
        unit.visibleHeight = entry.isIntersecting ? entry.intersectionRect.height : 0;
        unit.visible =
          entry.isIntersecting &&
          (entry.intersectionRatio >= VISIBLE_RATIO || entry.intersectionRect.height >= viewport * VISIBLE_RATIO);
      }
      reconcile();
    },
    { threshold: [0, 0.25, VISIBLE_RATIO, 0.75, 1] }
  );

  for (const el of units.keys()) observer.observe(el);
  document.addEventListener('clips:refresh', reconcile);
}

// Lazy posters: hidden panels (e.g. the second hand) never come near the viewport until shown.
const lazy = [...document.querySelectorAll<HTMLVideoElement>('video[data-poster]')];
if (lazy.length > 0) {
  const posterObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const video = entry.target as HTMLVideoElement;
        const poster = (reducedMotion && video.dataset.posterStill) || video.dataset.poster;
        if (poster) video.poster = poster;
        posterObserver.unobserve(video);
      }
    },
    { rootMargin: LAZY_MARGIN }
  );
  for (const video of lazy) posterObserver.observe(video);
}
