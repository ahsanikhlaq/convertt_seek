'use client';

import { useEffect, useRef, useState } from 'react';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { Ic } from './icons';

/**
 * Voice and video messages, recorded in the browser (MediaRecorder) and sent as a file in the conversation, where
 * they play inline. Voice notes stop at 5 minutes, video messages at 2.
 */

const VOICE_MAX = 5 * 60;
const VIDEO_MAX = 2 * 60;

const pick = (types: string[]) => (typeof MediaRecorder === 'undefined' ? '' : types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '');
const audioType = () => pick(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']);
const videoType = () => pick(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']);
const extOf = (mime: string) => (mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm');
export const clockOf = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

export const canRecord = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/** Why the microphone or camera couldn't start, in plain words. */
function denied(e: unknown, what: string) {
  const n = (e as { name?: string })?.name ?? '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return `Seek isn’t allowed to use your ${what}. Allow it in your browser’s address bar, then try again`;
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return `No ${what} found on this device`;
  return `Couldn’t start your ${what}`;
}

/** The voice-note bar: records as soon as it opens; Send stops and sends, Cancel throws it away. */
export function VoiceRecorder({ onSend, onCancel }: { onSend: (file: File, secs: number) => void; onCancel: () => void }) {
  const { toast } = useSeek();
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const keep = useRef(false);
  const started = useRef(0);

  useEffect(() => {
    let tick: ReturnType<typeof setInterval> | undefined;
    let gone = false;
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        const type = audioType();
        const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
        rec.current = r;
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        r.onstop = () => {
          s.getTracks().forEach((t) => t.stop());
          if (!keep.current) return;
          const mime = r.mimeType || type || 'audio/webm';
          const len = Math.max(1, Math.round((Date.now() - started.current) / 1000));
          const blob = new Blob(chunks.current, { type: mime });
          onSend(new File([blob], `voice-message-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${extOf(mime)}`, { type: mime.split(';')[0] }), len);
        };
        started.current = Date.now();
        r.start(250);
        tick = setInterval(() => {
          const t = Math.floor((Date.now() - started.current) / 1000);
          setSecs(t);
          if (t >= VOICE_MAX) {
            keep.current = true;
            r.state !== 'inactive' && r.stop();
          }
        }, 250);
      } catch (e) {
        toast(denied(e, 'microphone'));
        onCancel();
      }
    })();
    return () => {
      gone = true;
      clearInterval(tick);
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rec" role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span>Recording {clockOf(secs)}</span>
      <small style={{ fontWeight: 400 }}>max {clockOf(VOICE_MAX)}</small>
      <span className="sp" />
      <button
        type="button"
        className="btn sm ghost"
        onClick={() => {
          keep.current = false;
          onCancel();
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        className="btn sm pri"
        disabled={secs < 1}
        onClick={() => {
          keep.current = true;
          if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
        }}
      >
        Send voice note
      </button>
    </div>
  );
}

/** The video-message pop-up: camera preview, record (up to 2 minutes), watch it back, retake or send. */
export function VideoRecorder({ onSend, onClose }: { onSend: (file: File, secs: number) => void; onClose: () => void }) {
  const { toast } = useSeek();
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const [state, setState] = useState<'starting' | 'ready' | 'recording' | 'done'>('starting');
  const [secs, setSecs] = useState(0);
  const [take, setTake] = useState<{ url: string; file: File; secs: number } | null>(null);

  // the camera (and microphone) for the preview
  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (live.current) {
          live.current.srcObject = s;
          void live.current.play().catch(() => {});
        }
        setState('ready');
      } catch (e) {
        toast(denied(e, 'camera'));
        onClose();
      }
    })();
    return () => {
      gone = true;
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the clock while recording, and the 2-minute limit
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => {
      const t = Math.floor((Date.now() - started.current) / 1000);
      setSecs(t);
      if (t >= VIDEO_MAX && rec.current?.state === 'recording') rec.current.stop();
    }, 250);
    return () => clearInterval(id);
  }, [state]);

  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url);
    },
    [take],
  );

  // the live preview element is new after a retake: give it the camera again
  useEffect(() => {
    const v = live.current;
    if (!v || !stream.current || take) return;
    if (v.srcObject !== stream.current) {
      v.srcObject = stream.current;
      void v.play().catch(() => {});
    }
  }, [state, take]);

  const start = () => {
    const s = stream.current;
    if (!s) return;
    chunks.current = [];
    const type = videoType();
    const r = new MediaRecorder(s, type ? { mimeType: type, videoBitsPerSecond: 1_500_000 } : undefined);
    rec.current = r;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const mime = r.mimeType || type || 'video/webm';
      const len = Math.max(1, Math.round((Date.now() - started.current) / 1000));
      const blob = new Blob(chunks.current, { type: mime });
      const file = new File([blob], `video-message-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${extOf(mime)}`, { type: mime.split(';')[0] });
      setTake({ url: URL.createObjectURL(blob), file, secs: len });
      setState('done');
    };
    started.current = Date.now();
    setSecs(0);
    r.start(500);
    setState('recording');
  };

  return (
    <Modal
      title="Record a video message"
      onClose={onClose}
      width={560}
      footer={
        state === 'done' && take ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTake(null);
                setState('ready');
              }}
            >
              Retake
            </button>
            <button type="button" className="btn pri" style={{ flex: 1 }} onClick={() => onSend(take.file, take.secs)}>
              Send video ({clockOf(take.secs)})
            </button>
          </>
        ) : state === 'recording' ? (
          <button type="button" className="btn pri" style={{ flex: 1, background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => rec.current?.stop()}>
            <Ic n="stop" size={12} /> Stop ({clockOf(secs)} / {clockOf(VIDEO_MAX)})
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn pri" style={{ flex: 1 }} disabled={state !== 'ready'} onClick={start}>
              <Ic n="dot" size={10} className="recdot" /> Start recording
            </button>
          </>
        )
      }
    >
      <div className="mb vrec">
        {state === 'done' && take ? (
          <video key={take.url} src={take.url} controls playsInline autoPlay />
        ) : (
          <video ref={live} muted playsInline autoPlay style={{ transform: 'scaleX(-1)' }} />
        )}
        <small style={{ color: 'var(--sb)' }}>
          {state === 'starting'
            ? 'Starting your camera…'
            : state === 'recording'
              ? 'Recording. Press Stop when you’re done.'
              : state === 'done'
                ? 'Watch it back, then send it or record again.'
                : 'Up to 2 minutes. It’s sent to this conversation, and plays right in the chat.'}
        </small>
      </div>
    </Modal>
  );
}
