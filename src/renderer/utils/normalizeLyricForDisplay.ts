import type { ILyric, ILyricText } from '@/types/music';
import { isLyricCredit } from '@/utils/lyricCredits';

export const LYRIC_MERGE_VERSION = '2.1.0';
export type MergeRule = 'inline' | 'structure' | 'same-time';
export interface LyricMergeRecord {
  rule: MergeRule;
  originalIndices: number[];
  outputIndex: number;
}
export interface LyricMergeInfo {
  version: string;
  sourceId: string;
  rules: MergeRule[];
  records: LyricMergeRecord[];
}
export interface LyricDisplayPolicy {
  enabled?: boolean;
  sourceId?: string;
}
type Script = 'latin' | 'cjk';
type TimingMode = 'timed' | 'untimed';
type Row = { line: ILyricText; indices: number[]; rule?: MergeRule };
type Group = { main: Row[]; translation: Row[] };
const compact = (text: string) => text.replace(/\s/gu, '');
const backgroundMarker =
  /(?:\[(?:bg|background|duet|v\d|male|female)\]|(?:【|\[)?(?:和声|和聲|合唱|男声|女声|男聲|女聲)[】\]]?[:：])/iu;
const timed = (line: ILyricText) => !!line.words?.length || !!line.hasWordByWord;
const end = (line: ILyricText) =>
  Math.max(
    (line.startTime ?? 0) + Math.max(0, line.duration ?? 0),
    ...(line.words ?? []).map((w) => w.startTime + w.duration)
  );

function script(text: string): Script | undefined {
  const chars = [...compact(text)];
  if (!chars.length) return;
  if (chars.filter((c) => /[A-Za-z]/u.test(c)).length / chars.length >= 0.6) return 'latin';
  if (
    chars.filter((c) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(c)).length /
      chars.length >=
    0.6
  )
    return 'cjk';
  return undefined;
}

function protectedLine(line: ILyricText): boolean {
  return !!(
    line.trText ||
    line.isBG ||
    line.isDuet ||
    backgroundMarker.test(line.text) ||
    isLyricCredit(line.text)
  );
}

function inTimingMode(line: ILyricText, mode: TimingMode): boolean {
  return (
    Number.isFinite(line.startTime) &&
    (mode === 'timed' ? line.startTime! >= 0 : line.startTime === -1 && !timed(line))
  );
}

function eligible(line: ILyricText, mode: TimingMode = 'timed'): Script | undefined {
  if (protectedLine(line) || !inTimingMode(line, mode)) return;
  // An untimed emoticon is an annotation, not a second sung language. Keep its text intact.
  const text =
    mode === 'untimed'
      ? line.text.replace(
          /(?:[εΕ]\s*=\s*)?[（(][^A-Za-z\u3040-\u30ff\u3400-\u9fff）)]*[）)]+/gu,
          ''
        )
      : line.text;
  return script(text);
}

/** Only discard a translation row's auxiliary field when it is an exact provider echo. */
function translationAuxiliaryIsSafe(line: ILyricText): boolean {
  return !line.romaText || compact(line.romaText) === compact(line.text);
}

function prefixWords(line: ILyricText, main: string) {
  const words = line.words;
  if (!timed(line)) return { words, cut: 0 };
  if (!words?.length || compact(words.map((w) => w.text).join('')) !== compact(line.text)) return;
  const prefix = compact(main);
  let count = 0;
  let cut = 0;
  for (const word of words) {
    count += compact(word.text).length;
    cut++;
    if (count >= prefix.length) break;
  }
  // Never split a timed token or invent a translation's word timings.
  if (count !== prefix.length) return;
  return { words: words.slice(0, cut), cut };
}

