"use client";

/**
 * Procedural game audio — Web Audio API, no asset files.
 * Everything is synthesized: theme loop, combat stingers, build thuds,
 * and a proximity-based villager work loop.
 */

const MUSIC_KEY = "itw_music_on";
const SFX_KEY = "itw_sfx_on";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;

let musicOn = false;
let sfxOn = true;
let musicTimer: number | null = null;
let musicStep = 0;

/* Villager work loop */
let workGain: GainNode | null = null;
let workTimer: number | null = null;

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
    musicGain.gain.value = 0.16;
    musicGain.connect(masterGain);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.6;
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
/* Theme music — slow minor arpeggio over a drone, RTS dusk mood       */
/* ------------------------------------------------------------------ */

// A minor pentatonic-ish sequence (Hz)
const THEME_SEQ = [
  220.0, 261.63, 329.63, 293.66, 261.63, 329.63, 392.0, 329.63,
  220.0, 261.63, 329.63, 440.0, 392.0, 329.63, 261.63, 246.94,
];
const THEME_STEP_MS = 620;

function playThemeNote(freq: number, dur: number) {
  const c = ensureCtx();
  if (!c || !musicGain) return;
  const t = c.currentTime;

  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(musicGain);
  osc.start(t);
  osc.stop(t + dur + 0.05);

  // Soft fifth underneath every other note
  if (musicStep % 2 === 0) {
    const osc2 = c.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq / 2;
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.3, t + 0.08);
    g2.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.4);
    osc2.connect(g2).connect(musicGain);
    osc2.start(t);
    osc2.stop(t + dur * 1.4 + 0.05);
  }
}

export function startMusic(): void {
  const c = ensureCtx();
  if (!c) return;
  if (musicTimer != null) return;
  musicOn = true;
  try {
    window.localStorage.setItem(MUSIC_KEY, "1");
  } catch {
    /* private mode */
  }
  musicStep = 0;
  const tick = () => {
    if (!musicOn) return;
    playThemeNote(THEME_SEQ[musicStep % THEME_SEQ.length]!, 0.9);
    musicStep += 1;
    musicTimer = window.setTimeout(tick, THEME_STEP_MS);
  };
  tick();
}

export function stopMusic(): void {
  musicOn = false;
  if (musicTimer != null) {
    window.clearTimeout(musicTimer);
    musicTimer = null;
  }
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
/* SFX                                                                 */
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

/** March launched — brass-ish rising call */
export function playAttackSound(): void {
  if (!sfxOn) return;
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  const t = c.currentTime;
  [220, 293.66, 392].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f, t + i * 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t + i * 0.09);
    g.gain.linearRampToValueAtTime(0.5, t + i * 0.09 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.5);
    osc.connect(g).connect(sfxGain!);
    osc.start(t + i * 0.09);
    osc.stop(t + i * 0.09 + 0.55);
  });
}

/** You are under attack — dissonant alarm + rumble */
export function playUnderAttackSound(): void {
  if (!sfxOn) return;
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  const t = c.currentTime;

  // Two-tone alarm
  for (let i = 0; i < 3; i++) {
    const osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(311, t + i * 0.28);
    osc.frequency.setValueAtTime(233, t + i * 0.28 + 0.14);
    const g = c.createGain();
    g.gain.setValueAtTime(0.24, t + i * 0.28);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.28 + 0.26);
    osc.connect(g).connect(sfxGain!);
    osc.start(t + i * 0.28);
    osc.stop(t + i * 0.28 + 0.28);
  }

  // Impact rumble
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.7);
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 160;
  const g = c.createGain();
  g.gain.setValueAtTime(0.7, t);
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
  g.gain.setValueAtTime(0.9, t);
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
  g2.gain.setValueAtTime(0.25, t + 0.02);
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
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(filt).connect(g).connect(sfxGain);
  src.start(t);

  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(523.25, t + 0.06);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.3, t + 0.06);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
  osc.connect(g2).connect(sfxGain);
  osc.start(t + 0.06);
  osc.stop(t + 0.26);
}

/** Coin/collect chime */
export function playCoinSound(): void {
  if (!sfxOn) return;
  const c = ensureCtx();
  if (!c || !sfxGain) return;
  const t = c.currentTime;
  [880, 1174.66].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.22, t + i * 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.3);
    osc.connect(g).connect(sfxGain!);
    osc.start(t + i * 0.07);
    osc.stop(t + i * 0.07 + 0.32);
  });
}

/* ------------------------------------------------------------------ */
/* Villager working loop — proximity gain set by the map              */
/* ------------------------------------------------------------------ */

function villagerChop() {
  const c = ensureCtx();
  if (!c || !workGain) return;
  const t = c.currentTime;

  // Wood chop: filtered noise burst + low knock
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
      // Irregular chopping rhythm
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
}
