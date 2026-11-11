import { createStore, entries, set, get, clear, setMany } from 'idb-keyval'
import { seedRecords } from './seed'
import { DEFAULT_EVENTS, cleanDetails, cleanEventName, entryId, isShownToday } from './events'

// Demo backend: everything lives in this browser's IndexedDB, seeded with sample photos.
// Each record mirrors one row of the Google Sheet:
// image, event, caption, consent, status, aiCheck, submittedAt, shownUntil.
const db = createStore('south-view-gallery', 'submissions')
const SEEDED_KEY = '__seeded'
const EVENTS_KEY = '__events'
const UNLOCK_KEY = 'south-view-staff-unlocked'

async function ensureSeeded() {
  if (await get(SEEDED_KEY, db)) return
  await setMany([...seedRecords().map((r) => [r.id, r]), [SEEDED_KEY, true]], db)
}

export async function listAll() {
  await ensureSeeded()
  const all = await entries(db)
  return all
    .filter(([key]) => !String(key).startsWith('__'))
    .map(([, record]) => record)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

// Approved photos, plus burial photos still within the day they were shared. Newest first.
export async function listGallery() {
  return (await listAll()).filter((r) => r.status === 'approved' || (r.status === 'pending' && isShownToday(r)))
}

// A burial photo that passes the AI check shows in the gallery until midnight, as in
// submit() in apps-script/Code.gs. The demo uses this browser's midnight, not Atlanta's.
export async function addSubmission(record) {
  await ensureSeeded()
  const entry = (await listEvents()).find((e) => e.id === record.event)
  const now = new Date()
  const shownUntil =
    entry?.type === 'burial' && record.aiCheck && !record.aiCheck.flagged
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
      : ''
  await set(record.id, { ...record, shownUntil }, db)
  return { shownUntil }
}

// Staff review ends a burial photo's day in the gallery, as in apps-script/Code.gs.
export async function setStatus(id, status) {
  const record = await get(id, db)
  if (record) await set(id, { ...record, status, shownUntil: '' }, db)
}

export async function listEvents() {
  const saved = (await get(EVENTS_KEY, db)) ?? DEFAULT_EVENTS.map((e) => ({ ...e, active: true }))
  // Events saved by an older version of the demo have no type.
  return saved.map((e) => ({ type: 'event', details: '', ...e }))
}

// Same rules as the Apps Script: re-adding a deleted event or burial brings it back.
export async function addEvent(name, type = 'event', details = '') {
  const kind = type === 'burial' ? 'burial' : 'event'
  const cleanName = cleanEventName(name)
  const cleanInfo = kind === 'burial' ? cleanDetails(details) : ''
  if (!cleanName) throw new Error(kind === 'burial' ? 'Enter the name of the person buried here.' : 'Enter a name for the event.')
  const id = entryId(cleanName, kind, cleanInfo)
  const events = await listEvents()
  // Match by name first: the original events have short IDs not made from their names.
  const same = (e) =>
    e.type === kind && e.name.toLowerCase() === cleanName.toLowerCase() && e.details.toLowerCase() === cleanInfo.toLowerCase()
  const existing = events.find(same) ?? events.find((e) => e.id === id)
  if (existing?.active) {
    throw new Error(`There is already ${existing.type === 'burial' ? 'a burial' : 'an event'} called "${existing.name}".`)
  }
  const next = existing
    ? events.map((e) => (e.id === existing.id ? { ...e, name: cleanName, details: cleanInfo, active: true } : e))
    : [...events, { id, name: cleanName, type: kind, details: cleanInfo, active: true }]
  await set(EVENTS_KEY, next, db)
  return next
}

export async function deleteEvent(id) {
  const next = (await listEvents()).map((e) => (e.id === id ? { ...e, active: false } : e))
  await set(EVENTS_KEY, next, db)
  return next
}

export async function resetDemo() {
  await clear(db)
  await ensureSeeded()
}

// Demo mode has no backend to check a signed-in Google account against, so there's
// nothing to verify here, same as the PIN this replaced ("not real security").
export async function unlockStaff() {
  sessionStorage.setItem(UNLOCK_KEY, 'yes')
  return true
}

export const isStaffUnlocked = () => sessionStorage.getItem(UNLOCK_KEY) === 'yes'
export const lockStaff = () => sessionStorage.removeItem(UNLOCK_KEY)
