<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { errorMessage } from '@/api/client'
import { listShares, putShare, removeShare, type ShareTarget } from '@/api/shares'
import type { Share } from '@/models'

// Owner-only panel: share a word list or activity with colleagues (by email) and
// give them view or edit rights.
const props = defineProps<{ target: ShareTarget; id: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const shares = ref<Share[]>([])
const email = ref('')
const role = ref<Share['role']>('viewer')
const busy = ref(false)
const error = ref('')

async function run(fn: () => Promise<void>) {
  error.value = ''
  busy.value = true
  try {
    await fn()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

const reload = async () => {
  shares.value = await listShares(props.target, props.id)
}

onMounted(() => run(reload))

function add() {
  if (!email.value.trim()) return
  return run(async () => {
    await putShare(props.target, props.id, email.value.trim(), role.value)
    email.value = ''
    await reload()
  })
}

const change = (s: Share, next: Share['role']) =>
  run(async () => {
    await putShare(props.target, props.id, s.email, next)
    await reload()
  })

const remove = (s: Share) =>
  run(async () => {
    await removeShare(props.target, props.id, s.userId)
    await reload()
  })
</script>

<template>
  <section class="card stack share" role="dialog" :aria-label="t('share.title')">
    <div class="row">
      <h2 style="margin: 0">{{ t('share.title') }}</h2>
      <div class="spacer" />
      <button class="btn btn-ghost btn-icon" type="button" :aria-label="t('common.close')" @click="emit('close')">✕</button>
    </div>
    <p class="muted" style="margin: 0">
      {{ target === 'activities' ? t('share.introActivity') : t('share.introList') }}
    </p>

    <form class="row add" @submit.prevent="add">
      <input
        v-model="email"
        class="input"
        type="email"
        :placeholder="t('share.emailPlaceholder')"
        :aria-label="t('auth.email')"
        autocomplete="off"
      />
      <select v-model="role" :aria-label="t('share.role')">
        <option value="viewer">{{ t('share.viewer') }}</option>
        <option value="editor">{{ t('share.editor') }}</option>
      </select>
      <button class="btn btn-primary" type="submit" :disabled="busy || !email.trim()">{{ t('share.add') }}</button>
    </form>

    <div v-if="error" class="alert" role="alert">{{ error }}</div>

    <p v-if="shares.length === 0" class="muted" style="margin: 0">{{ t('share.none') }}</p>
    <ul v-else class="people">
      <li v-for="s in shares" :key="s.userId">
        <span class="email">{{ s.email }}</span>
        <select :value="s.role" :aria-label="t('share.role')" :disabled="busy" @change="change(s, ($event.target as HTMLSelectElement).value as Share['role'])">
          <option value="viewer">{{ t('share.viewer') }}</option>
          <option value="editor">{{ t('share.editor') }}</option>
        </select>
        <button class="btn btn-ghost btn-danger" type="button" :disabled="busy" @click="remove(s)">{{ t('share.remove') }}</button>
      </li>
    </ul>
    <p class="muted small" style="margin: 0">{{ t('share.rightsHelp') }}</p>
  </section>
</template>

<style scoped>
.share {
  border-color: var(--accent);
}
.add .input {
  flex: 1;
  min-width: 200px;
}
select {
  font: inherit;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--surface-bright);
  color: var(--ink);
}
.people {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.people li {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
.email {
  flex: 1;
  min-width: 160px;
  word-break: break-all;
}
.small {
  font-size: 0.85rem;
}
</style>