function splitInline(line: ILyricText): ILyricText | undefined {
  if (
    line.trText ||
    line.romaText ||
    line.isBG ||
    line.isDuet ||
    backgroundMarker.test(line.text) ||
    isLyricCredit(line.text)
  )
    return;
  const match = /[ \t]*(?:（([^（）()]*)）|\(([^（）()]*)\))[ \t]*[。，、！？!?.…～~]*$/u.exec(
    line.text
  );
  if (!match) return;
  const main = line.text.slice(0, match.index).trimEnd();
  const translation = (match[1] ?? match[2]).trim();
  if (script(main) !== 'latin' || script(translation) !== 'cjk') return;
  const prefix = prefixWords(line, main);
  return prefix ? { ...line, text: main, trText: translation, words: prefix.words } : undefined;
}

/** A candidate is only applied after repeated whole-lyric structural evidence. */
function mixedInlineCandidate(line: ILyricText): ILyricText | undefined {
  if (protectedLine(line) || !Number.isFinite(line.startTime)) return;
  const suffix = /[A-Za-z][^\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]*$/u.exec(
    line.text
  );
  if (!suffix) return;
  const main = line.text.slice(0, suffix.index).trimEnd();
  const translation = suffix[0].trim();
  // A loanword/name or an isolated Latin letter inside the Chinese is not a translation.
  if (
    script(main) !== 'cjk' ||
    script(translation) !== 'latin' ||
    (main.match(/[\u3040-\u30ff\u3400-\u9fff]/gu)?.length ?? 0) < 4 ||
    (translation.match(/[A-Za-z]/gu)?.length ?? 0) < 8 ||
    (translation.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/gu)?.length ?? 0) < 2 ||
    /[（(][^）)]*$/u.test(main)
  )
    return;
  const prefix = prefixWords(line, main);
  if (!prefix) return;
  // Unlike parenthesized metadata, independently timed English is evidence of bilingual singing.
  if (line.words?.slice(prefix.cut).some((word) => word.duration > 0)) return;
  let romaText = line.romaText;
  if (romaText) {
    // Align an identical complete suffix, never guess where a romanization should be cut.
    if (!romaText.endsWith(translation)) return;
    romaText = romaText.slice(0, -translation.length).trimEnd();
    if (!romaText) return;
  }
  return { ...line, text: main, trText: translation, romaText, words: prefix.words };
}

function safeGroup(main: Row[], translation: Row[], mode: TimingMode = 'timed'): boolean {
  const all = [...main, ...translation].map((r) => r.line);
  if (!translation.every((r) => translationAuxiliaryIsSafe(r.line))) return false;
  if (mode === 'untimed')
    return all.every((line) => inTimingMode(line, mode) && (line.duration ?? 0) >= 0);
  if (timed(main[0].line) && translation.some((r) => timed(r.line))) return false;
  if (main.some((r) => timed(r.line)) && !main.every((r) => timed(r.line))) return false;
  if (main.some((r) => timed(r.line) && !r.line.words?.length)) return false;
  if (translation.some((r) => timed(r.line))) return false;
  if (all.at(-1)!.startTime! - all[0].startTime! > 12000) return false;
  let previousStart = -Infinity;
  let previousWordEnd = -Infinity;
  for (const line of all) {
    if (line.startTime! < previousStart || (line.duration ?? 0) < 0) return false;
    previousStart = line.startTime!;
  }
  for (const row of main) {
    for (const word of row.line.words ?? []) {
      if (
        !Number.isFinite(word.startTime) ||
        !Number.isFinite(word.duration) ||
        word.duration < 0 ||
        word.startTime < previousWordEnd
      )
        return false;
      previousWordEnd = word.startTime + word.duration;
    }
  }
  return true;
}

function mergeGroup(main: Row[], translation: Row[], rule: MergeRule): Row {
  const first = main[0].line;
  const all = [...main, ...translation];
  const words = main.flatMap((r, index) =>
    (r.line.words ?? []).map((word, wordIndex, array) =>
      index < main.length - 1 && wordIndex === array.length - 1 ? { ...word, space: true } : word
    )
  );
  return {
    indices: all.flatMap((r) => r.indices).sort((a, b) => a - b),
    rule,
    line: {
      ...first,
      text: main.map((r) => r.line.text).join(' '),
      trText: translation.map((r) => r.line.text).join(' '),
      romaText: main.some((r) => r.line.romaText)
        ? main
            .map((r) => r.line.romaText || '')
            .filter(Boolean)
            .join(' ')
        : first.romaText,
      startTime: first.startTime,
      duration:
        first.startTime === -1 ? 0 : Math.max(...all.map((r) => end(r.line))) - first.startTime!,
      words: words.length ? words : undefined,
      hasWordByWord: words.length > 0
    }
  };
}

