<template>
  <div class="sprint-page page-shell">
    <div class="page-header">
      <div>
        <h1>Sprint Planning</h1>
        <p class="page-sub">{{ isActive ? 'Your tickets in the current sprint.' : 'Choose the tickets for the next sprint and check them against the points available.' }}</p>
      </div>
      <div class="header-actions">
        <button v-if="state.boardId" class="btn" type="button" @click="openBoard">Open sprint board ↗</button>
        <button class="btn" type="button" :disabled="busy || refreshing" :title="refreshedLabel" @click="refresh()">{{ refreshing ? 'Refreshing…' : '↻ Refresh from Jira' }}</button>
        <button v-if="isActive" class="btn" type="button" :disabled="busy" @click="confirmFinish = true">Finish sprint</button>
        <button v-else class="btn btn-primary" type="button" :disabled="busy || !tickets.length" @click="confirmStart = true">Start sprint</button>
      </div>
    </div>

    <div class="page-body sprint-body">
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <p v-if="refreshedLabel" class="muted refreshed" role="status">{{ refreshedLabel }}</p>

      <div v-if="confirmStart" class="notice confirm" role="alertdialog" aria-label="Start the sprint">
        <p>Start the sprint with {{ summary.tickets }} ticket{{ summary.tickets === 1 ? '' : 's' }} and {{ summary.planned }} points planned<template v-if="summary.capacity != null"> of {{ summary.capacity }} available</template>? You can still add or remove tickets after it starts.</p>
        <div class="confirm-actions">
          <button class="btn btn-primary" type="button" :disabled="busy" @click="doStart">Start sprint</button>
          <button class="btn" type="button" @click="confirmStart = false">Keep planning</button>
        </div>
      </div>
      <div v-if="confirmFinish" class="notice confirm" role="alertdialog" aria-label="Finish the sprint">
        <p>Finish the sprint? Done tickets leave the list, and unfinished tickets carry over into the next plan.</p>
        <div class="confirm-actions">
          <button class="btn btn-primary" type="button" :disabled="busy" @click="doFinish">Finish sprint</button>
          <button class="btn" type="button" @click="confirmFinish = false">Cancel</button>
        </div>
      </div>

      <!-- Points against what is available -->
      <section class="card points-card" aria-label="Story points">
        <div class="points-figures">
          <div v-if="!isActive"><strong>{{ summary.planned }}</strong><span>planned</span></div>
          <div v-if="!isActive && summary.capacity != null"><strong :class="{ over: summary.overCapacity }">{{ summary.remaining }}</strong><span>{{ summary.overCapacity ? 'over capacity' : 'remaining' }}</span></div>
          <template v-if="isActive">
            <div><strong>{{ summary.done }}</strong><span>done</span></div>
            <div><strong>{{ summary.inProgress }}</strong><span>in progress</span></div>
            <div><strong>{{ summary.todo }}</strong><span>to do</span></div>
            <div><strong>{{ summary.planned }}</strong><span>planned{{ summary.capacity != null ? ` of ${summary.capacity}` : '' }}</span></div>
          </template>
        </div>
        <div
          v-if="barMax > 0"
          class="bar"
          role="progressbar"
          :aria-valuenow="isActive ? summary.done : summary.planned"
          aria-valuemin="0"
          :aria-valuemax="barMax"
          :aria-label="isActive ? 'Story points done' : 'Story points planned against available'"
        >
          <template v-if="isActive">
            <span class="seg seg-done" :style="{ width: pct(summary.done) }" />
            <span class="seg seg-progress" :style="{ width: pct(summary.inProgress) }" />
          </template>
          <span v-else class="seg" :class="summary.overCapacity ? 'seg-over' : 'seg-done'" :style="{ width: pct(summary.planned) }" />
        </div>
        <p v-if="summary.unestimated" class="muted">{{ summary.unestimated }} ticket{{ summary.unestimated === 1 ? ' has' : 's have' }} no story points, so they are not in the total. Enter points on the ticket to include them.</p>
        <div class="settings-row">
          <label>
            <span>Points available</span>
            <input v-model="capacityText" type="number" min="0" step="0.5" inputmode="decimal" @change="saveCapacity">
          </label>
        </div>
        <div class="settings-row">
          <label class="wide">
            <span>Jira sprint board (number or board link)</span>
            <input v-model="boardText" type="text" placeholder="e.g. 166 or https://your-site.atlassian.net/jira/people/…/boards/166" @change="saveBoard">
          </label>
        </div>
      </section>

      <!-- Adding tickets -->
      <section class="card" aria-label="Add tickets">
        <form class="search-row" @submit.prevent="runSearch">
          <label class="grow">
            <span>Find tickets to add</span>
            <input v-model="query" type="search" placeholder="Ticket key or words from the summary. Leave empty for your open tickets">
          </label>
          <button class="btn" type="submit" :disabled="searching">{{ searching ? 'Searching…' : 'Search' }}</button>
        </form>
        <ul v-if="results.length" class="results">
          <li v-for="result in results" :key="result.key">
            <div class="ticket-main">
              <strong>{{ result.key }}</strong> <span>{{ result.summary }}</span>
              <span class="muted"> · {{ result.status }} · {{ result.points ?? '–' }} pts</span>
            </div>
            <button class="btn" type="button" :disabled="result.planned || busy" @click="add(result.key)">{{ result.planned ? 'Added' : 'Add' }}</button>
          </li>
        </ul>
        <p v-else-if="searched && !searching" class="muted">No open tickets matched.</p>
      </section>

      <!-- Planning: the list -->
      <section v-if="!isActive" aria-label="Planned tickets">
        <h2>Planned for next sprint <span class="muted">({{ tickets.length }})</span></h2>
        <p v-if="!tickets.length && !loading" class="empty">No tickets yet. Search above and add the ones you plan to take on.</p>
        <ul class="planned">
          <li v-for="ticket in tickets" :key="ticket.key" class="card planned-item">
            <div class="planned-row">
              <div class="ticket-main">
                <strong>{{ ticket.key }}</strong> <span>{{ ticket.summary }}</span>
                <span class="muted"> · {{ ticket.status }}</span>
              </div>
              <label class="points-input">
                <span class="visually-hidden">Story points for {{ ticket.key }}</span>
                <input type="number" min="0" step="0.5" inputmode="decimal" :value="ticket.points ?? ''" placeholder="pts" @change="onPoints(ticket.key, $event)">
              </label>
              <button class="btn" type="button" :aria-expanded="openNotes === ticket.key" @click="toggleNotes(ticket.key)">
                Notes<template v-if="ticket.noteCount"> ({{ ticket.noteCount }})</template>
              </button>
              <button class="btn" type="button" :disabled="busy" :aria-label="`Remove ${ticket.key} from the plan`" @click="remove(ticket.key)">Remove</button>
            </div>
            <SprintTicketNotes v-if="openNotes === ticket.key" :ticket-key="ticket.key" :note-count="ticket.noteCount" :load="loadNotes" :add="addNote" />
          </li>
        </ul>
      </section>

      <!-- Active: progress, limited to the user's own tickets -->
      <section v-else class="board" aria-label="Sprint progress">
        <div v-for="column in columns" :key="column.name" class="column">
          <h2>{{ column.name }} <span class="muted">({{ column.tickets.length }})</span></h2>
          <p v-if="!column.tickets.length" class="muted">Nothing here.</p>
          <article v-for="ticket in column.tickets" :key="ticket.key" class="card ticket-card">
            <div><strong>{{ ticket.key }}</strong> <span class="muted">{{ ticket.points ?? '–' }} pts</span></div>
            <p>{{ ticket.summary }}</p>
            <div class="ticket-foot">
              <span class="muted">{{ ticket.status }}</span>
              <span class="foot-actions">
                <button class="link" type="button" :aria-expanded="openNotes === ticket.key" @click="toggleNotes(ticket.key)">
                  Notes<template v-if="ticket.noteCount"> ({{ ticket.noteCount }})</template>
                </button>
                <button class="link" type="button" :disabled="busy" :aria-label="`Remove ${ticket.key} from the sprint`" @click="remove(ticket.key)">Remove</button>
              </span>
            </div>
            <SprintTicketNotes v-if="openNotes === ticket.key" :ticket-key="ticket.key" :note-count="ticket.noteCount" :load="loadNotes" :add="addNote" />
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import SprintTicketNotes from './components/SprintTicketNotes.vue'
import { useSprintPlan } from './composables/useSprintPlan'

