<template>
  <responsive-modal
    v-model="lyricMergeFeedbackVisible"
    :title="t('comp.smartLyricMerge.title')"
    :z-index="140000"
    :close-label="t('comp.smartLyricMerge.cancel')"
  >
    <div ref="panel" class="lyric-merge-panel">
      <p class="song">
        {{ target?.songName }} <span>{{ target?.artist }}</span>
      </p>
      <p class="explanation">{{ t('comp.smartLyricMerge.explanation') }}</p>
      <label>
        {{ t('comp.smartLyricMerge.description') }}
        <textarea
          ref="descriptionInput"
          v-model="description"
          rows="4"
          maxlength="3000"
          :placeholder="t('comp.smartLyricMerge.placeholder')"
        />
      </label>
      <label>
        {{ t('comp.smartLyricMerge.contact') }}
        <input v-model="contact" maxlength="160" autocomplete="email" />
      </label>
      <details>
        <summary>{{ t('comp.smartLyricMerge.preview') }}</summary>
        <p class="privacy">{{ t('comp.smartLyricMerge.privacy') }}</p>
        <pre>{{ diagnostics }}</pre>
      </details>
      <div class="policy">
        <button type="button" :disabled="!enabled" @click="disable">
          {{ t(enabled ? 'comp.smartLyricMerge.disable' : 'comp.smartLyricMerge.disabled') }}
        </button>
        <p>{{ t('comp.smartLyricMerge.restoreHint') }}</p>
      </div>
      <p v-if="status" role="status" class="status">{{ status }}</p>
    </div>
    <template #footer>
      <div class="actions">
        <button type="button" @click="lyricMergeFeedbackVisible = false">
          {{ t('comp.smartLyricMerge.cancel') }}
        </button>
        <button
          class="submit"
          type="button"
          :disabled="submitting || !description.trim()"
          @click="submit"
        >
          {{ t(submitting ? 'comp.smartLyricMerge.submitting' : 'comp.smartLyricMerge.submit') }}
        </button>
      </div>
    </template>
  </responsive-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { submitFeedback } from '@/api/feedback';
import ResponsiveModal from '@/components/common/ResponsiveModal.vue';
import {
  isLyricMergeEnabled,
  lyricMergeDiagnostics,
  lyricMergeFeedbackTarget as target,
  lyricMergeFeedbackVisible,
  setLyricMergeEnabled
} from '@/services/lyricMergePolicy';
import { registerMobileBackLayer } from '@/services/mobileBackStack';
import { APP_VERSION } from '@/utils/appVersion';

