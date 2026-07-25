"use client";

/**
 * Game audio — Web Audio UI/game SFX + a real ambient theme loop.
 *
 * Theme: "Sector" from Dark Sci-Fi Audio Pack by SRG774 (CC0)
 * https://opengameart.org/content/dark-sci-fi-audio-pack
 *
 * UI click/hover recipe mirrors soft tactical UI (sine chirps, dual-layer click).
 */

const MUSIC_KEY = "itw_music_on";
const SFX_KEY = "itw_sfx_on";
const THEME_URL = "/audio/theme.mp3";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;

let musicOn = false;
let sfxOn = true;

/* Sampled theme */
let themeBuffer: AudioBuffer | null = null;
let themeSource: AudioBufferSourceNode | null = null;
let themeLoading: Promise<AudioBuffer | null> | null = null;

/* Villager work loop */
let workGain: GainNode | null = null;
let workTimer: number | null = null;

let uiInstalled = false;
let lastHoverAt = 0;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.22;
    musicGain.connect(masterGain);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.65;
    sfxGain.connect(masterGain);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function readMusicPref(): boolean {
  try {
    return window.localStorage.getItem(MUSIC_KEY) === "1";
  } catch {
    return false;
  }
}

export function readSfxPref(): boolean {
  try {
    return window.localStorage.getItem(SFX_KEY) !== "0";
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Low-level tone helper (Volt-style soft UI)                          */
/* ------------------------------------------------------------------ */

type ToneOpts = {
  type?: OscillatorType;
  f0?: number;
  f1?: number | null;
  dur?: number;
  vol?: number;
  attack?: number;
  dest?: GainNode | null;
};

function tone({
  type = "sine",
  f0 = 440,
  f1 = null,
  dur = 0.08,
  vol = 0.18,
  attack = 0.004,
  dest = null,
}: ToneOpts = {}) {
  const c = ensureCtx();
  const out = dest ?? sfxGain;
  if (!c || !out || !sfxOn) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  }
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(Math.max(1e-4, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Soft dual-tone click — mid fundamental + quiet high overtone */
export function playUiClick(): void {
  if (!sfxOn) return;
  tone({ type: "sine", f0: 520, f1: 660, dur: 0.085, vol: 0.07, attack: 0.012 });
  tone({ type: "sine", f0: 1040, dur: 0.05, vol: 0.018, attack: 0.012 });
}

/** Tiny upward hover chirp */
export function playUiHover(): void {
  if (!sfxOn) return;
  const now = performance.now();
  if (now - lastHoverAt < 45) return;
  lastHoverAt = now;
  tone({ type: "sine", f0: 880, f1: 1320, dur: 0.05, vol: 0.045, attack: 0.004 });
}

/**
 * Global UI SFX like Volt: click/hover on buttons & links via delegation.
 * Opt out with data-snd="off" / data-nohover="1".
 */
export function installUiSounds(): void {
  if (typeof window === "undefined" || uiInstalled) return;
  uiInstalled = true;

  const onPointerDown = () => {
    unlockAudio();
  };

  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.(
      "button, a, [role=button], input, select, summary"
    ) as HTMLElement | null;
    if (!el) return;
    if (el.dataset.snd === "off") return;
    if (el.getAttribute("aria-disabled") === "true") return;
    if ((el as HTMLButtonElement).disabled) return;
    const kind = el.dataset.snd || "click";
    if (kind === "click") playUiClick();
    else if (kind === "hover") playUiHover();
  };

  const onPointerOver = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.(
      "button, a, [role=button]"
    ) as HTMLElement | null;
    if (!el) return;
    if (el.dataset.nohover === "1" || el.dataset.snd === "off") return;
    if ((el as HTMLButtonElement).disabled) return;
    // Only when entering the interactive element itself (not bubbling children spam)
    const related = e.relatedTarget as Node | null;
    if (related && el.contains(related)) return;
    playUiHover();
  };

  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("click", onClick, true);
  window.addEventListener("pointerover", onPointerOver, true);
}

/* ------------------------------------------------------------------ */
/* Theme music — sampled ambient loop (not synth beeps)                */
/* ------------------------------------------------------------------ */

async function loadThemeBuffer(): Promise<AudioBuffer | null> {
  if (themeBuffer) return themeBuffer;
  if (themeLoading) return themeLoading;
  themeLoading = (async () => {
    try {
      const c = ensureCtx();
      if (!c) return null;
      const res = await fetch(THEME_URL, { cache: "force-cache" });
      if (!res.ok) return null;
      const raw = await res.arrayBuffer();
      themeBuffer = await c.decodeAudioData(raw.slice(0));
      return themeBuffer;
    } catch (err) {
      console.warn("Theme load failed", err);
      return null;
    } finally {
      themeLoading = null;
    }
  })();
  return themeLoading;
}

function stopThemeSource() {
  if (themeSource) {
    try {
      themeSource.stop();
    } catch {
      /* already stopped */
    }
    try {
      themeSource.disconnect();
    } catch {
      /* ignore */
    }
    themeSource = null;
  }
}

async function startThemeSource() {
  const c = ensureCtx();
  if (!c || !musicGain) return;
  const buf = await loadThemeBuffer();
  if (!buf || !musicOn) return;
  stopThemeSource();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(musicGain);
  src.start(0);
  themeSource = src;
}

export function startMusic(): void {
  const c = ensureCtx();
  if (!c) return;
  musicOn = true;
  try {
    window.localStorage.setItem(MUSIC_KEY, "1");
  } catch {
    /* private mode */
  }
  void startThemeSource();
}

export function stopMusic(): void {
  musicOn = false;
  stopThemeSource();
  try {
    window.localStorage.setItem(MUSIC_KEY, "0");
  } catch {
    /* private mode */
  }
}

export function toggleMusic(): boolean {
  if (musicOn) {
    stopMusic();
    return false;
  }
  startMusic();
  return true;
}

export function isMusicOn(): boolean {
  return musicOn;
}

/* ------------------------------------------------------------------ */
/* Game SFX                                                            */
/* ------------------------------------------------------------------ */

export function setSfxOn(on: boolean): void {
  sfxOn = on;
  try {
    window.localStorage.setItem(SFX_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
  if (!on) stopVillagerWork();
}

export function isSfxOn(): boolean {
  return sfxOn;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** March launched — soft rising brass call (triangle, not harsh saw) */
export function playAttackSound(): void {
  if (!sfxOn) return;
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  const t = c.currentTime;
  [220, 293.66, 392].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, t + i * 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t + i * 0.09);
    g.gain.linearRampToValueAtTime(0.38, t + i * 0.09 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.48);
    osc.connect(g).connect(sfxGain!);
    osc.start(t + i * 0.09);
    osc.stop(t + i * 0.09 + 0.52);
  });
}

/** You are under attack — tense but not square-wave alarm */
export function playUnderAttackSound(): void {
  if (!sfxOn) return;
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  const t = c.currentTime;

  for (let i = 0; i < 3; i++) {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(311, t + i * 0.28);
    osc.frequency.setValueAtTime(233, t + i * 0.28 + 0.14);
    const g = c.createGain();
    g.gain.setValueAtTime(0.2, t + i * 0.28);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.28 + 0.26);
    osc.connect(g).connect(sfxGain!);
    osc.start(t + i * 0.28);
    osc.stop(t + i * 0.28 + 0.28);
  }

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.7);
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 160;
  const g = c.createGain();
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  src.connect(filt).connect(g).connect(sfxGain);
  src.start(t);
}