const {
  state, tickets, summary, loading, busy, error, results, searching, searched, columns, refreshing, refreshedAt,
  load, loadBoardColumns, search, add, remove, setPoints, setCapacity, setBoard, refresh, start, finish, openBoard, loadNotes, addNote
} = useSprintPlan()

const query = ref('')
const capacityText = ref('')
const boardText = ref('')
const openNotes = ref<string | null>(null)
const confirmStart = ref(false)
const confirmFinish = ref(false)

const isActive = computed(() => state.value.phase === 'active')
// The bar fills against the points available, or the total when none is set.
const barMax = computed(() => Math.max(summary.value.capacity ?? 0, summary.value.planned))
const pct = (points: number) => `${barMax.value ? Math.min(100, (points / barMax.value) * 100) : 0}%`

watch(state, value => {
  capacityText.value = value.capacity == null ? '' : String(value.capacity)
  boardText.value = value.boardUrl || value.boardId
}, { immediate: true })

const runSearch = () => search(query.value.trim())
const toggleNotes = (key: string) => { openNotes.value = openNotes.value === key ? null : key }

const saveCapacity = () => {
  const text = capacityText.value.trim()
  return setCapacity(text === '' ? null : Number(text))
}
const saveBoard = () => setBoard(boardText.value.trim())