const { t } = useI18n();
const description = ref('');
const contact = ref('');
const submitting = ref(false);
const status = ref('');
const panel = ref<HTMLElement | null>(null);
const descriptionInput = ref<HTMLTextAreaElement | null>(null);
let previousFocus: HTMLElement | null = null;
let session = 0;
const enabled = computed(
  () => !!target.value && isLyricMergeEnabled(target.value.songKey, target.value.sourceId)
);
const diagnostics = computed(() => (target.value ? lyricMergeDiagnostics(target.value) : ''));
function disable() {
  const current = target.value;
  if (current && !setLyricMergeEnabled(current.songKey, current.sourceId, false))
    status.value = t('comp.smartLyricMerge.storageError');
}
async function submit() {
  if (submitting.value || !description.value.trim() || !target.value) return;
  const request = session;
  const content = `${description.value.trim()}\n\n${diagnostics.value}`;
  submitting.value = true;
  try {
    const result = await submitFeedback({
      type: 'bug',
      content,
      contact: contact.value.trim() || undefined,
      appVersion: APP_VERSION,
      device: navigator.userAgent,
      osVersion: navigator.platform
    });
    if (request !== session) return;
    status.value = t(
      result.success
        ? result.via === 'email'
          ? 'comp.smartLyricMerge.emailOpened'
          : 'comp.smartLyricMerge.sent'
        : 'comp.smartLyricMerge.failed'
    );
    if (result.success) description.value = '';
  } catch {
    if (request === session) status.value = t('comp.smartLyricMerge.failed');
  } finally {
    if (request === session) submitting.value = false;
  }
}
const unregister = registerMobileBackLayer({
  id: 'lyric-merge-feedback',
  priority: 1100,
  isActive: () => lyricMergeFeedbackVisible.value,
  onBack: () => {
    lyricMergeFeedbackVisible.value = false;
    return true;
  }
});
function keydown(event: KeyboardEvent) {
  if (!lyricMergeFeedbackVisible.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    lyricMergeFeedbackVisible.value = false;
  }
  if (event.key !== 'Tab') return;
  const modal = panel.value?.parentElement?.parentElement;
  const items = Array.from(
    modal?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, textarea, summary, [tabindex="0"]'
    ) ?? []
  ).filter((el) => el.getClientRects().length);
  const first = items[0],
    last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function keyup(event: KeyboardEvent) {
  if (lyricMergeFeedbackVisible.value) event.stopImmediatePropagation();
}
document.addEventListener('keydown', keydown, true);
document.addEventListener('keyup', keyup, true);
watch(lyricMergeFeedbackVisible, async (visible) => {
  session++;
  if (visible) {
    previousFocus = document.activeElement as HTMLElement;
    description.value = '';
    contact.value = '';
    status.value = '';
    submitting.value = false;
    await nextTick();
    descriptionInput.value?.focus();
  } else {
    previousFocus?.isConnected && previousFocus.focus({ preventScroll: true });
  }
});
onBeforeUnmount(() => {
  unregister();
  document.removeEventListener('keydown', keydown, true);
  document.removeEventListener('keyup', keyup, true);
});
</script>

<style scoped>
.lyric-merge-panel {
  color: inherit;
  font-size: 14px;
  line-height: 1.6;
}
.song {
  font-weight: 600;
}
.song span {
  font-weight: 400;
  opacity: 0.6;
}
.explanation,
.privacy {
  opacity: 0.65;
  font-size: 12px;
  margin: 8px 0 20px;
}
label {
  display: grid;
  gap: 8px;
  margin: 16px 0;
  font-size: 13px;
}
input,
textarea {
  background: rgb(128 128 128 / 0.07);
  border: 1px solid rgb(128 128 128 / 0.22);
  border-radius: 10px;
  padding: 10px 12px;
  width: 100%;
  color: inherit;
  font: inherit;
}
textarea {
  resize: vertical;
  min-height: 96px;
}
input:focus-visible,
textarea:focus-visible,
button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent-color, #617c99);
  outline-offset: 3px;
}
details {
  font-size: 12px;
  margin: 20px 0;
}
summary {
  cursor: pointer;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow: auto;
  font-size: 11px;
}
.policy {
  border-top: 1px solid rgb(128 128 128 / 0.16);
  padding-top: 16px;
}
button {
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  min-height: 40px;
}
.policy button {
  padding-left: 0;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.policy p {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 0;
}
.submit {
  background: var(--accent-color, #4c6580);
  color: white;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button:active {
  opacity: 0.6;
}
.status {
  margin-top: 16px;
  font-size: 13px;
}
@media (prefers-reduced-motion: reduce) {
  :global(.slide-up-enter-active:has(.lyric-merge-panel)),
  :global(.slide-up-leave-active:has(.lyric-merge-panel)),
  :global(.scale-fade-enter-active:has(.lyric-merge-panel)),
  :global(.scale-fade-leave-active:has(.lyric-merge-panel)) {
    transition: opacity 120ms ease;
    transform: none;
  }
  :global(.slide-up-enter-from:has(.lyric-merge-panel)),
  :global(.slide-up-leave-to:has(.lyric-merge-panel)),
  :global(.scale-fade-enter-from:has(.lyric-merge-panel)),
  :global(.scale-fade-leave-to:has(.lyric-merge-panel)) {
    transform: none;
    opacity: 0;
  }
}
</style>
