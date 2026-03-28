<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowDown,
  Connection,
  FolderOpened,
  List,
  Menu,
  Monitor,
  Setting,
  Tickets,
  UserFilled
} from '@element-plus/icons-vue'
import type { SystemPaths } from '@shared/types'
import AdminPlaceholder from '@renderer/components/AdminPlaceholder.vue'
import mospaceLogo from '@renderer/assets/mospace-logo.svg'
import Dashboard from '@renderer/views/Dashboard.vue'
import GroupsView from '@renderer/views/GroupsView.vue'
import Settings from '@renderer/views/Settings.vue'

type ViewName = 'browser-list' | 'browser-groups' | 'plugins' | 'proxies' | 'api' | 'settings'

const activeView = ref<ViewName>('browser-list')
const platform = ref<string>('')
const version = ref<string>('')
const systemPaths = ref<SystemPaths | null>(null)

const isBrowserView = computed(
  () => activeView.value === 'browser-list' || activeView.value === 'browser-groups'
)

const pageMeta = computed(() => {
  switch (activeView.value) {
    case 'browser-groups':
      return {
        section: '浏览器',
        page: '分组管理',
        description: '按分组整理工作空间与环境配置。'
      }
    case 'plugins':
      return {
        section: '插件管理',
        page: '插件中心',
        description: '扩展浏览器能力的模块入口。'
      }
    case 'proxies':
      return {
        section: '代理管理',
        page: '线路列表',
        description: '维护 HTTP / HTTPS / SOCKS5 代理线路。'
      }
    case 'api':
      return {
        section: 'API 列表',
        page: '接口管理',
        description: '统一查看自动化接入能力。'
      }
    case 'settings':
      return {
        section: '系统',
        page: '设置',
        description: '配置浏览器路径与本地工作目录。'
      }
    default:
      return {
        section: '浏览器',
        page: '列表',
        description: '管理本地浏览器工作空间、指纹与启动状态。'
      }
  }
})

async function loadSystemContext(): Promise<void> {
  const [platformResult, versionResult, pathsResult] = await Promise.all([
    window.api.system.getPlatform(),
    window.api.system.getVersion(),
    window.api.system.getPaths()
  ])

  if (platformResult.success) {
    platform.value = platformResult.data
  }

  if (versionResult.success) {
    version.value = versionResult.data
  }

  if (pathsResult.success) {
    systemPaths.value = pathsResult.data
  }
}

onMounted(async () => {
  await loadSystemContext()
})
</script>

