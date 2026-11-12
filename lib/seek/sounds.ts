'use client';

/**
 * Notification sounds, made in the browser (Web Audio), so there are no files to load: six short sounds and a
 * volume. Browsers only play sound after the person has interacted with the page once.
 */

export type SoundKey = 'chime' | 'ding' | 'pop' | 'bell' | 'knock' | 'soft';
export const SOUNDS: [SoundKey, string][] = [
  ['chime', 'Chime'],
  ['ding', 'Ding'],
  ['pop', 'Pop'],
  ['bell', 'Bell'],
  ['knock', 'Knock'],
  ['soft', 'Soft'],
];

let ctx: AudioContext | null = null;
function audio() {
  if (typeof window === 'undefined') return null;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx ??= new C();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One tone: frequency (Hz), start offset and length (s), waveform, and peak loudness. */
function tone(a: AudioContext, out: GainNode, f: number, at: number, len: number, type: OscillatorType, peak: number, slideTo?: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  const t = a.currentTime + at;
  o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
}

/** Plays a notification sound at a volume from 0 to 100. */
export function playSound(key: SoundKey, volume: number) {
  const a = audio();
  if (!a || volume <= 0) return;
  const out = a.createGain();
  out.gain.value = Math.min(1, Math.max(0, volume / 100)) * 0.6;
  out.connect(a.destination);
  switch (key) {
    case 'chime':
      tone(a, out, 880, 0, 0.35, 'sine', 0.8);
      tone(a, out, 1320, 0.12, 0.45, 'sine', 0.6);
      break;
    case 'ding':
      tone(a, out, 1568, 0, 0.6, 'triangle', 0.9);
      break;
    case 'pop':
      tone(a, out, 520, 0, 0.09, 'sine', 1, 260);
      break;
    case 'bell':
      tone(a, out, 660, 0, 0.9, 'sine', 0.7);
      tone(a, out, 1320, 0, 0.6, 'sine', 0.25);
      tone(a, out, 1980, 0, 0.35, 'sine', 0.12);
      break;
    case 'knock':
      tone(a, out, 180, 0, 0.08, 'square', 0.5, 120);
      tone(a, out, 180, 0.16, 0.08, 'square', 0.5, 120);
      break;
    case 'soft':
      tone(a, out, 440, 0, 0.5, 'sine', 0.5, 554);
      break;
  }
}