function evaluateStructure(rows: Row[], mode: TimingMode) {
  const sections: Row[][] = [];
  let section: Row[] = [];
  const totals = { latin: 0, cjk: 0 };
  for (const row of rows) {
    const language = row.rule ? undefined : eligible(row.line, mode);
    if (language) totals[language]++;
    const gap = section.length ? row.line.startTime! - section.at(-1)!.line.startTime! : 0;
    if (!language || (mode === 'timed' && (gap > 12000 || gap < 0))) {
      if (section.length) sections.push(section);
      section = [];
    }
    if (language) section.push(row);
  }
  if (section.length) sections.push(section);
  const evaluate = (direction: Script) => {
    const groups: Group[] = [];
    const covered = { latin: 0, cjk: 0 };
    for (const part of sections) {
      // Anchor at the section start: never shift a row to improve coverage.
      if (eligible(part[0].line, mode) !== direction) continue;
      let i = 0;
      while (i < part.length) {
        const start = i;
        while (i < part.length && eligible(part[i].line, mode) === direction) i++;
        const middle = i;
        while (i < part.length && eligible(part[i].line, mode) !== direction) i++;
        const main = part.slice(start, middle),
          translation = part.slice(middle, i);
        if (
          !main.length ||
          !translation.length ||
          main.length > 3 ||
          translation.length > 3 ||
          !safeGroup(main, translation, mode)
        )
          continue;
        groups.push({ main, translation });
        covered[direction] += main.length;
        covered[direction === 'latin' ? 'cjk' : 'latin'] += translation.length;
      }
    }
    return {
      groups,
      direction,
      covered,
      score: Math.min(covered.latin / (totals.latin || 1), covered.cjk / (totals.cjk || 1))
    };
  };
  return { totals, candidates: [evaluate('latin'), evaluate('cjk')] };
}

function splitMixedInline(rows: Row[]): Row[] {
  const proposals = new Map<Row, ILyricText>();
  for (const row of rows) {
    const split = !row.rule && mixedInlineCandidate(row.line);
    if (split) proposals.set(row, split);
  }
  const accepted = new Set<Row>();
  for (const mode of ['timed', 'untimed'] as const) {
    const inline = [...proposals.keys()].filter((row) => inTimingMode(row.line, mode));
    if (inline.length < 6) continue;
    const evidence = rows.map((row) =>
      proposals.has(row) ? { ...row, rule: 'inline' as const } : row
    );
    const { totals, candidates } = evaluateStructure(evidence, mode);
    // Unclassified text is not free evidence for this new rule.
    const unknown = evidence.filter(
      (row) =>
        !row.rule &&
        !protectedLine(row.line) &&
        inTimingMode(row.line, mode) &&
        row.line.text.trim() &&
        !eligible(row.line, mode)
    ).length;
    const scores = candidates.map((candidate) => ({
      direction: candidate.direction,
      score: Math.min(
        (candidate.covered.latin + (candidate.direction === 'cjk' ? inline.length : 0)) /
          (totals.latin + inline.length + unknown),
        (candidate.covered.cjk + (candidate.direction === 'cjk' ? inline.length : 0)) /
          (totals.cjk + inline.length + unknown)
      )
    }));
    const chinese = scores.find((candidate) => candidate.direction === 'cjk')!;
    const other = scores.find((candidate) => candidate.direction === 'latin')!;
    if (chinese.score >= 0.85 && chinese.score - other.score >= 0.1 - 1e-9)
      inline.forEach((row) => accepted.add(row));
  }
  return rows.map((row) =>
    accepted.has(row) ? { ...row, line: proposals.get(row)!, rule: 'inline' } : row
  );
}

