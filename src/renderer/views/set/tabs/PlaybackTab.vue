<template>
  <div>
    <setting-section :title="t('settings.sections.playback')">
      <ios-audio-protection-settings class="mb-4" />
      <setting-item
        :title="t('settings.playback.quality')"
        :description="t('settings.playback.qualityDesc')"
      >
        <s-select
          v-model="setData.musicQuality"
          :options="qualityOptions"
          width="w-40 max-md:w-full"
        />
      </setting-item>

      <setting-item
        :title="t('settings.playback.autoPlay')"
        :description="t('settings.playback.autoPlayDesc')"
        mode="direct"
      >
        <n-switch v-model:value="setData.autoPlay">
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>

      <setting-item
        :title="t('settings.playback.autoMatchNetease')"
        :description="t('settings.playback.autoMatchNeteaseDesc')"
        mode="direct"
      >
        <n-switch v-model:value="setData.autoMatchNetease">
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>

    </setting-section>

    <setting-section title="智能过渡">
      <setting-item title="智能过渡" description="在歌曲尾部衔接下一首，减少切歌停顿">
        <smart-mix-settings />
      </setting-item>
    </setting-section>

    <!-- 后台保活（原独立分区,并入播放设置） -->
    <keep-alive-tab />

  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';

import IosAudioProtectionSettings from '@/components/settings/IosAudioProtectionSettings.vue';
import SmartMixSettings from '@/components/settings/SmartMixSettings.vue';


import { SETTINGS_DATA_KEY } from '../keys';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';
import SSelect from '../SSelect.vue';
import KeepAliveTab from './KeepAliveTab.vue';

const { t } = useI18n();
const setData = inject(SETTINGS_DATA_KEY)!;
const qualityOptions = computed(() => [
  { label: t('settings.playback.qualityOptions.standard'), value: 'standard' },
  { label: t('settings.playback.qualityOptions.higher'), value: 'higher' },
  { label: t('settings.playback.qualityOptions.exhigh'), value: 'exhigh' },
  { label: t('settings.playback.qualityOptions.lossless'), value: 'lossless' },
  { label: t('settings.playback.qualityOptions.hires'), value: 'hires' },
  { label: t('settings.playback.qualityOptions.jyeffect'), value: 'jyeffect' },
  { label: t('settings.playback.qualityOptions.sky'), value: 'sky' },
  { label: t('settings.playback.qualityOptions.dolby'), value: 'dolby' },
  { label: t('settings.playback.qualityOptions.jymaster'), value: 'jymaster' }
]);
</script>
