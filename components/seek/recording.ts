/** Small helpers for voice and video messages, kept apart from the recorder UI (Recorder.tsx loads on first use). */
export const clockOf = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

export const canRecord = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
