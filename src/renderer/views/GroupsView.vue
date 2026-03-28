<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CirclePlusFilled, Delete, EditPen, FolderOpened } from '@element-plus/icons-vue'
import { useGroupStore } from '@renderer/stores/groups'
import { useProfileStore } from '@renderer/stores/profiles'

interface GroupFormState {
  id?: string
  name: string
  color: string
}

const profileStore = useProfileStore()
const groupStore = useGroupStore()

const editorVisible = ref(false)
const selectedGroupId = ref<string>('default')

const form = reactive<GroupFormState>({
  name: '',
  color: '#7568f4'
})

const selectedGroup = computed(() => {
  return selectedGroupId.value === 'default' ? null : groupStore.getGroupById(selectedGroupId.value)
})

const totalAssignedProfiles = computed(() => {
  return profileStore.profiles.filter((profile) => Boolean(profile.groupId)).length
})

const ungroupedProfiles = computed(() => {
  return profileStore.profiles.filter((profile) => !profile.groupId)
})

const selectedProfiles = computed(() => {
  if (selectedGroupId.value === 'default') {
    return ungroupedProfiles.value
  }

  return profileStore.profiles.filter((profile) => profile.groupId === selectedGroupId.value)
})

const groupCards = computed(() => {
  return [
    {
      id: 'default',
      name: 'Default Group',
      color: '#cbd5e1',
      profileCount: ungroupedProfiles.value.length
    },
    ...groupStore.groups.map((group) => ({
      ...group,
      profileCount: profileStore.profiles.filter((profile) => profile.groupId === group.id).length
    }))
  ]
})

async function refresh(): Promise<void> {
  await Promise.all([groupStore.loadGroups(), profileStore.loadProfiles()])
}

function openCreateDialog(): void {
  form.id = undefined
  form.name = ''
  form.color = '#7568f4'
  editorVisible.value = true
}

function openEditDialog(groupId: string): void {
  const group = groupStore.getGroupById(groupId)

  if (!group) {
    return
  }

  form.id = group.id
  form.name = group.name
  form.color = group.color
  editorVisible.value = true
}

async function submitGroup(): Promise<void> {
  const name = form.name.trim()

  if (!name) {
    ElMessage.warning('Please enter a group name.')
    return
  }

  const result = form.id
    ? await groupStore.updateGroup({
        id: form.id,
        name,
        color: form.color
      })
    : await groupStore.createGroup({
        name,
        color: form.color
      })

  if (!result) {
    ElMessage.error(groupStore.error || 'Failed to save group.')
    return
  }

  selectedGroupId.value = result.id
  editorVisible.value = false
  await refresh()
  ElMessage.success('Group saved.')
}

async function deleteGroup(groupId: string): Promise<void> {
  const group = groupStore.getGroupById(groupId)

  if (!group) {
    return
  }

  const confirmed = await ElMessageBox.confirm(
    `Delete group "${group.name}"? Browsers in this group will be moved to the default group.`,
    'Delete Group',
    {
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      type: 'warning'
    }
  )
    .then(() => true)
    .catch(() => false)

  if (!confirmed) {
    return
  }

  const deleted = await groupStore.deleteGroup(groupId)

  if (!deleted) {
    ElMessage.error(groupStore.error || 'Failed to delete group.')
    return
  }

  if (selectedGroupId.value === groupId) {
    selectedGroupId.value = 'default'
  }

  await refresh()
  ElMessage.success('Group deleted.')
}

async function moveProfile(profileId: string, nextGroupId: string): Promise<void> {
  const updated = await profileStore.updateProfile({
    id: profileId,
    groupId: nextGroupId || undefined
  })

  if (!updated) {
    ElMessage.error(profileStore.error || 'Failed to move browser.')
    return
  }

  await profileStore.loadProfiles()
}

onMounted(async () => {
  await refresh()
})
</script>

