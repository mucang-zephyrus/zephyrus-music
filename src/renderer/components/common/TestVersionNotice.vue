<template>
  <Teleport to="body">
    <dialog ref="dialog" class="test-notice" aria-labelledby="test-notice-title" @cancel.prevent>
      <h2 id="test-notice-title">{{ title }}</h2>
      <template v-if="managedElsewhere">
        <p>已在另一台设备作出鸣谢选择。可在原设备的「关于」修改。</p>
        <footer><button type="button" @click="closeNotice">关闭</button></footer>
      </template>
      <template v-else-if="step === 'notice'">
        <p>此版本可能不稳定。反馈时请附上版本号、设备和复现步骤。</p>
        <a :href="feedbackUrl" target="_blank" rel="noopener noreferrer" @click="openFeedback"
          >反馈 Bug（GitHub）</a
        >
        <a v-if="!native && testDownload" :href="testDownload" download>下载 Android 测试包</a>
        <footer>
          <button autofocus type="button" :disabled="busy" @click="continueUsing">继续使用</button>
        </footer>
      </template>
      <template v-else-if="step === 'consent'">
        <p>是否愿意把您的显示名称和头像列入正式版鸣谢？已登录同一音乐账号的设备会记住您的选择。</p>
        <footer>
          <button type="button" class="secondary" :disabled="busy" @click="closeNotice">
            {{ edit ? '取消' : '稍后决定' }}
          </button>
          <button type="button" class="secondary" :disabled="busy" @click="finish(null)">
            {{ edit ? '取消公开' : '不公开' }}
          </button>
          <button type="button" :disabled="busy" @click="step = 'identity'">愿意公开</button>
        </footer>
      </template>
      <form v-else @submit.prevent="finish(credit)">
        <p>从已登录的账号选用昵称和头像，也可以自己填写显示名称。</p>
        <label for="credit-profile">展示资料</label>
        <select id="credit-profile" v-model="selection">
          <option value="">自己填写</option>
          <option
            v-for="account in accountStore.accounts.filter((item) => item.nickname)"
            :key="account.accountId"
            :value="account.accountId"
          >
            {{ account.nickname }} · {{ account.platform }}
          </option>
        </select>
        <template v-if="!selectedAccount">
          <label for="credit-name">显示名称</label>
          <input id="credit-name" v-model.trim="name" maxlength="48" required />
          <label for="credit-avatar">头像链接（可选）</label>
          <input
            id="credit-avatar"
            v-model.trim="avatar"
            type="url"
            maxlength="1500"
            placeholder="https://"
          />
        </template>
        <footer>
          <button type="button" class="secondary" :disabled="busy" @click="step = 'consent'">
            返回
          </button>
          <button type="submit" :disabled="busy || !credit.name">保存并继续</button>
        </footer>
      </form>
      <p v-if="error" role="alert">{{ error }}</p>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { openExternalUrl } from '@/api/bilibili';
import { type CreditProfile, loadTesterCredit, saveTesterCredit } from '@/api/testerCredits';
import { isAndroidNative } from '@/services/androidNative';
import { usePlatformAccountsStore } from '@/store/modules/platformAccounts';
import { APP_VERSION } from '@/utils/appVersion';
import { getLatestReleaseInfo } from '@/utils/update';

