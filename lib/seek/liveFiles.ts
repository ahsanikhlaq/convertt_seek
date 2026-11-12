'use client';

import { sb } from './backend';
import type { FileRef } from './data';

/**
 * Files (backend mode). Files go to the private "seek-files" bucket under the conversation they were shared in, so
 * storage only hands them to people who can see that conversation (a client never gets a Team notes file).
 * Links are signed and expire after an hour.
 */

/** Where a file is shared: a channel, a DM (by the other person's user id) or a client space lane. */
export type FileTarget = { channel: string } | { dmWith: string } | { space: string; lane: 'client' | 'team' };

export const MAX_FILE = 100 * 1024 * 1024;

export function sizeLabel(n: number) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
}

export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE');
export const isImage = (f: FileRef) => /^image\/(png|jpe?g|gif|webp)$/.test(f.type);
export const isAudio = (f: FileRef) => /^audio\//.test(f.type);
export const isVideo = (f: FileRef) => /^video\/(webm|mp4|quicktime|ogg)$/.test(f.type);

/** A reason the files can't be sent, or null. */
export function checkFiles(files: File[]) {
  if (files.length > 10) return 'Up to 10 files at a time';
  const big = files.find((f) => f.size > MAX_FILE);
  if (big) return `Files up to 100 MB. ${big.name} is ${sizeLabel(big.size)}.`;
  const empty = files.find((f) => f.size === 0);
  if (empty) return `${empty.name} is empty`;
  return null;
}

async function folderOf(t: FileTarget): Promise<{ folder: string; row: Record<string, string> } | null> {
  if ('channel' in t) return { folder: 'ch/' + t.channel, row: { channel_id: t.channel } };
  if ('space' in t) return { folder: `sp/${t.space}/${t.lane}`, row: { space_id: t.space, lane: t.lane } };
  const { data, error } = await sb().rpc('open_dm', { p_other: t.dmWith });
  if (error || !data) return null;
  return { folder: 'dm/' + data, row: { dm_id: data as string } };
}

const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-120) || 'file';

/**
 * Uploads the files and posts them as one message (the caption is its text). The message then arrives through
 * the live feed like any other. Returns an error message, or null.
 */
export async function sendFiles(target: FileTarget, files: File[], caption: string, mentions: string[] = []): Promise<string | null> {
  const bad = checkFiles(files);
  if (bad) return bad;
  const where = await folderOf(target);
  if (!where) return 'Couldn’t open this conversation';
  const uploaded: FileRef[] = [];
  for (const f of files) {
    const path = `${where.folder}/${crypto.randomUUID()}/${safeName(f.name)}`;
    const { error } = await sb().storage.from('seek-files').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
    if (error) {
      // don't leave half a message's files behind
      if (uploaded.length) await sb().storage.from('seek-files').remove(uploaded.map((u) => u.path));
      return /row-level security|not allowed|unauthori[sz]ed/i.test(error.message) ? 'You can’t share files here' : `Couldn’t upload ${f.name}. Check your connection`;
    }
    uploaded.push({ path, name: f.name.slice(0, 200), size: f.size, type: f.type || 'application/octet-stream' });
  }
  const body = caption.trim() || (uploaded.length === 1 ? uploaded[0].name : `${uploaded.length} files`);
  const { error } = await sb()
    .from('messages')
    .insert({ ...where.row, body: body.slice(0, 8000), files: uploaded, ...(mentions.length ? { mentions } : {}) });
  if (error) {
    await sb().storage.from('seek-files').remove(uploaded.map((u) => u.path));
    return 'Couldn’t send the files. Check your connection';
  }
  return null;
}

const signed = new Map<string, { url: string; until: number }>();

/** A short-lived link to a file (cached for most of its life). */
export async function fileUrl(path: string, download?: string): Promise<string | null> {
  const key = path + (download ? '|d' : '');
  const hit = signed.get(key);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await sb()
    .storage.from('seek-files')
    .createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error || !data) return null;
  signed.set(key, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export type SharedFile = FileRef & { messageId: number; by: string; at: string; lane: 'client' | 'team' | null };

/** Every file shared in a client space (only the lanes you can see), newest first. */
export async function spaceFiles(space: string): Promise<SharedFile[] | null> {
  const { data, error } = await sb()
    .from('messages')
    .select('id, user_id, lane, files, created_at')
    .eq('space_id', space)
    .neq('files', '[]')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return null;
  type R = { id: number; user_id: string; lane: 'client' | 'team' | null; files: FileRef[]; created_at: string };
  return ((data ?? []) as R[]).flatMap((r) => r.files.map((f) => ({ ...f, messageId: r.id, by: r.user_id, at: r.created_at, lane: r.lane })));
}

/** Every file shared in a channel, newest first. */
export async function channelFiles(channel: string): Promise<SharedFile[] | null> {
  const { data, error } = await sb()
    .from('messages')
    .select('id, user_id, files, created_at')
    .eq('channel_id', channel)
    .neq('files', '[]')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return null;
  type R = { id: number; user_id: string; files: FileRef[]; created_at: string };
  return ((data ?? []) as R[]).flatMap((r) => r.files.map((f) => ({ ...f, messageId: r.id, by: r.user_id, at: r.created_at, lane: null })));
}

/** Every file shared in your DM with someone, newest first. */
export async function dmFiles(other: string): Promise<SharedFile[] | null> {
  const { data: thread } = await sb().rpc('open_dm', { p_other: other });
  if (!thread) return null;
  const { data, error } = await sb()
    .from('messages')
    .select('id, user_id, files, created_at')
    .eq('dm_id', thread as string)
    .neq('files', '[]')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return null;
  type R = { id: number; user_id: string; files: FileRef[]; created_at: string };
  return ((data ?? []) as R[]).flatMap((r) => r.files.map((f) => ({ ...f, messageId: r.id, by: r.user_id, at: r.created_at, lane: null })));
}
