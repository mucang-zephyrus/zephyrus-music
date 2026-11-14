export type NeteaseRequestMode = 'alger' | 'enhanced';

export function normalizeNeteaseRequestMode(value: unknown): NeteaseRequestMode {
  return value === 'enhanced' ? 'enhanced' : 'alger';
}

/** The alternative backend is hosted separately; platform gateways keep their own clients. */
export function resolveNeteaseRequestBase(
  primaryBase: string,
  gatewayBase: string,
  mode: NeteaseRequestMode
): string {
  return mode === 'enhanced'
    ? `${gatewayBase.replace(/\/+$/, '')}/netease-enhanced`
    : primaryBase;
}
