export const DEFAULT_PLAYBACK_RATE = 1;
export const PLAYBACK_RATE_MINIMUM = 0.1;
export const PLAYBACK_RATE_MAXIMUM = 5;
export const PLAYBACK_RATE_SLIDER_STEP = 0.01;
export const PLAYBACK_RATE_PRESETS = Object.freeze([0.25, 0.5, 1, 1.25, 1.5, 2]);

export function normalizePlaybackRate(value, fallback = DEFAULT_PLAYBACK_RATE) {
  const numericValue = Number(value);
  const numericFallback = Number(fallback);
  const resolvedValue = Number.isFinite(numericValue)
    ? numericValue
    : (Number.isFinite(numericFallback) ? numericFallback : DEFAULT_PLAYBACK_RATE);
  const boundedValue = Math.min(PLAYBACK_RATE_MAXIMUM, Math.max(PLAYBACK_RATE_MINIMUM, resolvedValue));
  return Number((Math.round(boundedValue / PLAYBACK_RATE_SLIDER_STEP) * PLAYBACK_RATE_SLIDER_STEP).toFixed(2));
}

export function formatPlaybackRate(value) {
  return normalizePlaybackRate(value).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1") + "×";
}

export function isPlaybackRatePresetActive(value, preset) {
  return Math.abs(normalizePlaybackRate(value) - normalizePlaybackRate(preset)) < PLAYBACK_RATE_SLIDER_STEP / 2;
}
