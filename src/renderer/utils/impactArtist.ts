const hanName = /^(?=.*\p{Script=Han})[\p{Script=Han}\p{M}\d\s·・.'’&!\-]+$/u;
const latinName = /^(?=.*\p{Script=Latin})[\p{Script=Latin}\p{M}\d\s.'’&!?+\-·]+$/u;

function bilingualAlias(first: string, second: string) {
  if (hanName.test(first) && latinName.test(second)) return { chinese: first, english: second };
  if (latinName.test(first) && hanName.test(second)) return { chinese: second, english: first };
  return null;
}

function parseArtist(name: string) {
  const alias = name.match(/^(.+?)\s*[（(]\s*([^()（）]+?)\s*[）)]$/u);
  if (alias) return bilingualAlias(alias[1].trim(), alias[2]);
  if (/[()（）]/u.test(name)) return null;
  const parts = name.split(/\s+/u);
  for (let i = 1; i < parts.length; i++) {
    const first = parts.slice(0, i).join(' ');
    const second = parts.slice(i).join(' ');
    if (/^(?:dj|mc)$/iu.test(first) || /^(?:乐队|樂隊|组合|組合)$/u.test(second)) continue;
    const pair = bilingualAlias(first, second);
    if (pair) return pair;
  }
  return null;
}

export function impactArtistCredit(names: readonly string[], swap: boolean) {
  const main: string[] = [];
  const outline: string[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name) continue;
    const pair = parseArtist(name);
    main.push(pair ? (swap ? pair.english : pair.chinese) : name);
    if (pair) outline.push(swap ? pair.chinese : pair.english);
  }
  return { main: main.join(' / '), outline: outline.join(' / ') };
}