const props = defineProps<{ edit?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const accountStore = usePlatformAccountsStore();
const dialog = ref<HTMLDialogElement>();
const native = isAndroidNative();
const step = ref<'notice' | 'consent' | 'identity'>('notice');
const title = computed(() =>
  step.value === 'notice'
    ? `测试版本 ${APP_VERSION}`
    : step.value === 'consent'
      ? '测试人员鸣谢'
      : '您希望如何显示？'
);
const feedbackUrl =
  'https://github.com/mucang-zephyrus/zephyrus-music/issues/new?template=bug-report.zh-CN.yml';
const storageKey = `test-version-acknowledged:${APP_VERSION}`;
const creditKey = `tester-credit-choice:${APP_VERSION.split('-')[0]}`;
const managedElsewhere = ref(false);
const selection = ref('');
const name = ref('');
const avatar = ref('');
const error = ref('');
const busy = ref(false);
const testDownload = ref('');
const accountKeys = computed(() =>
  accountStore.accounts
    .filter((account) => account.userId && account.loginMethod !== 'uid')
    .map((account) => `${account.platform}:${account.userId}`)
);
const selectedAccount = computed(() =>
  accountStore.accounts.find((account) => account.accountId === selection.value)
);
const credit = computed(() => ({
  name: (selectedAccount.value?.nickname || name.value).trim().slice(0, 48),
  avatar: selectedAccount.value?.avatarUrl?.replace(/^http:/, 'https:') || avatar.value
}));

function closeNotice() {
  dialog.value?.close();
  emit('close');
}

function acknowledge() {
  localStorage.setItem(storageKey, '1');
  closeNotice();
}

function continueUsing() {
  if (localStorage.getItem(creditKey)) acknowledge();
  else step.value = 'consent';
}

function rememberDecision() {
  localStorage.setItem(creditKey, '1');
  acknowledge();
}

watch(accountKeys, async (keys) => {
  if (props.edit || busy.value || !dialog.value?.open || !keys.length) return;
  const profile = await loadTesterCredit(keys).catch(() => null);
  if (profile?.decided && keys === accountKeys.value && !busy.value) rememberDecision();
});

onMounted(async () => {
  const localChoice = localStorage.getItem(creditKey);
  if (!props.edit && localChoice && localStorage.getItem(storageKey)) return;

  const profile = await loadTesterCredit(accountKeys.value).catch(() => null);
  if (props.edit) {
    step.value = 'consent';
    managedElsewhere.value = Boolean(profile?.decided && !profile.owned);
    name.value = profile?.name || '';
    avatar.value = profile?.avatar || '';
  } else if (profile?.decided) {
    rememberDecision();
    return;
  }
  dialog.value?.showModal();
  if (!native)
    void getLatestReleaseInfo(APP_VERSION).then((release) => {
      testDownload.value = release?.assets[0]?.browser_download_url || '';
    });
});

async function finish(profile: CreditProfile | null) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const saved = await saveTesterCredit(accountKeys.value, profile);
    if (props.edit && !saved) {
      managedElsewhere.value = true;
      return;
    }
    rememberDecision();
  } catch {
    error.value = '暂时无法保存，请重试。';
  } finally {
    busy.value = false;
  }
}

function openFeedback(event: MouseEvent) {
  if (!native) return;
  event.preventDefault();
  openExternalUrl(feedbackUrl);
}
</script>

<style scoped>
.test-notice {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(28rem, calc(100% - 2rem));
  padding: 24px;
  max-height: 85dvh;
  overflow: auto;
  border: 1px solid var(--floating-line);
  border-radius: 24px;
  background: var(--floating-surface);
  color: var(--floating-text);
}
.test-notice::backdrop {
  background: #0008;
}
h2 {
  font-size: 1.25rem;
  font-weight: 700;
}
p {
  margin: 0.75rem 0;
  color: var(--floating-muted);
  line-height: 1.6;
}
a {
  display: block;
  width: fit-content;
  margin: 0.5rem 0;
  text-decoration: underline;
}
form {
  display: grid;
  gap: 8px;
}
input,
select {
  width: 100%;
  padding: 9px 12px;
  color: inherit;
  background: var(--floating-inset);
  border: 1px solid var(--floating-line);
  border-radius: 10px;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 1rem;
}
button {
  padding: 0.55rem 1.15rem;
  border-radius: 999px;
  background: var(--floating-primary);
  color: var(--floating-on-primary);
  font-weight: 650;
}
.secondary {
  color: inherit;
  background: var(--floating-control);
}
[role='alert'] {
  color: var(--floating-danger);
}
</style>
