<script setup lang="ts">
const props = defineProps<{
  isRunning: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  start: []
  stop: []
}>()

function handleClick(): void {
  if (props.isRunning) {
    emit('stop')
    return
  }

  emit('start')
}
</script>

<template>
  <el-button
    :type="isRunning ? 'danger' : 'primary'"
    :loading="busy"
    @click="handleClick"
  >
    {{ isRunning ? 'Stop Browser' : 'Start Browser' }}
  </el-button>
</template>
