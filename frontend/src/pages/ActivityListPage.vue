<script setup lang="ts">
import { gameName } from '@/games/i18n'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { deleteActivity, listActivities } from '@/api/activities'
import { errorMessage } from '@/api/client'
import type { Activity } from '@/models'
import { getGame } from '@/games/registry'
import ConfirmButton from '@/components/ConfirmButton.vue'
const { t } = useI18n()

const activities = ref<Activity[] | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    activities.value = await listActivities()
  } catch (e) {
    error.value = errorMessage(e)
  }
})

async function remove(a: Activity) {
  try {
    await deleteActivity(a.id)
    activities.value = activities.value!.filter((x) => x.id !== a.id)
  } catch (e) {
    error.value = errorMessage(e)
  }
}

// Own activities first, then activities colleagues shared with me.
const groups = computed(() => [
  { key: 'mine', title: t('share.mine'), items: (activities.value ?? []).filter((a) => a.role === 'owner') },
  { key: 'shared', title: t('share.sharedWithMe'), items: (activities.value ?? []).filter((a) => a.role !== 'owner') },
])
</script>

<template>
  <main class="container stack">
    <div class="row">
      <h1 style="margin: 0">{{ t('nav.activities') }}</h1>
      <div class="spacer" />
      <RouterLink to="/activities/new" class="btn btn-primary">+ {{ t('activity.new') }}</RouterLink>
    </div>

    <div v-if="error" class="alert">{{ error }}</div>

    <p v-if="activities === null" class="muted">{{ t('common.loading') }}</p>
    <div v-else-if="activities.length === 0" class="card empty">
      <div class="empty-icon" aria-hidden="true">🎲</div>
      <h2>{{ t('activity.emptyTitle') }}</h2>
      <p class="muted">{{ t('activity.emptyText') }}</p>
      <div class="row" style="justify-content: center">
        <RouterLink to="/vocabulary" class="btn">{{ t('activity.vocabFirst') }}</RouterLink>
        <RouterLink to="/activities/new" class="btn btn-primary">{{ t('activity.create') }}</RouterLink>
      </div>
    </div>

    <template v-else>
    <template v-for="group in groups" :key="group.key">
    <h2 v-if="group.items.length && groups[1].items.length" class="group-title">{{ group.title }}</h2>
    <ul v-if="group.items.length" class="list">
      <li v-for="a in group.items" :key="a.id" class="card item">
        <RouterLink :to="`/activities/${a.id}`" class="item-main">
          <div class="row" style="gap: 8px">
            <strong>{{ a.title }}</strong>
            <span v-if="a.published" class="badge badge-good">{{ t('activity.published') }}</span>
            <span v-else class="badge">{{ t('activity.draft') }}</span>
            <span v-if="a.role !== 'owner'" class="badge">
              {{ a.role === 'editor' ? t('share.editor') : t('share.viewer') }} · {{ a.ownerEmail }}
            </span>
          </div>
          <span class="games">
            <span v-for="g in a.games" :key="g.type" class="game-tag">
              {{ getGame(g.type)?.icon ?? '🎮' }} {{ getGame(g.type) ? gameName(getGame(g.type)!) : g.type }}
            </span>
          </span>
        </RouterLink>
        <RouterLink v-if="a.published" :to="`/play/${a.publicId}`" class="btn btn-ghost" target="_blank">{{ t('activity.open') }} ↗</RouterLink>
        <ConfirmButton
          v-if="a.role === 'owner'"
          :label="t('common.delete')"
          :confirm-label="t('common.reallyDelete')"
          @confirm="remove(a)"
        />
      </li>
    </ul>
    </template>
    </template>
  </main>
</template>

<style scoped>
.group-title {
  margin: 8px 0 0;
  font-size: 1rem;
  color: var(--muted);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 14px 16px;
}
.item:hover {
  border-color: var(--accent);
}
.item-main {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: inherit;
  text-decoration: none;
}
.item-main strong {
  font-size: 1.05rem;
}
.games {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.game-tag {
  font-size: 0.85rem;
  color: var(--muted);
}
.empty {
  text-align: center;
  padding: 40px 20px;
}
.empty-icon {
  font-size: 2.5rem;
}
</style>
