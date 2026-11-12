'use client';

import { useEffect } from 'react';
import { backendOn, sb } from './backend';
import { useSeek } from './store';

/**
 * Custom emoji (backend mode) belong to the workspace: anyone on the team adds them and everyone in it, clients
 * included, can use and see them. Images are 64×64 PNGs in the public "seek-emoji" bucket.
 */

type Row = { workspace_id: string; name: string; image_url: string; added_by: string };

/** Loads the workspace's emoji into app state. Mounted once, in the app frame. */
export function useWorkspaceEmoji(me: string | null) {
  const { s, update } = useSeek();
  const on = backendOn && !!me && (s.session === 'in' || s.session === 'client');
  const ws = s.session === 'in' ? (s.orgId ?? null) : null;
  useEffect(() => {
    if (!on) return;
    void reloadEmoji(update, ws);
  }, [on, ws]); // eslint-disable-line react-hooks/exhaustive-deps
}

export async function reloadEmoji(update: ReturnType<typeof useSeek>['update'], ws: string | null) {
  let q = sb().from('custom_emoji').select('workspace_id, name, image_url, added_by').order('name');
  if (ws) q = q.eq('workspace_id', ws);
  const { data } = await q;
  if (!data) return;
  update((d) => {
    d.custom = (data as Row[]).map((r) => ({ n: r.name, src: r.image_url, by: r.added_by }));
  });
}

/** Adds an emoji to the workspace from a 64×64 PNG data URL. Returns an error message or null. */
export async function addEmoji(ws: string, name: string, dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.size > 512 * 1024) return 'Emoji images can be up to 512 KB';
  const path = `${ws}/${name}-${Date.now()}.png`;
  const store = sb().storage.from('seek-emoji');
  const { error } = await store.upload(path, blob, { contentType: 'image/png', cacheControl: '31536000' });
  if (error) return 'Couldn’t upload the emoji';
  const url = store.getPublicUrl(path).data.publicUrl;
  await sb().from('custom_emoji').delete().eq('workspace_id', ws).eq('name', name);
  const { error: e2 } = await sb().from('custom_emoji').insert({ workspace_id: ws, name, image_url: url });
  return e2 ? (/duplicate/.test(e2.message) ? ':' + name + ': is already taken by a teammate' : 'Couldn’t add the emoji') : null;
}

/** Removes the emoji you added (admins: all of them). */
export async function clearEmoji(ws: string, me: string, all: boolean) {
  let q = sb().from('custom_emoji').delete().eq('workspace_id', ws);
  if (!all) q = q.eq('added_by', me);
  const { error } = await q;
  return error ? 'Couldn’t remove them' : null;
}
