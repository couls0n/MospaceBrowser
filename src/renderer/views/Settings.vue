<script setup lang="ts">
import { Folder } from '@element-plus/icons-vue'
import type { SystemPaths } from '@shared/types'

defineProps<{
  browserPath: string
  systemPaths: SystemPaths | null
}>()
</script>

<template>
  <section class="settings-view">
    <div class="settings-card">
      <p class="eyebrow">Browser Runtime</p>
      <h2>Chromium executable</h2>
      <p class="settings-muted">{{ browserPath }}</p>
    </div>

    <div class="settings-card">
      <p class="eyebrow">Storage Paths</p>
      <h2>Local app data</h2>

      <div class="settings-paths">
        <div class="settings-path-row">
          <el-icon><Folder /></el-icon>
          <span>{{ systemPaths?.userData || 'Loading...' }}</span>
        </div>
        <div class="settings-path-row">
          <el-icon><Folder /></el-icon>
          <span>{{ systemPaths?.profiles || 'Loading...' }}</span>
        </div>
        <div class="settings-path-row">
          <el-icon><Folder /></el-icon>
          <span>{{ systemPaths?.database || 'Loading...' }}</span>
        </div>
        <div class="settings-path-row">
          <el-icon><Folder /></el-icon>
          <span>{{ systemPaths?.logs || 'Loading...' }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
