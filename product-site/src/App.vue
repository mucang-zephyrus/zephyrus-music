<script setup lang="ts">
import AiSection from '@/components/site/AiSection.vue';
import DownloadSection from '@/components/site/DownloadSection.vue';
import EngineSection from '@/components/site/EngineSection.vue';
import HeroSection from '@/components/site/HeroSection.vue';
import SiteFooter from '@/components/site/SiteFooter.vue';
import SiteHeader from '@/components/site/SiteHeader.vue';
import SourceSection from '@/components/site/SourceSection.vue';
import StatusBarSection from '@/components/site/StatusBarSection.vue';
import StatsStrip from '@/components/site/StatsStrip.vue';
import StagesDetailSection from '@/components/site/StagesDetailSection.vue';
import StagesStrip from '@/components/site/StagesStrip.vue';
</script>

<template>
  <a class="skip-link" href="#top">跳到正文</a>
  <SiteHeader />
  <main>
    <HeroSection />
    <StagesStrip />
    <StagesDetailSection />
    <EngineSection />
    <SourceSection />
    <AiSection />
    <StatusBarSection />
    <StatsStrip />
    <DownloadSection />
  </main>
  <SiteFooter />
</template>

<style scoped>
.skip-link {
  position: fixed;
  top: -48px;
  left: 16px;
  z-index: 60;
  padding: 10px 16px;
  border-radius: 10px;
  background: var(--color-klein-bright);
  color: #fff;
  font-size: 13px;
  transition: top 160ms ease;
}

.skip-link:focus {
  top: 12px;
}
</style>