<template>
  <section class="groups-page">
    <div class="page-head">
      <div>
        <p class="page-head__eyebrow">BROWSER GROUPS</p>
        <h2>Group Management</h2>
        <p>Create groups, review browser allocation, and move browsers between groups.</p>
      </div>

      <div class="page-head__stats">
        <div>
          <span>Total Groups</span>
          <strong>{{ groupStore.groups.length }}</strong>
        </div>
        <div>
          <span>Assigned Browsers</span>
          <strong>{{ totalAssignedProfiles }}</strong>
        </div>
        <div>
          <span>Default Group</span>
          <strong>{{ ungroupedProfiles.length }}</strong>
        </div>
      </div>
    </div>

    <div class="groups-layout">
      <div class="panel-card groups-panel">
        <div class="groups-panel__header">
          <div>
            <p class="groups-panel__eyebrow">GROUP LIST</p>
            <h3>Browser Groups</h3>
          </div>

          <el-button type="primary" @click="openCreateDialog">
            <el-icon><CirclePlusFilled /></el-icon>
            <span>New Group</span>
          </el-button>
        </div>

        <div class="group-card-list">
          <button
            v-for="group in groupCards"
            :key="group.id"
            class="group-card"
            :class="{ 'is-active': selectedGroupId === group.id }"
            type="button"
            @click="selectedGroupId = group.id"
          >
            <div class="group-card__main">
              <span class="group-card__dot" :style="{ background: group.color }"></span>
              <div>
                <strong>{{ group.name }}</strong>
                <p>{{ group.profileCount }} browsers</p>
              </div>
            </div>

            <div v-if="group.id !== 'default'" class="group-card__actions">
              <el-button text @click.stop="openEditDialog(group.id)">
                <el-icon><EditPen /></el-icon>
              </el-button>
              <el-button text @click.stop="deleteGroup(group.id)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </button>
        </div>
      </div>

      <div class="panel-card members-panel">
        <div class="members-panel__header">
          <div>
            <p class="groups-panel__eyebrow">BROWSERS</p>
            <h3>{{ selectedGroup?.name || 'Default Group' }}</h3>
          </div>

          <div class="members-panel__meta">
            <el-icon><FolderOpened /></el-icon>
            <span>{{ selectedProfiles.length }} browsers</span>
          </div>
        </div>

        <el-empty v-if="!selectedProfiles.length" description="No browsers in this group yet." />

        <el-table v-else :data="selectedProfiles" border>
          <el-table-column prop="name" label="Browser" min-width="180" />
          <el-table-column label="Notes" min-width="220" show-overflow-tooltip>
            <template #default="scope">
              {{ scope.row.notes || '--' }}
            </template>
          </el-table-column>
          <el-table-column label="Move To" min-width="220">
            <template #default="scope">
              <el-select
                :model-value="scope.row.groupId || 'default'"
                @update:model-value="moveProfile(scope.row.id, $event === 'default' ? '' : String($event))"
              >
                <el-option label="Default Group" value="default" />
                <el-option
                  v-for="group in groupStore.groups"
                  :key="group.id"
                  :label="group.name"
                  :value="group.id"
                />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog
      :model-value="editorVisible"
      :title="form.id ? 'Edit Group' : 'Create Group'"
      width="420px"
      @close="editorVisible = false"
    >
      <el-form label-position="top">
        <el-form-item label="Group Name">
          <el-input v-model="form.name" maxlength="100" placeholder="TikTok US / Work A" />
        </el-form-item>

        <el-form-item label="Color">
          <div class="color-field">
            <el-color-picker v-model="form.color" show-alpha="false" />
            <el-input v-model="form.color" />
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="editorVisible = false">Cancel</el-button>
          <el-button type="primary" :loading="groupStore.saving" @click="submitGroup">
            {{ form.id ? 'Save' : 'Create' }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.groups-page {
  display: grid;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.page-head__eyebrow,
.groups-panel__eyebrow {
  margin: 0 0 8px;
  color: var(--accent-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.page-head h2,
.groups-panel h3,
.members-panel h3 {
  margin: 0;
  font-size: 28px;
  color: var(--text-primary);
}

.page-head p,
.groups-panel p,
.members-panel p {
  margin: 8px 0 0;
  color: var(--text-secondary);
}

.page-head__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(140px, 1fr));
  gap: 12px;
  min-width: 460px;
}

.page-head__stats div {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: #ffffff;
}

.page-head__stats span {
  color: var(--text-secondary);
  font-size: 12px;
}

.page-head__stats strong {
  color: var(--text-primary);
  font-size: 22px;
}

.groups-layout {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 16px;
}

.groups-panel,
.members-panel {
  padding: 18px 20px;
}

.groups-panel__header,
.members-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.group-card-list {
  display: grid;
  gap: 12px;
}

.group-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: #ffffff;
  text-align: left;
  cursor: pointer;
}

.group-card.is-active {
  border-color: var(--accent-color);
  box-shadow: inset 0 0 0 1px rgba(117, 104, 244, 0.18);
}

.group-card__main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.group-card__main strong {
  display: block;
  color: var(--text-primary);
}

.group-card__main p {
  margin: 4px 0 0;
}

.group-card__dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
}

.group-card__actions {
  display: flex;
  align-items: center;
}

.members-panel__meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}

.color-field {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 1180px) {
  .page-head,
  .groups-panel__header,
  .members-panel__header {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-head__stats {
    min-width: 0;
    width: 100%;
  }

  .groups-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .page-head__stats {
    grid-template-columns: 1fr;
  }
}
</style>
