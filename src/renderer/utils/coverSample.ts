import { gatewayBaseURL } from '@/api/gatewayBase';
import { IS_WEB_TEST_SITE, testGatewayForOrigin } from '@/utils/appVersion';

/** Keep the full-size display URL separate from the canvas-readable thumbnail. */
export function coverSampleUrl(src: string): string {
  if (!/^(?:https?:)?\/\/y\.gtimg\.cn(?=[:/?#]|$)/i.test(src)) return src;
  try {
    const url = new URL(src, 'https://y.gtimg.cn');
    const cover = /^\/music\/photo_new\/(T00[12])R\d+x\d+M000([a-zA-Z0-9]{14})\.jpg$/i.exec(
      url.pathname
    );
    if (!cover || url.port || url.username || url.password) return '';
    const base = IS_WEB_TEST_SITE ? testGatewayForOrigin(window.location.origin) : gatewayBaseURL;
    return `${base.replace(/\/$/, '')}/platform/qq/cover-sample?type=${cover[1].toUpperCase()}&mid=${cover[2]}`;
  } catch {
    return '';
  }
}

export async function loadCoverSample(src: string): Promise<HTMLImageElement> {
  const url = coverSampleUrl(src);
  if (!url) throw new Error('没有可取色的封面');
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';
  image.src = url;
  await image.decode();
  return image;
}
