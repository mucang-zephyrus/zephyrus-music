<script setup lang="ts">
import BorderBeam from '@/components/inspira/border-beam/BorderBeam.vue';
</script>

<template>
  <section class="download hairline-t">
    <div class="site-shell">
      <div v-reveal class="download-card glass">
        <BorderBeam :size="240" :duration="12000" />
        <img class="download-mark" src="/zephyrus-mark.png" alt="" aria-hidden="true" />
        <h2 class="section-title">下载 Zephyrus Player。</h2>
        <p class="section-body download-body">
          为 Android 设计的逐字歌词播放器。Android 8.0 及以上，签名发行版，完全开源；Web
          与桌面端可在浏览器或本地运行。
        </p>
        <div class="download-actions">
          <a class="btn-primary" href="https://mucang.xyz/zephyrus/apks/zephyrus-player-latest.apk">
            直接下载 APK
          </a>
          <a class="btn-ghost" href="https://github.com/cang-dot/zephyrus-player-android">
            查看源代码
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.download {
  padding: 88px 0 112px;
}

.download-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 56px 40px 52px;
  border-radius: var(--radius-panel);
  overflow: hidden;
}

.download-mark {
  width: 44px;
  height: 44px;
  margin-bottom: 24px;
}

.download-body {
  margin-top: 16px;
}

.download-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 34px;
}
</style>
