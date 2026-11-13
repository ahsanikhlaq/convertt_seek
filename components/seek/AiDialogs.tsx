'use client';

import { useEffect, useState } from 'react';
import { sb } from '@/lib/seek/backend';
import { createTask, refreshTasks } from '@/lib/seek/liveExtras';
import { toDbId } from '@/lib/seek/live';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { Ic } from './icons';
import { RichText } from './ui';

/**
 * AI agents (testing on the free Gemini API, through the seek-ai server function). The server reads only what you
 * can see, answers only you, and logs every run in Apps → AI agents.
 */
async function ask<T>(body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await sb().functions.invoke('seek-ai', { body });
  if (error) {
    // the function's own message (e.g. "AI isn't connected yet") is in the response body
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.error) return { error: j.error };
    } catch {}
    return { error: 'The AI couldn’t answer. Try again shortly' };
  }
  if (data?.error) return { error: data.error };
  return { data: data as T };
}

/** "Catch me up": a short AI summary of the latest messages in a conversation. */
export function CatchUpDialog({ conv, where, onClose }: { conv: string; where: string; onClose: () => void }) {
  const [res, setRes] = useState<{ text: string; sources: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void ask<{ text: string; sources: number }>({ action: 'summarise', conv }).then((r) => {
      if (!alive) return;
      if (r.error) setErr(r.error);
      else setRes(r.data!);
    });
    return () => {
      alive = false;
    };
  }, [conv]);
  return (
    <Modal title={'Catch up on ' + where} icon={<Ic n="ai" />} onClose={onClose} width={520} footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
      <div className="mb">
        {err ? (
          <div className="empty">{err}</div>
        ) : !res ? (
          <div className="aiwait">
            <Ic n="ai" /> Reading the latest messages…
          </div>
        ) : (
          <>
            <div className="aisum">
              <RichText text={res.text} />
            </div>
            <small className="aifoot">Summariser · based on the latest {res.sources} message{res.sources === 1 ? '' : 's'} · AI can make mistakes, so check the source messages</small>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Tasks the AI suggests from a message; add the ones you want (they're yours, due when it says). */
export function SuggestTasksDialog({ uiId, onClose }: { uiId: number; onClose: () => void }) {
  const { s, update, toast } = useSeek();
  const [tasks, setTasks] = useState<{ title: string; due: string | null; added?: boolean }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const id = toDbId(uiId);
    if (id == null) {
      setErr('This message isn’t saved yet');
      return;
    }
    void ask<{ tasks: { title: string; due: string | null }[] }>({ action: 'tasks', message_id: id }).then((r) => {
      if (!alive) return;
      if (r.error) setErr(r.error);
      else setTasks(r.data!.tasks);
    });
    return () => {
      alive = false;
    };
  }, [uiId]);
  const add = async (i: number) => {
    const t = tasks![i];
    if (!s.orgId || !s.meId) return toast('Tasks need a team workspace');
    const e = await createTask({ ws: s.orgId, title: t.title, owner: s.meId, due: t.due, sourceUiId: uiId });
    if (e) return toast(e);
    setTasks((xs) => xs!.map((x, j) => (j === i ? { ...x, added: true } : x)));
    void refreshTasks(update, s.orgId);
    toast('Task added');
  };
  return (
    <Modal title="Suggested tasks" icon={<Ic n="ai" />} onClose={onClose} width={500} footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
      <div className="mb">
        {err ? (
          <div className="empty">{err}</div>
        ) : !tasks ? (
          <div className="aiwait">
            <Ic n="ai" /> Looking for tasks in this message…
          </div>
        ) : !tasks.length ? (
          <div className="empty">No clear tasks in this message.</div>
        ) : (
          <div className="aitasks">
            {tasks.map((t, i) => (
              <div key={i} className="aitask">
                <Ic n="task" />
                <span className="x">
                  <b>{t.title}</b>
                  {t.due && <small>Due {new Date(t.due + 'T00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</small>}
                </span>
                <button type="button" className="btn sm" disabled={t.added} onClick={() => void add(i)}>
                  {t.added ? (
                    <>
                      <Ic n="check" size={14} /> Added
                    </>
                  ) : (
                    'Add task'
                  )}
                </button>
              </div>
            ))}
            <small className="aifoot">Task suggester · AI can make mistakes; only add the ones that are right</small>
          </div>
        )}
      </div>
    </Modal>
  );
}
