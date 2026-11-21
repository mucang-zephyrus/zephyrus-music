<template>
  <button
    v-if="!expanded && testers.length"
    type="button"
    class="testers-summary"
    @click="$emit('expand')"
  >
    <span>测试人员：</span>
    <span class="avatar-stack" aria-hidden="true">
      <span v-for="tester in testers.slice(0, 4)" :key="tester.id" class="avatar">
        <img
          v-if="tester.avatar"
          :src="tester.avatar"
          alt=""
          referrerpolicy="no-referrer"
          @error="hideImage"
        />
        <span>{{ initials(tester.name) }}</span>
      </span>
      <span v-if="testers.length > 4" class="avatar">+{{ testers.length - 4 }}</span>
    </span>
    <i class="ri-arrow-right-s-line" aria-hidden="true" />
  </button>
  <ul v-else-if="expanded" class="testers-list" aria-label="测试人员">
    <li v-for="tester in testers" :key="tester.id" class="tester-chip">
      <span class="avatar" aria-hidden="true">
        <img
          v-if="tester.avatar"
          :src="tester.avatar"
          alt=""
          referrerpolicy="no-referrer"
          @error="hideImage"
        />
        <span>{{ initials(tester.name) }}</span>
      </span>
      <span>{{ tester.name }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { TesterCredit } from '@/api/testerCredits';

defineProps<{ testers: TesterCredit[]; expanded?: boolean }>();
defineEmits<{ expand: [] }>();
const initials = (name: string) => Array.from(name).slice(0, 2).join('');
function hideImage(event: Event) {
  (event.target as HTMLImageElement).hidden = true;
}
</script>

<style scoped>
.testers-summary {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: var(--floating-muted);
  border-radius: 999px;
  width: fit-content;
}
.avatar-stack {
  display: flex;
  padding-left: 7px;
}
.avatar-stack .avatar {
  margin-left: -7px;
  border: 2px solid var(--floating-surface);
}
.avatar {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  overflow: hidden;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--floating-inset);
  color: var(--floating-text);
  font-weight: 650;
  font-size: 11px;
}
.avatar img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.testers-list {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 10px;
}
.tester-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  padding: 5px 14px 5px 5px;
  border-radius: 999px;
  background: var(--floating-control);
  overflow-wrap: anywhere;
  color: var(--floating-text);
}
</style>
