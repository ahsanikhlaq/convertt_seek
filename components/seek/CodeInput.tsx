'use client';

import { useEffect, useRef, useState } from 'react';

/** Six single-digit boxes; calls onComplete once all are filled. */
export function CodeInput({ disabled, onComplete, label = 'Verification code' }: { disabled?: boolean; onComplete: (code: string) => void; label?: string }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const done = digits.every(Boolean);

  useEffect(() => {
    if (disabled) return;
    // focus the first box unless the person already clicked into one
    const id = setTimeout(() => {
      if (!refs.current.some((r) => r === document.activeElement)) refs.current[0]?.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [disabled]);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => onComplete(digits.join('')), 350);
    return () => clearTimeout(id);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    setDigits((cur) => cur.map((x, j) => (j === i ? d : x)));
    if (d && refs.current[i + 1]) refs.current[i + 1]!.focus();
  };

  return (
    <div className={'codes' + (done ? ' ok' : '')} role="group" aria-label={label}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          value={d}
          disabled={disabled}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
            if (!t.length) return;
            e.preventDefault();
            setDigits([0, 1, 2, 3, 4, 5].map((j) => t[j] || ''));
            refs.current[Math.min(t.length, 5)]?.focus();
          }}
        />
      ))}
    </div>
  );
}

/** Reads the digits back out of a CodeInput's DOM (for an explicit Verify button). */
export function codeComplete(root: HTMLElement | null) {
  return !!root && [...root.querySelectorAll<HTMLInputElement>('.codes input')].every((x) => x.value);
}
