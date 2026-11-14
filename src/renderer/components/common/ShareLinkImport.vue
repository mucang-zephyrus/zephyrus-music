<template>
  <responsive-modal
    v-model="visible"
    :title="t('share.import.title')"
    :close-label="t('share.import.close')"
    :z-index="140000"
  >
    <div data-share-import class="share-import">
      <p>{{ t('share.import.hint') }}</p>
      <textarea
        ref="input"
        v-model="text"
        :aria-label="t('share.import.title')"
        :placeholder="t('share.import.placeholder')"
        rows="4"
      />
      <p v-if="status" role="status">{{ status }}</p>
      <button type="button" :disabled="!text.trim()" @click="submit">
        {{ t('share.import.identify') }}
      </button>
    </div>
  </responsive-modal>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ResponsiveModal from '@/components/common/ResponsiveModal.vue';
import { registerMobileBackLayer } from '@/services/mobileBackStack';
import { handleClipboardShare, resetLastHandledUrl } from '@/utils/deepLink';

const { t } = useI18n();
const visible = ref(false),
  text = ref(''),
  status = ref('');
const input = ref<HTMLTextAreaElement>();
let generation = 0;
let previousFocus: HTMLElement | null = null;
let handingOff = false;
async function open() {
  if (visible.value) return;
  previousFocus = document.activeElement as HTMLElement;
  handingOff = false;
  const token = ++generation;
  text.value = '';
  status.value = '';
  visible.value = true;
  void nextTick(() => {
    if (visible.value) input.value?.focus();
  });
  // Called directly by the user's click, preserving transient browser activation.
  try {
    const value = window.api?.readMusicShareClipboard
      ? await window.api.readMusicShareClipboard()
      : await navigator.clipboard.readText();
    if (token === generation && visible.value) text.value = value.slice(0, 65536);
  } catch {
    if (token === generation && visible.value) status.value = t('share.import.pasteManually');
  }
  await nextTick();
  if (visible.value) input.value?.focus();
}
async function submit() {
  resetLastHandledUrl();
  if (await handleClipboardShare(text.value)) {
    handingOff = true;
    visible.value = false;
  } else status.value = t('share.import.unsupported');
}
watch(visible, (value) => {
  if (value) return;
  generation++;
  if (!handingOff && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
const unregister = registerMobileBackLayer({
  id: 'share-link-import',
  priority: 1250,
  isActive: () => visible.value,
  onBack: () => {
    visible.value = false;
    return true;
  }
});
function keydown(event: KeyboardEvent) {
  if (!visible.value) return;
  event.stopImmediatePropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    visible.value = false;
  }
  if (event.key === 'Tab') {
    const dialog = input.value?.closest('[role="dialog"]');
    const elements = [
      ...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea') || [])
    ];
    const first = elements[0],
      last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
window.addEventListener('open-share-link-import', open);
document.addEventListener('keydown', keydown, true);
onBeforeUnmount(() => {
  generation++;
  unregister();
  window.removeEventListener('open-share-link-import', open);
  document.removeEventListener('keydown', keydown, true);
});
</script>

<style scoped>
.share-import {
  display: grid;
  gap: 14px;
  font-size: 14px;
  line-height: 1.6;
}
p {
  opacity: 0.7;
}
textarea {
  resize: vertical;
  width: 100%;
  padding: 12px;
  border: 1px solid #8885;
  border-radius: 12px;
  background: #8881;
}
button {
  justify-self: end;
  padding: 9px 22px;
  border-radius: 10px;
  background: var(--accent-color, #d4a056);
  color: #14151a;
  font-weight: 600;
}
button:disabled {
  opacity: 0.4;
}
</style>