function structuralGroups(rows: Row[], mode: TimingMode = 'timed'): Row[] {
  const { totals, candidates } = evaluateStructure(rows, mode);
  // Untimed text needs repeated inline evidence to supplement a short run of adjacent pairs.
  const inline =
    mode === 'untimed'
      ? rows.filter(
          (r) => r.rule === 'inline' && inTimingMode(r.line, mode) && script(r.line.text) === 'cjk'
        ).length
      : 0;
  for (const candidate of candidates) {
    const support = candidate.direction === 'cjk' ? inline : 0;
    candidate.score = Math.min(
      (candidate.covered.latin + support) / (totals.latin + inline || 1),
      (candidate.covered.cjk + support) / (totals.cjk + inline || 1)
    );
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (
    best.groups.length + (best.direction === 'cjk' ? inline : 0) < 6 ||
    best.score < 0.85 ||
    best.score - candidates[1].score < 0.1 - 1e-9
  )
    return rows;
  // Simultaneous pairs alone cannot establish a cross-time translation direction.
  if (
    mode === 'timed' &&
    !best.groups.some(
      (group) => group.translation.at(-1)!.line.startTime! - group.main[0].line.startTime! > 50
    )
  )
    return rows;
  const replacements = new Map<Row, Row>();
  const removed = new Set<Row>();
  for (const { main, translation } of best.groups) {
    replacements.set(main[0], mergeGroup(main, translation, 'structure'));
    [...main.slice(1), ...translation].forEach((r) => removed.add(r));
  }
  return rows.filter((r) => !removed.has(r)).map((r) => replacements.get(r) ?? r);
}

/** Derive display data from parser output; never write into the source or cache. */
export function normalizeLyricForDisplay(raw: ILyric, policy: LyricDisplayPolicy = {}) {
  let rows: Row[] = raw.lrcArray.map((line, index) => ({
    line: {
      ...line,
      startTime: line.startTime ?? (raw.lrcTimeArray[index] ?? 0) * 1000,
      words: line.words?.map((w) => ({ ...w }))
    },
    indices: [index]
  }));
  const mergeInfo: LyricMergeInfo = {
    version: LYRIC_MERGE_VERSION,
    sourceId: policy.sourceId ?? raw.sourceId ?? raw.source ?? 'unknown',
    rules: [],
    records: []
  };
  if (policy.enabled !== false && !raw.legacyProcessed && raw.format !== 'ttml') {
    rows = rows.map((row) => {
      const split = splitInline(row.line);
      return split ? { ...row, line: split, rule: 'inline' } : row;
    });
    rows = splitMixedInline(rows);
    rows = structuralGroups(rows);
    rows = structuralGroups(rows, 'untimed');
    const paired: Row[] = [];
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i],
        b = rows[i + 1];
      const aScript = !a.rule && eligible(a.line),
        bScript = b && !b.rule && eligible(b.line);
      if (
        aScript &&
        bScript &&
        aScript !== bScript &&
        Math.abs(a.line.startTime! - b.line.startTime!) <= 50 &&
        !(timed(a.line) && timed(b.line))
      ) {
        const main = aScript === 'latin' ? a : b,
          translation = aScript === 'cjk' ? a : b;
        // A timed translation is a separate sung line, not auxiliary metadata.
        if (!timed(translation.line) && translationAuxiliaryIsSafe(translation.line)) {
          paired.push(mergeGroup([main], [translation], 'same-time'));
          i++;
          continue;
        }
      }
      paired.push(a);
    }
    rows = paired;
  }
  rows.forEach((row, outputIndex) => {
    if (!row.rule) return;
    if (!mergeInfo.rules.includes(row.rule)) mergeInfo.rules.push(row.rule);
    mergeInfo.records.push({ rule: row.rule, originalIndices: row.indices, outputIndex });
  });
  const lrcArray = rows.map((r) => r.line);
  return {
    lyric: {
      ...raw,
      lrcArray,
      lrcTimeArray: lrcArray.map((l) => l.startTime! / 1000),
      hasWordByWord: lrcArray.some((l) => !!l.words?.length)
    },
    mergeInfo
  };
}
