<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

const scrolled = ref(false);

function onScroll() {
  scrolled.value = window.scrollY > 24;
}

onMounted(() => {
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll);
});
</script>

<template>
  <header class="site-header" :class="{ 'is-scrolled': scrolled }">
    <div class="site-shell header-row">
      <a class="brand" href="#top" aria-label="Zephyrus Player 首页">
        <img src="/zephyrus-mark.png" alt="" />
        <span>Zephyrus</span>
      </a>
      <nav class="main-nav" aria-label="主导航">
        <a href="#stages">播放舞台</a>
        <a href="#lyrics">歌词引擎</a>
        <a href="#android">状态栏歌词</a>
        <a href="https://mucang.xyz/zephyrus/docs/">文档</a>
      </nav>
      <a class="btn-primary header-download" href="https://mucang.xyz/zephyrus/apks/zephyrus-player-latest.apk">
        下载 APK
      </a>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  position: fixed;
  inset-inline: 0;
  top: 0;
  z-index: 40;
  transition:
    background-color 260ms ease,
    border-color 260ms ease,
    backdrop-filter 260ms ease;
  border-bottom: 1px solid transparent;
}

.site-header.is-scrolled {
  background: rgba(5, 6, 9, 0.72);
  border-bottom-color: var(--color-line);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
}

.header-row {
  display: flex;
  align-items: center;
  gap: 24px;
  height: 64px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}

.brand img {
  width: 22px;
  height: 22px;
}

.main-nav {
  display: none;
  align-items: center;
  gap: 26px;
  margin-inline: auto;
  font-size: 13.5px;
  color: var(--color-ink-dim);
}

.main-nav a {
  transition: color 180ms ease;
}

.main-nav a:hover {
  color: var(--color-ink);
}

@media (min-width: 860px) {
  .main-nav {
    display: flex;
  }
}

.header-download {
  margin-left: auto;
  padding: 8px 18px;
  font-size: 13px;
}

@media (min-width: 860px) {
  .header-download {
    margin-left: 0;
  }
}
</style>
