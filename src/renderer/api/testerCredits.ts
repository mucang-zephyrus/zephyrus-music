const BASE = 'https://mucang.xyz/zephyrus/test-credits/';
const OWNER_KEY = 'zephyrus-tester-credit-owner';

export interface TesterCredit {
  id: number;
  name: string;
  avatar: string;
}
export type CreditProfile = Pick<TesterCredit, 'name' | 'avatar'>;

type CreditState = { decided: boolean; owned: boolean; name?: string; avatar?: string };

async function request(path: string, body?: object) {
  return fetch(`${BASE}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      : {})
  });
}

async function getKeys(accounts: string[]) {
  let owner = localStorage.getItem(OWNER_KEY);
  if (!owner) {
    owner = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    localStorage.setItem(OWNER_KEY, owner);
  }
  const aliases = await Promise.all(
    accounts.slice(0, 20).map(async (account) => {
      const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`zephyrus-tester:${account}`)
      );
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(
        ''
      );
    })
  );
  return { owner, aliases };
}

export async function loadTesterCredit(accounts: string[]): Promise<CreditState> {
  const result = await request('status', await getKeys(accounts));
  if (!result.ok) throw new Error('Could not load tester credit');
  return result.json();
}

export async function saveTesterCredit(accounts: string[], profile: CreditProfile | null) {
  const result = await request('profile', { ...(await getKeys(accounts)), profile });
  if (result.status === 409) return false;
  if (!result.ok) throw new Error('Could not save tester credit');
  return true;
}

export async function fetchTesterCredits(version: string): Promise<TesterCredit[]> {
  try {
    const params = new URLSearchParams({ version: version.replace(/^v/, '') });
    const result = await request(`list?${params}`);
    return result.ok ? await result.json() : [];
  } catch {
    return [];
  }
}
