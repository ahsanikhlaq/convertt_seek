'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { STEPS } from '@/lib/seek/steps';
import { sx } from '@/lib/sx';

const APP = '/app';
const FONT = "'Outfit',system-ui,sans-serif";
const MOBILE_MAX = 760;

type Dev = 'd' | 'm';

/** Product flow review: step list + live Seek app framed as desktop or mobile */
export default function ReviewShell() {
  const [i, setI] = useState(0);
  const [dev, setDev] = useState<Dev>('d');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [nw, setNw] = useState(false); // narrow window: shell itself is on a phone
  const [drawer, setDrawer] = useState(false);
  const [src, setSrc] = useState(APP + '#' + STEPS[0].r);
  const fitRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);

  // restore last step/device, track window + stage size
  useEffect(() => {
    let i0 = 0;
    try {
      const s = JSON.parse(localStorage.getItem('seekReview') || '{}');
      if (s.i != null && STEPS[s.i]) {
        i0 = s.i;
        setI(s.i);
        setDev(s.dev === 'm' ? 'm' : 'd');
      }
    } catch {}
    setSrc(APP + '#' + STEPS[i0].r);
    loaded.current = true;

    const narrow = () => {
      const n = innerWidth <= MOBILE_MAX;
      setNw((prev) => {
        if (prev !== n) setDrawer(false);
        return n;
      });
    };
    narrow();
    addEventListener('resize', narrow);

    const el = fitRef.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => {
      removeEventListener('resize', narrow);
      ro.disconnect();
    };
  }, []);

  // persist
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem('seekReview', JSON.stringify({ i, dev }));
    } catch {}
  }, [i, dev]);

  /** Change step from the shell: move the app to that screen too */
  const go = useCallback((k: number) => {
    if (k < 0 || k >= STEPS.length) return;
    setI(k);
    setSrc(APP + '#' + STEPS[k].r);
    try {
      frameRef.current?.contentWindow?.postMessage({ seekGo: STEPS[k].r }, location.origin);
    } catch {}
  }, []);

  // keyboard: ← → steps, D / M device
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
      else if (e.key === 'd' || e.key === 'D') setDev('d');
      else if (e.key === 'm' || e.key === 'M') setDev('m');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [i, go]);

  // the app reports its own navigation, so the step list follows clicks inside it
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const r = e.data && e.data.seekRoute;
      if (!r) return;
      const k = STEPS.findIndex((s) => s.r === r);
      if (k >= 0) setI(k); // src stays as-is: the app already shows that screen
    };
    addEventListener('message', onMsg);
    return () => removeEventListener('message', onMsg);
  }, []);

  const s = STEPS[i];
  const desk = dev === 'd' && !nw;
  const { w, h } = size;
  const W = desk ? 1440 : 390, H = desk ? 900 : 844;
  const fw = desk ? W : W + 28, fh = desk ? H + 40 : H + 28;
  const sc = w && h ? Math.min((w - 64) / fw, (h - 56) / fh, 1) : 0.5;
  const pos = `${String(i + 1).padStart(2, '0')} / ${STEPS.length}`;

  const devBtn = (on: boolean) =>
    sx(`height:34px;min-width:96px;padding:0 14px;border:0;background:${on ? '#f2e4f1' : 'transparent'};color:${on ? '#3e133e' : '#eedaee'};font:600 13px ${FONT};border-radius:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px`);

  return (
    <div style={sx(`display:grid;grid-template-rows:64px minmax(0,1fr);height:100vh;height:100dvh;font-family:${FONT};color:#261325`)}>
      <header style={sx(`display:flex;align-items:center;gap:${nw ? 12 : 22}px;padding:0 ${nw ? 12 : 28}px;background:#3e133e;color:#fff`)}>
        <button
          type="button"
          onClick={() => setDrawer((d) => !d)}
          aria-label="Steps menu"
          aria-expanded={drawer}
          style={sx(nw ? 'width:38px;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-size:17px;cursor:pointer;flex:none' : 'display:none')}
        >
          ☰
        </button>
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <span style={sx(`width:30px;height:30px;border-radius:8px;background:#4b154a;color:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.25);display:grid;place-items:center;font:600 15px ${FONT}`)}>S</span>
          <span style={sx(`font:600 21px/1 ${FONT};letter-spacing:-.02em`)}>Seek</span>
          <span style={sx(`font:400 12.5px ${FONT};color:rgba(250,247,249,.55);white-space:nowrap`)}>by Convertt</span>
        </div>
        <span style={sx(nw ? 'display:none' : 'width:1px;height:22px;background:rgba(250,247,249,.2)')}></span>
        <span style={sx(nw ? 'display:none' : 'display:flex;flex-direction:column;gap:2px')}>
          <b style={sx(`font:500 10.5px ${FONT};letter-spacing:.2em;text-transform:uppercase;color:#ecb22e`)}>Product flow review</b>
          <span style={sx('font-size:12.5px;color:rgba(250,247,249,.62);white-space:nowrap')}>Ten working screens · desktop and mobile · October 2026</span>
        </span>
        <div style={sx(nw ? 'display:none' : 'margin-left:auto;display:flex;align-items:center;gap:20px')}>
          <div role="group" aria-label="Device" style={sx('display:flex;padding:3px;gap:2px;border:1px solid rgba(250,247,249,.2);border-radius:12px')}>
            <button type="button" aria-pressed={desk} onClick={() => setDev('d')} style={devBtn(desk)}>Desktop <kbd>D</kbd></button>
            <button type="button" aria-pressed={!desk} onClick={() => setDev('m')} style={devBtn(!desk)}>Mobile <kbd>M</kbd></button>
          </div>
          <a
            href={APP + '#' + s.r}
            target="_blank"
            rel="noopener"
            className="rv-full"
            style={sx('font-size:13px;color:#faf7f9;text-decoration:underline;text-underline-offset:5px;text-decoration-color:rgba(250,247,249,.4);white-space:nowrap;min-height:44px;display:flex;align-items:center')}
          >
            Open full screen ↗
          </a>
        </div>
      </header>

      <div style={sx(nw ? 'display:grid;grid-template-columns:minmax(0,1fr);min-height:0' : 'display:grid;grid-template-columns:clamp(290px,25vw,370px) minmax(0,1fr);min-height:0')}>
        {drawer && <div onClick={() => setDrawer(false)} style={sx('position:fixed;inset:0;background:rgba(38,19,37,.45);z-index:40')}></div>}

        <aside
          style={sx(
            nw
              ? drawer
                ? 'position:fixed;left:0;top:0;bottom:0;width:min(86vw,340px);z-index:41;background:#fff;display:flex;flex-direction:column;overflow-y:auto;box-shadow:20px 0 60px rgba(0,0,0,.25)'
                : 'display:none'
              : 'background:#fff;border-right:1px solid rgba(38,19,37,.1);display:flex;flex-direction:column;min-height:0;overflow-y:auto',
          )}
        >
          <div style={sx('padding:12px 0;border-bottom:1px solid rgba(38,19,37,.1)')}>
            {STEPS.map((x, k) => {
              const on = k === i;
              return (
                <button
                  key={x.r}
                  type="button"
                  aria-current={on ? 'step' : undefined}
                  onClick={() => {
                    go(k);
                    setDrawer(false);
                  }}
                  style={sx(`width:100%;min-height:54px;padding:8px clamp(16px,2vw,28px);border:0;box-shadow:${on ? 'inset 4px 0 0 #4b154a' : 'none'};background:${on ? '#f2e4f1' : 'transparent'};color:${on ? '#3e133e' : '#261325'};display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:6px;text-align:left;cursor:pointer;font-family:${FONT}`)}
                >
                  <i style={sx(`width:26px;height:26px;border-radius:99px;display:grid;place-items:center;font:700 11px 'Geist Mono',monospace;font-style:normal;background:${on ? '#4b154a' : '#f2e4f1'};color:${on ? '#fff' : '#4b154a'}`)}>
                    {String(k + 1).padStart(2, '0')}
                  </i>
                  <b style={sx(`font:600 15px/1.2 ${FONT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{x.t}</b>
                  <span style={sx(`font:600 11px ${FONT};padding:3px 8px;border-radius:99px;white-space:nowrap;background:${on ? '#fff' : '#f8f2f8'};color:#5f4a5e`)}>{x.g}</span>
                </button>
              );
            })}
          </div>

          <div style={sx('padding:28px;display:flex;flex-direction:column;gap:20px')}>
            <div>
              <div style={sx(`font:500 10.5px ${FONT};letter-spacing:.2em;text-transform:uppercase;color:#4b154a`)}>
                Step {i + 1} of {STEPS.length} · {s.g}
              </div>
              <h1 style={sx(`margin:8px 0 0;font:600 30px/1.1 ${FONT};letter-spacing:-.03em;color:#261325;text-wrap:balance`)}>{s.t}</h1>
              <div style={sx(`margin-top:8px;font:500 12px ${FONT};color:#8a5300`)}>{s.role}</div>
            </div>
            <p style={sx('margin:0;font-size:14.5px;line-height:22px;color:#4f3c4f;text-wrap:pretty')}>{s.p}</p>
            <div style={sx('display:flex;flex-direction:column;gap:8px')}>
              <div style={sx(`font:500 10px ${FONT};letter-spacing:.2em;text-transform:uppercase;color:#4f3c4f`)}>Try it on the screen</div>
              <div style={sx('border-top:1px solid rgba(38,19,37,.1)')}>
                {s.h.map((t, k) => (
                  <div key={k} style={sx('display:grid;grid-template-columns:28px minmax(0,1fr);padding:11px 0;border-bottom:1px solid rgba(38,19,37,.1);font-size:14px;line-height:20px')}>
                    <span style={sx("font:700 12px/20px 'Geist Mono',monospace;color:#4b154a")}>{k + 1}</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={sx('display:flex;flex-direction:column;gap:6px;padding:14px 16px;background:#f2e4f1;border-radius:12px')}>
              <div style={sx(`font:500 10px ${FONT};letter-spacing:.2em;text-transform:uppercase;color:#4b154a`)}>What happens next</div>
              <div style={sx('font-size:13.5px;line-height:20px;color:#261325')}>{s.n}</div>
            </div>
          </div>

          <div style={sx('margin-top:auto;padding:18px 28px;border-top:1px solid rgba(38,19,37,.1);font-size:12px;color:#4f3c4f;display:flex;gap:16px;flex-wrap:wrap')}>
            <span><kbd>←</kbd> <kbd>→</kbd> change step</span>
            <span><kbd>D</kbd> / <kbd>M</kbd> desktop or mobile</span>
          </div>
        </aside>

        <main style={sx('position:relative;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) 64px')}>
          <div ref={fitRef} style={sx('position:relative;min-height:0;overflow:hidden')}>
            <div
              style={sx(
                nw
                  ? 'position:absolute;inset:0'
                  : `position:absolute;left:50%;top:50%;width:${fw}px;height:${fh}px;transform:translate(-50%,-50%) scale(${sc});transform-origin:center center;${desk ? 'background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 30px 80px -24px rgba(62,19,62,.35),0 0 0 1px rgba(38,19,37,.08)' : 'padding:14px;background:#3e133e;border-radius:58px;box-shadow:0 40px 100px -20px rgba(38,19,37,.45)'}`,
              )}
            >
              {desk && (
                <div style={sx('height:40px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#f2eef2;border-bottom:1px solid rgba(38,19,37,.08)')}>
                  <i style={sx('width:11px;height:11px;border-radius:50%;background:#dad1da')}></i>
                  <i style={sx('width:11px;height:11px;border-radius:50%;background:#dad1da')}></i>
                  <i style={sx('width:11px;height:11px;border-radius:50%;background:#dad1da')}></i>
                  <span style={sx('margin:0 auto;height:26px;width:440px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:#fff;font-size:12.5px;color:#4f3c4f')}>
                    convertt.seek.app/{s.r}
                  </span>
                </div>
              )}
              <div style={sx(nw ? 'position:relative;width:100%;height:100%;overflow:hidden;background:#fff' : `position:relative;overflow:hidden;background:#fff;${desk ? '' : 'border-radius:44px'}`)}>
                <iframe
                  ref={frameRef}
                  title="Seek product screen"
                  src={src}
                  style={sx(nw ? `display:block;border:0;background:#fff;width:${w || 390}px;height:${h || 700}px` : `display:block;border:0;background:#fff;width:${W}px;height:${H}px`)}
                />
              </div>
            </div>
          </div>

          <div style={sx(`display:flex;align-items:center;justify-content:space-between;gap:${nw ? 8 : 16}px;padding:0 ${nw ? 10 : 28}px;border-top:1px solid rgba(38,19,37,.08);background:rgba(252,251,252,.7);overflow:hidden`)}>
            <button
              type="button"
              className="rv-prev"
              onClick={() => go(i - 1)}
              disabled={i === 0}
              style={sx(`height:44px;padding:0 16px;border:1px solid #dcd0dc;border-radius:10px;background:#fff;color:#261325;font:600 13.5px ${FONT};cursor:pointer;display:flex;align-items:center;gap:10px;white-space:nowrap`)}
            >
              ← Previous
            </button>
            <span style={sx('font-size:13px;color:#4f3c4f;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
              <b style={sx(`font:600 15px ${FONT};color:#261325;margin-right:8px`)}>{s.t}</b>
              {pos}
            </span>
            <button
              type="button"
              onClick={() => go(i + 1)}
              disabled={i === STEPS.length - 1}
              style={sx(`height:44px;padding:0 16px;border:1px solid #4b154a;border-radius:10px;background:#4b154a;color:#fff;font:600 13.5px ${FONT};cursor:pointer;display:flex;align-items:center;gap:10px;white-space:nowrap`)}
            >
              Next →
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
