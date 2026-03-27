<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  eyebrow: string
  title: string
  description: string
  icon: Component
}>()
</script>

<template>
  <section class="placeholder-page">
    <div class="placeholder-card">
      <div class="placeholder-card__icon">
        <el-icon>
          <component :is="icon" />
        </el-icon>
      </div>

      <p class="placeholder-card__eyebrow">{{ eyebrow }}</p>
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>

      <div class="placeholder-card__grid">
        <div>
          <span>视觉状态</span>
          <strong>已接入新后台布局</strong>
        </div>
        <div>
          <span>后续建议</span>
          <strong>继续补数据 CRUD</strong>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.placeholder-page {
  min-height: 100%;
}

.placeholder-card {
  display: grid;
  gap: 18px;
  max-width: 860px;
  padding: 40px;
  border: 1px solid var(--border-color);
  border-radius: 18px;
  background: #ffffff;
  box-shadow: var(--panel-shadow);
}

.placeholder-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgba(110, 98, 239, 0.12);
  color: var(--accent-color);
  font-size: 28px;
}

.placeholder-card__eyebrow {
  margin: 0;
  color: var(--accent-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.placeholder-card h2 {
  margin: 0;
  font-size: 32px;
  color: var(--text-primary);
}

.placeholder-card p {
  margin: 0;
  max-width: 720px;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.8;
}

.placeholder-card__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 8px;
}

.placeholder-card__grid div {
  display: grid;
  gap: 8px;
  padding: 18px 20px;
  border-radius: 16px;
  background: #f7f8fc;
}

.placeholder-card__grid span {
  color: var(--text-secondary);
  font-size: 13px;
}

.placeholder-card__grid strong {
  font-size: 16px;
  color: var(--text-primary);
}

@media (max-width: 900px) {
  .placeholder-card {
    padding: 24px;
  }

  .placeholder-card__grid {
    grid-template-columns: 1fr;
  }
}
</style>