/** Building placed — wooden thud + settle */
export function playBuildSound(): void {
  if (!sfxOn) return;
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  const t = c.currentTime;

  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(52, t + 0.18);
  const g = c.createGain();
  g.gain.setValueAtTime(0.75, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  osc.connect(g).connect(sfxGain);
  osc.start(t);
  osc.stop(t + 0.3);

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.15);
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 900;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.22, t + 0.02);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  src.connect(filt).connect(g2).connect(sfxGain);
  src.start(t + 0.02);
}

/** Rocket stocked — short snare + blip */
export function playRecruitSound(): void {
  if (!sfxOn) return;
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.12);
  const filt = c.createBiquadFilter();
  filt.type = "highpass";
  filt.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.26, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(filt).connect(g).connect(sfxGain);
  src.start(t);

  tone({ type: "triangle", f0: 523.25, f1: 659.25, dur: 0.2, vol: 0.22, attack: 0.01 });
}

/** Coin/collect chime */
export function playCoinSound(): void {
  if (!sfxOn) return;
  tone({ type: "sine", f0: 880, dur: 0.28, vol: 0.18, attack: 0.008 });
  tone({ type: "sine", f0: 1174.66, dur: 0.32, vol: 0.14, attack: 0.01 });
}

/** Contested gem appeared on the map — bright sparkle arpeggio */
export function playGemSpawnSound(): void {
  if (!sfxOn) return;
  const c = ensureCtx();
  const out = sfxGain;
  if (!c || !out) return;
  const t = c.currentTime;
  const notes = [783.99, 987.77, 1318.51, 1567.98]; // G5 B5 E6 G6
  notes.forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = i % 2 === 0 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(f, t + i * 0.055);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.055);
    g.gain.exponentialRampToValueAtTime(0.2 - i * 0.03, t + i * 0.055 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.055 + 0.35);
    osc.connect(g).connect(out);
    osc.start(t + i * 0.055);
    osc.stop(t + i * 0.055 + 0.38);
  });
  // Soft shimmer noise
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.22);
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 3200;
  filt.Q.value = 2.5;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.12, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  src.connect(filt).connect(g2).connect(out);
  src.start(t);
}

/* ------------------------------------------------------------------ */
/* Villager working loop — proximity gain set by the map              */
/* ------------------------------------------------------------------ */

function villagerChop() {
  const c = ensureCtx();
  if (!c || !workGain) return;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.08);
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 600 + Math.random() * 500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.8, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  src.connect(filt).connect(g).connect(workGain);
  src.start(t);

  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(110 + Math.random() * 40, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.5, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(g2).connect(workGain);
  osc.start(t);
  osc.stop(t + 0.14);
}

/**
 * Keep the villager work loop running at `level` (0 = silent, 1 = close).
 * Call every frame/interval from the map with proximity computed there.
 */
export function setVillagerWorkLevel(level: number): void {
  if (!sfxOn || level <= 0.02) {
    stopVillagerWork();
    return;
  }
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  if (!workGain) {
    workGain = c.createGain();
    workGain.gain.value = 0;
    workGain.connect(sfxGain);
  }
  workGain.gain.setTargetAtTime(Math.min(1, level) * 0.5, c.currentTime, 0.25);
  if (workTimer == null) {
    const tick = () => {
      villagerChop();
      workTimer = window.setTimeout(tick, 450 + Math.random() * 500);
    };
    tick();
  }
}

export function stopVillagerWork(): void {
  if (workTimer != null) {
    window.clearTimeout(workTimer);
    workTimer = null;
  }
  if (workGain && ctx) {
    workGain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
  }
}

/** Resume audio context on first user gesture (mobile autoplay policy) */
export function unlockAudio(): void {
  ensureCtx();
  // Warm-load theme so music toggle feels instant
  void loadThemeBuffer();
}
