/** Shared, side-effect-free parser. Clipboard prose is never sent to the gateway. */
export function musicSharePlatform(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  const host = url.hostname.toLowerCase();
  if (['163cn.tv', 'music.163.com', 'y.music.163.com', 'm.music.163.com'].includes(host))
    return 'netease';
  if (['y.qq.com', 'c.y.qq.com', 'c6.y.qq.com', 'i.y.qq.com', 'i2.y.qq.com'].includes(host))
    return 'qq';
  if (['kugou.com', 'www.kugou.com', 'm.kugou.com'].includes(host)) return 'kugou';
  return null;
}

export function parseMusicShareUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'zephyrus:') {
    const id = url.pathname.match(/^\/(\d+)\/?$/)?.[1];
    if (
      ['song', 'playlist', 'album'].includes(url.hostname) &&
      id &&
      Number.isSafeInteger(Number(id)) &&
      Number(id) > 0
    )
      return { kind: url.hostname, platform: 'netease', id };
    const room = url.pathname.match(/^\/([a-z\d]{3,16})\/?$/i)?.[1];
    if (url.hostname === 'listen' && room) return { kind: 'listen', id: room.toUpperCase() };
    return null;
  }
  const platform = musicSharePlatform(value);
  if (!platform) return null;
  const fragment = url.hash.replace(/^#\/?/, '/');
  const path =
    fragment.startsWith('/song') || fragment.startsWith('/play')
      ? fragment
      : url.pathname + url.search;
  const page = new URL(path, url.origin);
  const params = page.searchParams;
  if (platform === 'netease' && /(?:^|\/)song(?:\/|$)/.test(page.pathname)) {
    const id = params.get('id') || page.pathname.match(/\/song\/(\d+)/)?.[1];
    if (id && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0)
      return { kind: 'song', platform, id };
  }
  if (platform === 'qq' && /(?:songDetail|playsong|song\/)/i.test(page.pathname)) {
    const id = params.get('songmid') || page.pathname.match(/\/songDetail\/([a-z\d]+)/i)?.[1];
    if (id && /^[a-z\d]{8,32}$/i.test(id)) return { kind: 'song', platform, id };
    const numeric = params.get('songid');
    if (numeric && /^[1-9]\d{0,15}$/.test(numeric)) return { kind: 'song', platform, id: numeric };
  }
  if (platform === 'kugou' && /(?:song|play)/i.test(page.pathname)) {
    const id = params.get('hash') || new URLSearchParams(url.hash.slice(1)).get('hash');
    if (id && /^[a-f\d]{32}$/i.test(id)) return { kind: 'song', platform, id: id.toUpperCase() };
  }
  return null;
}

export function extractMusicShareUrls(text) {
  if (typeof text !== 'string' || text.length > 65536) return [];
  const matches =
    text.match(
      /(?:https?:\/\/|zephyrus:\/\/)[^\s<>"'`()[\]{}\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/gi
    ) || [];
  const urls = matches.map((url) => url.replace(/[).,;!\]}]+$/, ''));
  return [...new Set(urls)].filter((value) => {
    if (parseMusicShareUrl(value)) return true;
    const platform = musicSharePlatform(value);
    if (!platform) return false;
    const url = new URL(value);
    return (
      (platform === 'netease' && url.hostname === '163cn.tv') ||
      (platform === 'qq' && /\/fcgi-bin\/u\/?$/.test(url.pathname)) ||
      (platform === 'kugou' && /\/share\/song\.html$/.test(url.pathname))
    );
  });
}
