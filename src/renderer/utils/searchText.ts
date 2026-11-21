import PinyinMatch from 'pinyin-match';

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function subsequenceGap(value: string, query: string): number | null {
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let index = 0; index < value.length && queryIndex < query.length; index++) {
    if (value[index] !== query[queryIndex]) continue;
    if (firstMatch < 0) firstMatch = index;
    lastMatch = index;
    queryIndex++;
  }

  if (queryIndex !== query.length) return null;
  return lastMatch - firstMatch + 1 - query.length;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

export function scoreSearchText(value: string, query: string, rawQuery: string): number {
  const normalized = normalizeSearchText(value);
  if (!normalized || !query) return Number.POSITIVE_INFINITY;
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 4 + normalized.length - query.length;

  const includesAt = normalized.indexOf(query);
  if (includesAt >= 0) return 12 + includesAt;

  if (PinyinMatch.match(value, rawQuery)) return 30;

  const gap = subsequenceGap(normalized, query);
  if (gap != null) return 48 + gap;

  if (Math.abs(normalized.length - query.length) <= 3) {
    const distance = editDistance(normalized, query);
    const threshold = Math.min(3, Math.max(1, Math.ceil(query.length * 0.3)));
    if (distance <= threshold) return 72 + distance;
  }

  return Number.POSITIVE_INFINITY;
}
