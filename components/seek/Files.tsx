'use client';

import { useEffect, useRef, useState } from 'react';
import { PEOPLE, type FileRef } from '@/lib/seek/data';
import { extOf, fileUrl, isAudio, isImage, isVideo, sendFiles, sizeLabel, type FileTarget, type SharedFile } from '@/lib/seek/liveFiles';
import { useSeek } from '@/lib/seek/store';
import { showPreviews } from '@/lib/seek/prefs';
import { Ic } from './icons';

/** The composer's attach handler for a conversation (null target: attaching isn't available there). */
export function useAttach(target: FileTarget | null) {
  const { toast } = useSeek();
  if (!target) return undefined;
  return async (files: File[], caption: string) => {
    const err = await sendFiles(target, files, caption);
    if (err) toast(err);
    return !err;
  };
}

/** Opens a file in a new tab (a signed link that lasts an hour). */
export function useOpenFile() {
  const { toast } = useSeek();
  return async (f: FileRef, download?: boolean) => {
    // open the tab first, so popup blockers allow it, then point it at the signed link
    const w = window.open('', '_blank');
    const url = await fileUrl(f.path, download ? f.name : undefined);
    if (!url) {
      w?.close();
      toast('Couldn’t open ' + f.name + '. You may not have access any more');
      return;
    }
    if (w) w.location.href = url;
    else location.assign(url);
  };
}

function Thumb({ f }: { f: FileRef }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fileUrl(f.path).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [f.path]);
  return src ? <img src={src} alt={f.name} loading="lazy" className="fimg" /> : <span className="fimg ph" aria-hidden="true" />;
}

/** A voice or video message, played in the chat. */
function Media({ f }: { f: FileRef }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fileUrl(f.path).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [f.path]);
  const video = isVideo(f);
  if (!video) return <VoicePlayer f={f} src={src} />;
  return (
    <div className="fmedia">
      {src ? <video src={src} controls playsInline preload="metadata" /> : <small>Loading…</small>}
      <small>
        {video ? <><Ic n="video" size={14} /> Video message</> : <><Ic n="mic" size={14} /> Voice message</>} · {sizeLabel(f.size)}
      </small>
    </div>
  );
}

const mmss = (t: number) => (Number.isFinite(t) && t > 0 ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00');

/** Bar heights for a voice message's waveform, the same every time for the same file. */
function bars(seed: string, n = 44) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h >>> 0) % 1000) / 1000;
    // louder in the middle, like speech
    const env = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / n);
    out.push(Math.max(0.16, Math.min(1, r * env + 0.12)));
  }
  return out;
}

const SPEEDS = [1, 1.5, 2];

/** A voice message, like Slack's: play/pause, a waveform you can click to jump, time, and playback speed. */
function VoicePlayer({ f, src }: { f: FileRef; src: string | null }) {
  const a = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const wave = useRef(bars(f.path)).current;
  const pct = dur ? Math.min(1, t / dur) : 0;

  // recorded webm often reports no length until it has been read to the end; this finds it
  const onMeta = () => {
    const el = a.current;
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDur(el.duration);
      return;
    }
    const fix = () => {
      el.removeEventListener('timeupdate', fix);
      if (Number.isFinite(el.duration)) setDur(el.duration);
      el.currentTime = 0;
      setT(0);
    };
    el.addEventListener('timeupdate', fix);
    el.currentTime = 1e7;
  };

  const toggle = () => {
    const el = a.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = a.current;
    if (!el || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
  };
  const nextSpeed = () => {
    const sp = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(sp);
    if (a.current) a.current.playbackRate = sp;
  };

  return (
    <div className={'voice' + (playing ? ' playing' : '')}>
      {src && (
        <audio
          ref={a}
          src={src}
          preload="metadata"
          onLoadedMetadata={onMeta}
          onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setDur(e.currentTarget.duration)}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setT(0);
          }}
        />
      )}
      <button type="button" className="vplay" onClick={toggle} disabled={!src} aria-label={playing ? 'Pause voice message' : 'Play voice message'}>
        <Ic n={playing ? 'pause' : 'play'} size={16} />
      </button>
      <div className="vbody">
        <div className="vwave" onClick={seek} aria-hidden="true">
          {wave.map((h, i) => (
            <i key={i} className={(i + 0.5) / wave.length <= pct ? 'on' : ''} style={{ height: Math.round(h * 100) + '%' }} />
          ))}
        </div>
        <div className="vmeta">
          <span>
            <Ic n="mic" size={12} /> {playing || t > 0.05 ? mmss(t) + ' / ' + mmss(dur) : mmss(dur)}
          </span>
          <span className="vsize">{sizeLabel(f.size)}</span>
        </div>
      </div>
      <button type="button" className="vspeed" onClick={nextSpeed} aria-label={'Playback speed ' + speed + 'x'} title="Playback speed">
        {speed}×
      </button>
    </div>
  );
}

/** The files on a message: image previews and file cards. */
export function FileCards({ files }: { files: FileRef[] }) {
  const open = useOpenFile();
  const previews = showPreviews();
  return (
    <div className="files">
      {files.map((f) =>
        isAudio(f) || isVideo(f) ? (
          <Media key={f.path} f={f} />
        ) : isImage(f) && previews ? (
          <button key={f.path} type="button" className="fpic" onClick={() => void open(f)} title={f.name} aria-label={'Open ' + f.name}>
            <Thumb f={f} />
          </button>
        ) : (
          <button key={f.path} type="button" className="file" onClick={() => void open(f)} title={'Open ' + f.name}>
            <i>{extOf(f.name)}</i>
            <div>
              <b>{f.name}</b>
              <small>{sizeLabel(f.size)}</small>
            </div>
          </button>
        ),
      )}
    </div>
  );
}

/** A list of shared files (Files tab), with who shared them and when. */
export function FileList({ files, empty, lanes, me }: { files: SharedFile[] | null; empty: string; lanes?: boolean; me: string | null }) {
  const open = useOpenFile();
  if (!files) return <p className="sub">Loading…</p>;
  if (!files.length) return <div className="empty">{empty}</div>;
  return (
    <div className="flist">
      {files.map((f) => (
        <div key={f.path} className="frow">
          <i>{extOf(f.name)}</i>
          <span className="x">
            <b>{f.name}</b>
            <small>
              {f.by === me ? 'You' : (PEOPLE[f.by]?.name ?? 'Someone')} · {new Date(f.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {sizeLabel(f.size)}
              {lanes && f.lane ? (f.lane === 'team' ? ' · Team notes' : ' · Client chat') : ''}
            </small>
          </span>
          {lanes && f.lane === 'client' && <span className="tag gold">client can see</span>}
          <button type="button" className="btn sm" onClick={() => void open(f)}>
            Open
          </button>
          <button type="button" className="btn sm ghost" onClick={() => void open(f, true)} aria-label={'Download ' + f.name}>
            <Ic n="download" />
          </button>
        </div>
      ))}
    </div>
  );
}
