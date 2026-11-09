'use client';

import { useEffect, useId, useRef, useState } from 'react';

/** Centred modal (bottom sheet on phones). Closes on Escape and on a click outside. */
export function Modal({
  title,
  icon,
  onClose,
  children,
  footer,
  width,
  top,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  top?: boolean;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    // focus the first field, else the dialog itself
    const first = box.current?.querySelector<HTMLElement>('input,textarea,select');
    (first || box.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="scrim" style={top ? { placeItems: 'start center', paddingTop: 80 } : undefined} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} tabIndex={-1} style={width ? { width } : undefined}>
        {title !== undefined && (
          <div className="mhd">
            {icon}
            <b id={id}>{title}</b>
            <button type="button" className="btn sm ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        {children}
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

export function PromptDialog({
  title,
  label,
  initial = '',
  confirm = 'Save',
  multiline,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  initial?: string;
  confirm?: string;
  multiline?: boolean;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const id = useId();
  const submit = () => {
    if (v.trim()) onSubmit(v.trim());
  };
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={440}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn pri" onClick={submit} disabled={!v.trim()}>
            {confirm}
          </button>
        </>
      }
    >
      <form
        className="mb"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="fld">
          <label htmlFor={id}>{label}</label>
          {multiline ? (
            <textarea id={id} className="inp" rows={2} value={v} onChange={(e) => setV(e.target.value)} />
          ) : (
            <input id={id} className="inp" value={v} onChange={(e) => setV(e.target.value)} />
          )}
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirm,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={'btn ' + (danger ? 'danger' : 'pri')} onClick={onConfirm}>
            {confirm}
          </button>
        </>
      }
    >
      {body && (
        <div className="mb">
          <p style={{ margin: 0, color: 'var(--mu)' }}>{body}</p>
        </div>
      )}
    </Modal>
  );
}
