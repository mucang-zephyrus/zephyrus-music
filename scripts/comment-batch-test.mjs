#!/usr/bin/env node
/**
 * 评论区批量崩溃诊断脚本（只测不修）。
 *
 * 对指定歌单前 N 首歌逐首拉取评论，按 MobileCommentsOverlay.vue 的真实渲染
 * 访问序列复刻每一步字段访问（listTree → 模板 → isMine/replyTarget/floor），
 * 记录会抛错的访问点与数据形态特征，最后汇总崩溃歌曲 vs 正常歌曲的特征差异。
 *
 * 用法：node scripts/comment-batch-test.mjs [歌单ID] [数量]
 */

const GATEWAY = 'https://mucang.xyz/zephyrus/api';
const PLAYLIST_ID = process.argv[2] || '17426036509';
const LIMIT = Math.min(Number(process.argv[3]) || 50, 100);
// 每首拉取的页数（每页 30 条）：loadMore 越深越容易出现注销账号/缺字段等脏形态
const PAGES = Math.min(Number(process.argv[4]) || 1, 5);
const FETCH_DELAY = 220; // 逐首间隔，降低被上游风控的概率

// ────────────────────────── 工具 ──────────────────────────

async function api(path, params = {}) {
  const url = new URL(GATEWAY + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('timestamp', String(Date.now()));
  url.searchParams.set('device', 'web');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// getImgUrl（utils/index.ts）对非字符串真值 avatarUrl 的行为：url.includes 会抛
function getImgUrlAvatarCrash(avatarUrl) {
  try {
    if (!avatarUrl) return false;
    void avatarUrl.includes('xxx'); // 非字符串真值在此抛 TypeError
    return false;
  } catch {
    return true;
  }
}

// ──────────── 浮层渲染路径复刻（MobileCommentsOverlay.vue HEAD）────────────

/** listTree computed 的忠实复刻（含 catch 回退与回退内的二次抛错语义） */
function replicateListTree(items) {
  try {
    const roots = new Map();
    const order = [];
    for (const c of items) {
      if (c.beReplied && c.beReplied.length) continue;
      const node = { comment: c, children: [] };
      roots.set(`${c.user?.userId}|${c.content}`, node);
      order.push(node);
    }
    const trailing = [];
    for (let i = 0; i < items.length; i += 1) {
      const c = items[i];
      if (!c.beReplied || !c.beReplied.length) continue;
      const preview = c.beReplied[0];
      const anchorKey = `${preview.user?.userId}|${preview.content}`;
      const target = roots.get(anchorKey);
      if (target) {
        target.children.push(c);
        continue;
      }
      trailing.push({
        node: { comment: c, children: [], replyingTo: preview.user?.nickname },
        anchorKey
      });
    }
    for (const { node, anchorKey } of trailing) {
      const idx = order.findIndex(
        (n) => `${n.comment.user?.userId}|${n.comment.content}` === anchorKey
      );
      if (idx >= 0) order.splice(idx + 1, 0, node);
      else order.push(node);
    }
    return { ok: true, nodes: order };
  } catch (err) {
    // catch 回退：items.map —— items 非数组时二次抛错（与源码语义一致）
    try {
      return { ok: true, nodes: items.map((comment) => ({ comment, children: [] })) };
    } catch (err2) {
      return { ok: false, error: `listTree 回退仍抛错: ${err2.message}（首次: ${err.message}）` };
    }
  }
}

/**
 * 对单条评论执行模板/交互的全部字段访问，返回触发的崩溃点清单。
 * loggedIn：isMine 只在登录态才会走到 comment.user.userId（未登录短路为 false）
 */
function replicateCommentRender(c, loggedIn) {
  const crashes = [];
  // :key
  void c.commentId;
  // avatarUrl → getImgUrl(comment.user?.avatarUrl)
  if (getImgUrlAvatarCrash(c.user?.avatarUrl)) {
    crashes.push('getImgUrl(avatarUrl 非字符串真值)');
  }
  // user?.nickname / formatTime / content / formatNumber —— 均有防护或仅静默
  // isMine：!!userStore.user?.userId && comment.user.userId === ...
  if (loggedIn) {
    try {
      const meId = 8464422206; // 模拟登录用户
      const mine = !!meId && c.user.userId === meId;
      void mine;
    } catch (err) {
      crashes.push(`isMine: ${err.message}`);
    }
  }
  // 楼层引用行：v-if="beReplied && beReplied.length" 后直接 beReplied[0].user / .content
  if (c.beReplied && c.beReplied.length) {
    try {
      const preview = c.beReplied[0];
      const nick = preview.user?.nickname;
      void nick;
      void preview.content;
    } catch (err) {
      crashes.push(`楼层引用行 beReplied[0]: ${err.message}`);
    }
  }
  // startReply → 底部输入条 replyTarget.user.nickname（点击「回复」即触发）
  try {
    const replyTarget = c;
    void replyTarget.user.nickname;
  } catch (err) {
    crashes.push('回复输入条 replyTarget.user.nickname（点「回复」触发）');
  }
  return crashes;
}

/** 数据形态特征提取（"脏形态清单"） */
function extractFeatures(thread) {
  const comments = thread.comments ?? [];
  const hot = thread.hotComments ?? [];
  const all = [...(Array.isArray(hot) ? hot : []), ...(Array.isArray(comments) ? comments : [])];
  const ids = new Set();
  let dupIds = 0; // 跨 hot/latest 合并去重前的重复（参考值）
  let dupInComments = 0; // comments 数组内部重复（实际渲染 :key 冲突面）
  let dupInHot = 0; // hot 数组内部重复
  let bigIds = 0;
  const missingUserExamples = [];
  let missingUser = 0;
  let nullBeRepliedElem = 0;
  let beRepliedCount = 0;
  let nonStringContent = 0;
  let missingTime = 0;
  let missingLikedCount = 0;
  let avatarNonString = 0;
  const userIdTypes = new Set();
  const perArray = [comments, hot];
  for (const arr of perArray) {
    const seenArr = new Set();
    for (const c of arr) {
      const k = String(c.commentId);
      if (seenArr.has(k)) {
        if (arr === comments) dupInComments += 1;
        else dupInHot += 1;
      }
      seenArr.add(k);
    }
  }
  for (const c of all) {
    if (c.commentId !== undefined) {
      if (ids.has(c.commentId)) dupIds += 1;
      ids.add(c.commentId);
      if (typeof c.commentId === 'number' && Math.abs(c.commentId) > Number.MAX_SAFE_INTEGER) {
        bigIds += 1;
      }
    }
    if (!c.user && missingUserExamples.length < 3) {
      missingUserExamples.push({
        commentId: String(c.commentId),
        content: String(c.content || '').slice(0, 24),
        hasBeReplied: Array.isArray(c.beReplied) && c.beReplied.length > 0
      });
    }
    if (!c.user) missingUser += 1;
    else if (c.user.userId !== undefined) userIdTypes.add(typeof c.user.userId);
    if (Array.isArray(c.beReplied) && c.beReplied.length) {
      beRepliedCount += 1;
      if (!c.beReplied[0] || typeof c.beReplied[0] !== 'object') nullBeRepliedElem += 1;
    }
    if (typeof c.content !== 'string') nonStringContent += 1;
    if (c.time === undefined || c.time === null) missingTime += 1;
    if (c.likedCount === undefined || c.likedCount === null) missingLikedCount += 1;
    if (c.user?.avatarUrl && typeof c.user.avatarUrl !== 'string') avatarNonString += 1;
  }
  return {
    fetchedComments: Array.isArray(comments) ? comments.length : -1,
    hotComments: Array.isArray(hot) ? hot.length : -1,
    commentsIsArray: Array.isArray(comments),
    hotIsArray: Array.isArray(hot),
    missingUser,
    beRepliedCount,
    nullBeRepliedElem,
    nonStringContent,
    missingTime,
    missingLikedCount,
    avatarNonString,
    dupIds,
    dupInComments,
    dupInHot,
    bigIds,
    missingUserExamples,
    userIdTypes: [...userIdTypes].join('+') || '-'
  };
}

// ────────────────────────── 主流程 ──────────────────────────

async function main() {
  console.log(`== 评论区批量崩溃诊断 ==`);
  console.log(`歌单: ${PLAYLIST_ID}，取前 ${LIMIT} 首\n`);

  // 1. 歌单详情 → trackIds
  const detail = await api('/playlist/detail', { id: PLAYLIST_ID });
  const playlist = detail?.playlist || detail?.data?.playlist;
  if (!playlist?.trackIds?.length) {
    console.error('歌单详情获取失败或无 trackIds:', JSON.stringify(detail).slice(0, 300));
    process.exit(1);
  }
  const trackIds = playlist.trackIds
    .map((t) => Number(t?.id))
    .filter(Number.isFinite)
    .slice(0, LIMIT);
  console.log(`歌单「${playlist.name}」共 ${playlist.trackIds.length} 首，测试前 ${trackIds.length} 首\n`);

  // 2. 歌曲名（song/detail 单次最多 40 个 id）
  const idText = trackIds.join(',');
  const songNames = new Map();
  for (let i = 0; i < idText.split(',').length; i += 40) {
    const chunk = trackIds.slice(i, i + 40);
    const det = await api('/song/detail', { ids: chunk.join(',') });
    for (const s of det?.songs || []) {
      songNames.set(String(s.id), `${(s.ar || s.artists || []).map((a) => a.name).join('/')} - ${s.name}`);
    }
    await sleep(FETCH_DELAY);
  }

  // 3. 逐首拉评论 + 渲染路径复刻
  const rows = [];
  for (let i = 0; i < trackIds.length; i += 1) {
    const id = trackIds[i];
    const name = songNames.get(String(id)) || `id:${id}`;
    const row = {
      index: i + 1,
      id,
      name,
      total: 0,
      features: null,
      listTreeOk: true,
      crashes: [],
      fetchError: null
    };
    try {
      let merged = { comments: [], hotComments: [], total: 0 };
      for (let page = 0; page < PAGES; page += 1) {
        const thread = await api('/comment/music', { id, limit: 30, offset: page * 30 });
        if (thread?.code && thread.code !== 200 && !thread.comments) {
          throw new Error(`code=${thread.code}${thread.message ? ' ' + thread.message : ''}`);
        }
        merged = {
          comments: [...merged.comments, ...(thread.comments ?? [])],
          hotComments: page === 0 ? (thread.hotComments ?? []) : merged.hotComments,
          total: Number(thread?.total) || merged.total
        };
        if (!(thread?.more ?? true) && page + 1 < PAGES) break; // 没有更多页
        await sleep(FETCH_DELAY);
      }
      const thread = merged;
      row.total = Number(thread?.total) || 0;
      row.features = extractFeatures(thread);

      // 渲染路径复刻：list（store 已 ?? [] 防护后）→ listTree → 模板逐条渲染
      const list = thread.comments ?? [];
      const seen = new Set();
      // 分页合并后同一条评论可能重复出现：渲染时按 commentId 去重（模板 :key 语义）
      const rendered = new Map();
      for (const c of list) {
        if (!rendered.has(String(c.commentId))) rendered.set(String(c.commentId), c);
      }
      const tree = replicateListTree([...rendered.values()]);
      row.listTreeOk = tree.ok;
      if (!tree.ok) row.crashes.push(tree.error);
      if (tree.ok) {
        for (const node of tree.nodes) {
          for (const crash of replicateCommentRender(node.comment, true)) {
            const key = crash.split(':')[0];
            if (!seen.has(key)) {
              seen.add(key);
              row.crashes.push(crash + (key === 'isMine' ? '（仅登录态）' : ''));
            }
          }
        }
      }
      row.features.listTreeSecondThrow = !tree.ok;
    } catch (err) {
      row.fetchError = err.message;
    }

    // 输出行
    const f = row.features;
    const featureTags = f
      ? [
          !f.commentsIsArray && 'comments非数组',
          !f.hotIsArray && 'hot非数组',
          f.missingUser && `缺user×${f.missingUser}`,
          f.nullBeRepliedElem && `beReplied[0]空×${f.nullBeRepliedElem}`,
          f.beRepliedCount && `有引用×${f.beRepliedCount}`,
          f.nonStringContent && `content非字符串×${f.nonStringContent}`,
          f.missingTime && `缺time×${f.missingTime}`,
          f.missingLikedCount && `缺likedCount×${f.missingLikedCount}`,
          f.avatarNonString && `avatar非字符串×${f.avatarNonString}`,
          f.dupIds && `重复commentId×${f.dupIds}`,
          (f.dupInComments || f.dupInHot) && `数组内重复×${(f.dupInComments || 0) + (f.dupInHot || 0)}`,
          f.missingUserExamples.length && `缺user样例:${JSON.stringify(f.missingUserExamples)}`,
          f.bigIds && `超52位id×${f.bigIds}`,
          f.userIdTypes !== '-' && `userId类型:${f.userIdTypes}`
        ].filter(Boolean)
      : [];
    const status = row.fetchError
      ? `FETCH失败(${row.fetchError})`
      : row.crashes.length
        ? `崩溃: ${row.crashes.join('；')}`
        : '正常';
    console.log(
      `${String(row.index).padStart(2)} | ${name.slice(0, 34).padEnd(34)} | 总评${String(row.total).padStart(7)} | ${featureTags.join(' ') || '无特征'} | ${status}`
    );
    rows.push(row);
    await sleep(FETCH_DELAY);
  }

  // 4. 汇总
  const tested = rows.filter((r) => !r.fetchError);
  const crashed = tested.filter((r) => r.crashes.length);
  console.log(`\n== 汇总 ==`);
  console.log(`测试 ${tested.length}/${rows.length} 首（${rows.length - tested.length} 首请求失败）`);
  console.log(`崩溃 ${crashed.length} 首，正常 ${tested.length - crashed.length} 首`);

  const crashAccess = {};
  for (const r of crashed) {
    for (const c of r.crashes) {
      const key = c.split(':')[0].split('（')[0];
      crashAccess[key] = (crashAccess[key] || 0) + 1;
    }
  }
  console.log('\n崩溃点分布:', JSON.stringify(crashAccess, null, 2));

  const featKeys = [
    'missingUser',
    'nullBeRepliedElem',
    'nonStringContent',
    'missingTime',
    'missingLikedCount',
    'avatarNonString',
    'dupInComments',
    'dupInHot',
    'bigIds',
    'listTreeSecondThrow'
  ];
  console.log('\n特征对比（崩溃组均值 vs 正常组均值 / 崩溃组出现率）:');
  for (const key of featKeys) {
    const c = crashed.filter((r) => (key === 'listTreeSecondThrow' ? r.features?.[key] : (r.features?.[key] || 0) > 0));
    const avg = (arr) =>
      arr.length ? (arr.reduce((s, r) => s + (r.features?.[key] || 0), 0) / arr.length).toFixed(2) : '0';
    console.log(
      `  ${key.padEnd(20)} 崩溃组均值 ${avg(crashed).padStart(6)} | 正常组均值 ${avg(
        tested.filter((r) => !r.crashes.length)
      ).padStart(6)} | 崩溃组出现率 ${crashed.length ? c.length + '/' + crashed.length : '0/0'}`
    );
  }

  if (crashed.length) {
    console.log('\n崩溃歌曲清单:');
    for (const r of crashed) {
      console.log(`  #${r.index} ${r.name} (id=${r.id}) → ${r.crashes.join('；')}`);
    }
  } else {
    console.log('\n前 50 首中未复现崩溃（见"崩溃点分布"为空；崩溃可能依赖登录态之外的条件或更冷门歌曲）。');
  }
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
