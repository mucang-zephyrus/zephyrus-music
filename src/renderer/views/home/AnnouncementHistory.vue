<template>
  <section class="announcement-history">
    <header>
      <RouterLink to="/" aria-label="返回首页"><i class="ri-arrow-left-line" /></RouterLink>
      <h1>历史公告</h1>
    </header>
    <article
      v-for="entry in entries"
      :key="entry.id"
      :style="transitionStyle(entry.id)"
      class="announcement-card"
    >
      <time v-if="entry.date" :datetime="entry.date">{{ entry.date }}</time>
      <h2>{{ entry.title }}</h2>
      <tester-credits
        v-if="entry.version"
        :testers="credits[entry.version] || []"
        :expanded="expanded === entry.id"
        @expand="expanded = entry.id"
      />
      <button v-if="expanded === entry.id" class="action" @click="expanded = ''">
        返回更新公告
      </button>
      <template v-else>
        <div v-if="entry.version" class="release-notes" v-html="renderReleaseNotes(entry.body)" />
        <p v-else>{{ entry.body }}</p>
        <a
          v-if="entry.url"
          class="action"
          :href="entry.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ entry.buttonText || '查看详情' }} <i class="ri-arrow-right-up-line" />
        </a>
      </template>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { cachedAnnouncements, fetchAnnouncements } from '@/api/announcements';
import { fetchTesterCredits, type TesterCredit } from '@/api/testerCredits';
import TesterCredits from '@/components/common/TesterCredits.vue';
import { APP_VERSION, IS_TEST_BUILD } from '@/utils/appVersion';
import { renderReleaseNotes } from '@/utils/releaseNotes';
import { getLatestReleaseInfo } from '@/utils/update';

import stableNotes from '../../../../docs/releases/v1.4.2.md?raw';
import testNotes from '../../../../docs/releases/v1.4.3-test2.md?raw';

interface Entry {
  id: string;
  title: string;
  body: string;
  date?: string;
  version?: string;
  url?: string;
  buttonText?: string;
}

const route = useRoute();
const notices = ref(cachedAnnouncements());
const releases = ref<Entry[]>([
  {
    id: 'release-1.4.2',
    title: 'v1.4.2 更新公告',
    version: '1.4.2',
    body: stableNotes.replace(/^# .*\r?\n+/, '')
  }
]);
if (IS_TEST_BUILD)
  releases.value.unshift({
    id: `release-${APP_VERSION}`,
    title: `v${APP_VERSION} 更新公告`,
    version: APP_VERSION,
    body: testNotes
  });
const credits = ref<Record<string, TesterCredit[]>>({});
const expanded = ref('');
const entries = computed(() => {
  const list: Entry[] = notices.value.map(({ id, title, body, date, action, buttonText }) => {
    const candidate =
      action?.type === 'album' && action.id
        ? `https://music.163.com/#/album?id=${encodeURIComponent(action.id)}`
        : action?.url;
    return {
      id: String(id),
      title,
      body,
      date,
      url: candidate?.startsWith('https://') ? candidate : undefined,
      buttonText
    };
  });
  const target = list.find((item) => item.id === route.query.selected);
  return [
    ...(target ? [target] : []),
    ...releases.value,
    ...list.filter((item) => item !== target)
  ];
});

function transitionStyle(id: string) {
  return id === route.query.selected ? { viewTransitionName: 'current-announcement' } : undefined;
}

onMounted(async () => {
  void fetchAnnouncements().then((list) => {
    notices.value = list;
  });
  const result = await getLatestReleaseInfo('1.4.2');
  if (result) {
    const version = result.tag_name.replace(/^v/, '');
    const date = result.published_at?.slice(0, 10);
    const existing = releases.value.find((entry) => entry.version === version);
    if (existing) existing.date = date;
    else
      releases.value.unshift({
        id: `release-${version}`,
        title: `v${version} 更新公告`,
        body: result.body,
        version,
        date
      });
  }
  await Promise.all(
    releases.value.flatMap(({ version }) =>
      version && !version.includes('-test')
        ? [
            fetchTesterCredits(version).then((list) => {
              credits.value[version] = list;
            })
          ]
        : []
    )
  );
});
</script>

<style scoped>
.announcement-history {
  width: min(100%, 49rem);
  margin: 0 auto;
  padding: 20px 16px 48px;
  color: var(--floating-text);
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 20px;
}
header a {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--floating-control);
}
h1 {
  font-size: 26px;
  font-weight: 750;
}
h2 {
  font-size: 21px;
  font-weight: 720;
  margin-bottom: 8px;
}
.announcement-card {
  margin-bottom: 14px;
  border: 1px solid var(--floating-line);
  border-radius: 24px;
  padding: clamp(17px, 4vw, 28px);
  background: var(--floating-surface);
}
time {
  display: block;
  color: var(--floating-muted);
  font-size: 12px;
  margin-bottom: 8px;
}
p {
  white-space: pre-line;
  line-height: 1.65;
}
.action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--floating-control);
}
.release-notes {
  margin-top: 12px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.release-notes :deep(ul) {
  list-style: disc;
  padding-inline-start: 22px;
}
.release-notes :deep(h3) {
  margin: 13px 0 5px;
  font-weight: 700;
}
.release-notes :deep(a) {
  text-decoration: underline;
}
</style>