const onPoints = (key: string, event: Event) => {
  const text = (event.target as HTMLInputElement).value.trim()
  return setPoints(key, text === '' ? null : Number(text))
}

const doStart = async () => {
  if (await start()) confirmStart.value = false
}
const doFinish = async () => {
  if (await finish()) {
    confirmFinish.value = false
    openNotes.value = null
  }
}

const refreshedLabel = computed(() =>
  refreshedAt.value ? `Ticket details refreshed from Jira at ${refreshedAt.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''
)

// Open with what is saved, then bring the tickets up to date from Jira.
// The board's columns matter only while the sprint runs, and when the board changes.
watch(() => `${state.value.phase}|${state.value.boardId}`, () => { if (isActive.value) void loadBoardColumns() })

onMounted(async () => {
  await load()
  if (tickets.value.length) await refresh(true)
})
</script>

<style scoped>
/* The screen-reader-only labels are absolutely positioned. Without a positioned
   ancestor they are placed against the whole document, which stretches it past
   the window so the page itself scrolls instead of the content area. */
.sprint-page { position: relative; }
.page-sub { margin: .35rem 0 0; color: var(--color-text-muted); }
.header-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.sprint-body { display: flex; flex-direction: column; gap: var(--space-lg); }
.btn { padding: .55rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-control); color: var(--color-text); cursor: pointer; }
.btn:disabled { opacity: .55; cursor: default; }
.btn-primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent, #fff); }
.notice { margin: 0; padding: .85rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow-wrap: anywhere; }
.notice.error { color: var(--color-danger); border-color: var(--color-danger); }
.notice.confirm p { margin: 0 0 .75rem; }
.confirm-actions { display: flex; gap: .5rem; }
.card { padding: 1rem 1.25rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-raised); }
.muted { color: var(--color-text-muted); }
p.refreshed { margin: 0; font-size: .85rem; }
p.muted { margin: .5rem 0 0; }
h2 { font-size: 1.05rem; margin: 0 0 .75rem; }
.points-figures { display: flex; flex-wrap: wrap; gap: 2rem; margin-bottom: .75rem; }
.points-figures div { display: flex; flex-direction: column; }
.points-figures strong { font-size: 1.7rem; line-height: 1.1; }
.points-figures strong.over { color: var(--color-danger); }
.points-figures span { color: var(--color-text-muted); font-size: .85rem; }
.bar { display: flex; height: .6rem; border-radius: 999px; background: var(--color-control); overflow: hidden; }
.seg { display: block; height: 100%; }
.seg-done { background: var(--color-success); }
.seg-progress { background: var(--color-accent); }
.seg-over { background: var(--color-danger); }
.settings-row { margin-top: 1rem; }
label { display: flex; flex-direction: column; gap: .35rem; color: var(--color-text-muted); font-size: .9rem; }
input[type="number"], input[type="text"], input[type="search"] { padding: .55rem .7rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); font: inherit; min-width: 0; box-sizing: border-box; }
label.wide input, .search-row .grow input { width: 100%; }
.search-row { display: flex; flex-wrap: wrap; align-items: end; gap: .75rem; }
.search-row .grow { flex: 1 1 18rem; }
.results, .planned { list-style: none; margin: 1rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
.results li { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .5rem 0; border-top: 1px solid var(--color-border); }
.ticket-main { min-width: 0; overflow-wrap: anywhere; }
.planned { margin-top: 0; }
.planned-item { padding: 0; }
.planned-row { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; padding: .85rem 1.25rem; }
.planned-row .ticket-main { flex: 1 1 16rem; }
.points-input input { width: 5rem; }
.empty { padding: 1.5rem; text-align: center; border: 1px dashed var(--color-border); border-radius: var(--radius-md); color: var(--color-text-muted); }
/* As many columns as fit; the rest wrap onto a new row. */
.board { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: var(--space-md); align-items: start; }
.column { display: flex; flex-direction: column; gap: .75rem; padding: .75rem; border-radius: var(--radius-md); background: var(--color-surface); }
.ticket-card p { margin: .4rem 0; overflow-wrap: anywhere; }
.ticket-card { padding-bottom: 0; }
.ticket-foot { display: flex; justify-content: space-between; align-items: center; padding-bottom: .75rem; font-size: .85rem; }
.foot-actions { display: flex; gap: 1rem; }
.link { background: none; border: 0; color: var(--color-accent); cursor: pointer; padding: 0; font: inherit; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
