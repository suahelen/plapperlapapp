<script setup lang="ts">
import { languageName } from '@/i18n'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { deleteSet, listSets } from '@/api/vocabulary'
import { errorMessage } from '@/api/client'
import type { VocabularySet } from '@/models'
import ConfirmButton from '@/components/ConfirmButton.vue'
const { t } = useI18n()

const sets = ref<VocabularySet[] | null>(null)
const error = ref('')

async function load() {
  try {
    sets.value = await listSets()
  } catch (e) {
    error.value = errorMessage(e)
  }
}

async function remove(set: VocabularySet) {
  try {
    await deleteSet(set.id)
    sets.value = sets.value!.filter((s) => s.id !== set.id)
  } catch (e) {
    error.value = errorMessage(e)
  }
}

onMounted(load)

// Own lists first, then lists colleagues shared with me.
const groups = computed(() => [
  { key: 'mine', title: t('share.mine'), items: (sets.value ?? []).filter((s) => s.role === 'owner') },
  { key: 'shared', title: t('share.sharedWithMe'), items: (sets.value ?? []).filter((s) => s.role !== 'owner') },
])
</script>

<template>
  <main class="container stack">
    <div class="row">
      <h1 style="margin: 0">{{ t('nav.vocabulary') }}</h1>
      <div class="spacer" />
      <RouterLink to="/vocabulary/new" class="btn">📄 {{ t('vocab.importFromFile') }}</RouterLink>
      <RouterLink to="/vocabulary/new" class="btn btn-primary">+ {{ t('vocab.new') }}</RouterLink>
    </div>

    <div v-if="error" class="alert">{{ error }}</div>

    <p v-if="sets === null" class="muted">{{ t('common.loading') }}</p>
    <div v-else-if="sets.length === 0" class="card empty">
      <div class="empty-icon" aria-hidden="true">📚</div>
      <h2>{{ t('vocab.emptyTitle') }}</h2>
      <p class="muted">{{ t('vocab.emptyText') }}</p>
      <RouterLink to="/vocabulary/new" class="btn btn-primary">{{ t('vocab.createFirst') }}</RouterLink>
    </div>

    <template v-else>
      <template v-for="group in groups" :key="group.key">
        <h2 v-if="group.items.length && groups[1].items.length" class="group-title">{{ group.title }}</h2>
        <ul v-if="group.items.length" class="list">
          <li v-for="set in group.items" :key="set.id" class="card item">
            <RouterLink :to="`/vocabulary/${set.id}`" class="item-main">
              <div class="row" style="gap: 8px">
                <strong>{{ set.title }}</strong>
                <span v-if="set.role !== 'owner'" class="badge">
                  {{ set.role === 'editor' ? t('share.editor') : t('share.viewer') }} · {{ set.ownerEmail }}
                </span>
              </div>
              <span class="muted">
                <template v-if="set.sourceLanguage || set.targetLanguage">
                  {{ languageName(set.sourceLanguage) || '?' }} → {{ languageName(set.targetLanguage) || '?' }} ·
                </template>
                {{ t('vocab.entries', { n: set.itemCount }, set.itemCount) }}
              </span>
            </RouterLink>
            <ConfirmButton
              v-if="set.role === 'owner'"
              :label="t('common.delete')"
              :confirm-label="t('common.reallyDelete')"
              @confirm="remove(set)"
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
  gap: 12px;
  padding: 14px 16px;
}
.item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  color: inherit;
  text-decoration: none;
  min-width: 0;
}
.item-main strong {
  font-size: 1.05rem;
}
.item:hover {
  border-color: var(--accent);
}
.empty {
  text-align: center;
  padding: 40px 20px;
}
.empty-icon {
  font-size: 2.5rem;
}
</style>