<template>
  <div class="app-admin">
    <aside class="app-sidebar">
      <div class="app-sidebar__brand">
        <div class="app-sidebar__logo-wrap">
          <img :src="mospaceLogo" alt="MospaceBrowser logo" class="app-sidebar__logo-image" />
        </div>
        <div>
          <strong>MospaceBrowser</strong>
          <p>Mospace workspace console</p>
        </div>
      </div>

      <nav class="app-sidebar__nav">
        <button
          class="app-sidebar__section"
          :class="{ 'is-current': isBrowserView }"
          @click="activeView = 'browser-list'"
        >
          <span class="app-sidebar__section-main">
            <el-icon><Monitor /></el-icon>
            <span>浏览器</span>
          </span>
          <span class="app-sidebar__chevron">⌃</span>
        </button>

        <div class="app-sidebar__subnav">
          <button
            class="app-sidebar__item app-sidebar__item--sub"
            :class="{ 'is-active': activeView === 'browser-list' }"
            @click="activeView = 'browser-list'"
          >
            <el-icon><List /></el-icon>
            <span>列表</span>
          </button>

          <button
            class="app-sidebar__item app-sidebar__item--sub"
            :class="{ 'is-active': activeView === 'browser-groups' }"
            @click="activeView = 'browser-groups'"
          >
            <el-icon><FolderOpened /></el-icon>
            <span>分组管理</span>
          </button>
        </div>

        <button
          class="app-sidebar__item"
          :class="{ 'is-active': activeView === 'plugins' }"
          @click="activeView = 'plugins'"
        >
          <el-icon><Connection /></el-icon>
          <span>插件管理</span>
        </button>

        <button
          class="app-sidebar__item"
          :class="{ 'is-active': activeView === 'proxies' }"
          @click="activeView = 'proxies'"
        >
          <el-icon><Setting /></el-icon>
          <span>代理管理</span>
        </button>

        <button
          class="app-sidebar__item"
          :class="{ 'is-active': activeView === 'api' }"
          @click="activeView = 'api'"
        >
          <el-icon><Tickets /></el-icon>
          <span>API 列表</span>
          <em>new</em>
        </button>
      </nav>

      <div class="app-sidebar__promo">
        <div class="promo-qr">
          <div class="promo-qr__badge">工</div>
        </div>
        <div class="promo-copy">
          <strong>MospaceBrowser 技术交流群</strong>
          <span>群号：564142956</span>
        </div>
        <div class="promo-meta">QQ Group: 564142956</div>
      </div>
    </aside>

    <section class="app-main">
      <header class="admin-topbar">
        <div class="admin-topbar__left">
          <button class="admin-topbar__menu" type="button" aria-label="Open menu">
            <el-icon><Menu /></el-icon>
          </button>

          <div>
            <div class="admin-topbar__breadcrumb">
              <span>{{ pageMeta.section }}</span>
              <span class="admin-topbar__divider">/</span>
              <span class="is-muted">{{ pageMeta.page }}</span>
            </div>
            <p class="admin-topbar__caption">{{ pageMeta.description }}</p>
          </div>
        </div>

        <div class="admin-topbar__right">
          <button class="admin-topbar__tool" type="button">A文</button>
          <button class="admin-topbar__link" type="button">检查更新</button>
          <button class="admin-topbar__link admin-topbar__link--accent" type="button">
            会员中心
          </button>
          <div class="admin-topbar__user">
            <el-icon><UserFilled /></el-icon>
            <span>2978632701@qq.com</span>
            <el-icon><ArrowDown /></el-icon>
          </div>
        </div>
      </header>

      <main class="admin-content">
        <dashboard v-if="activeView === 'browser-list'" @open-settings="activeView = 'settings'" />

        <settings
          v-else-if="activeView === 'settings'"
          :system-paths="systemPaths"
          @back="activeView = 'browser-list'"
        />

        <groups-view v-else-if="activeView === 'browser-groups'" />

        <admin-placeholder
          v-else-if="false"
          :icon="FolderOpened"
          eyebrow="浏览器"
          title="分组管理"
          description="这里预留了分组管理页位，你后续可以继续扩展分组 CRUD、批量移动和分组维度统计。当前主列表已经可以先正常完成创建、编辑、启动和验证。"
        />

        <admin-placeholder
          v-else-if="activeView === 'plugins'"
          :icon="Connection"
          eyebrow="插件管理"
          title="插件中心"
          description="插件管理页现在先用一致的后台框架占位，方便后续把浏览器扩展、脚本注入和插件开关接进来。"
        />

        <admin-placeholder
          v-else-if="activeView === 'proxies'"
          :icon="Setting"
          eyebrow="代理管理"
          title="代理线路"
          description="代理页骨架已经准备好，后面接入代理池、连通性检测和分组绑定时可以直接沿用这一套视觉。"
        />

        <admin-placeholder
          v-else
          :icon="Tickets"
          eyebrow="API 列表"
          title="接口能力"
          description="API 列表页保持和主界面统一的管理后台风格，后续可用于展示自动化调用能力、密钥或任务日志。"
        />
      </main>

      <footer class="admin-footer">
        <span>本地平台：{{ platform || 'Windows' }}</span>
        <span>版本：v{{ version || '0.1.0' }}</span>
      </footer>
    </section>
  </div>
</template>
