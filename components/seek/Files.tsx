'use client';

import { useEffect, useState } from 'react';
import { PEOPLE, type FileRef } from '@/lib/seek/data';
import { extOf, fileUrl, isAudio, isImage, isVideo, sendFiles, sizeLabel, type FileTarget, type SharedFile } from '@/lib/seek/liveFiles';
import { useSeek } from '@/lib/seek/store';

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
  return (
    <div className="fmedia">
      {src ? video ? <video src={src} controls playsInline preload="metadata" /> : <audio src={src} controls preload="metadata" /> : <small>Loading…</small>}
      <small>
        {video ? '🎥 Video message' : '🎤 Voice message'} · {sizeLabel(f.size)}
      </small>
    </div>
  );
}

/** The files on a message: image previews and file cards. */
export function FileCards({ files }: { files: FileRef[] }) {
  const open = useOpenFile();
  return (
    <div className="files">
      {files.map((f) =>
        isAudio(f) || isVideo(f) ? (
          <Media key={f.path} f={f} />
        ) : isImage(f) ? (
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
            ⇩
          </button>
        </div>
      ))}
    </div>
  );
}
