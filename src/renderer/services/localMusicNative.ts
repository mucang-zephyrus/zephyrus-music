import type { LocalMusicMeta } from '@/types/localMusic';

type AudioFile = { uri: string; name: string; size: number; lastModified: number };

let nextRequest = 0;
const pending = new Map<string, (json: string) => void>();

function request<T>(operation: 'list' | 'metadata', input: string): Promise<T> {
  const bridge = window.AndroidNative;
  return new Promise<T>((resolve, reject) => {
    if (!bridge?.readLocalLibrary) return reject(new Error('Local library bridge unavailable'));
    const id = String(++nextRequest);
    window.__localLibraryResult = (requestId, json) => pending.get(requestId)?.(json);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Local library request timed out'));
    }, 45_000);
    pending.set(id, (json) => {
      clearTimeout(timer);
      pending.delete(id);
      try {
        const result = JSON.parse(json) as { data: T; error?: string };
        if (result.error) throw new Error(result.error);
        resolve(result.data);
      } catch (error) {
        reject(error);
      }
    });
    try {
      bridge.readLocalLibrary(id, operation, input);
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

export async function listLocalAudioFiles(folder: string) {
  const bridge = window.AndroidNative;
  if (bridge?.readLocalLibrary) {
    return { files: await request<AudioFile[]>('list', folder), reliable: true };
  }
  return {
    files: JSON.parse(bridge?.scanAudioFiles?.(folder) ?? '[]') as AudioFile[],
    reliable: false
  };
}

export async function readLocalAudioMetadata(file: AudioFile): Promise<LocalMusicMeta> {
  const bridge = window.AndroidNative;
  if (bridge?.readLocalLibrary) return request('metadata', JSON.stringify(file));
  const metadata = JSON.parse(bridge?.getAudioMetadata?.(file.uri) ?? '{}') as LocalMusicMeta;
  if (!metadata.filePath || (metadata.fileSize === 0 && file.size > 0)) {
    throw new Error('Audio metadata unavailable');
  }
  return { ...metadata, cover: metadata.cover ?? null, lyrics: metadata.lyrics ?? null };
}

let folderPick: Promise<string | null> | undefined;

export function pickLocalAudioFolder(): Promise<string | null> {
  const bridge = window.AndroidNative;
  if (!bridge?.pickAudioFolder || folderPick) return Promise.resolve(null);
  const pick = bridge.pickAudioFolder.bind(bridge);
  folderPick = new Promise<string | null>((resolve, reject) => {
    window.__localMusicFolderPicked = resolve;
    try {
      pick();
    } catch (error) {
      reject(error);
    }
  }).finally(() => {
    delete window.__localMusicFolderPicked;
    folderPick = undefined;
  });
  return folderPick;
}
