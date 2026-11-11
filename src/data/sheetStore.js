// Live backend: the Google Apps Script web app in apps-script/Code.gs, which keeps
// rows in a Google Sheet and photos in a Drive folder. No API key: the script runs
// as the Google account that deployed it.
const API_URL = import.meta.env.VITE_APPS_SCRIPT_URL
const TOKEN_KEY = 'south-view-staff-token'

// Google doesn't document a way to show Drive files in <img> tags. These are the two
// URL formats that work today (the older uc?export=view links already broke). If
// photos stop loading, this is the one place to fix it.
const driveImage = (fileId) => `https://lh3.googleusercontent.com/d/${fileId}=w1600`
const driveThumbnail = (fileId) => `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`

const toRecord = (row) => ({
  ...row,
  imageSrc: driveImage(row.fileId),
  imageFallback: driveThumbnail(row.fileId),
  image: null,
  sample: false,
})

async function parse(res) {
  if (!res.ok) throw new Error(`The server responded with ${res.status}`)
  const data = await res.json()
  if (!data.ok) throw Object.assign(new Error(data.error), { code: data.code })
  return data
}

// Plain-text bodies keep these "simple" requests, so the browser skips the CORS
// preflight that Apps Script can't answer.
const post = (body) => fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }).then(parse)

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

// Approved photos, plus burial photos that passed the AI check today (those have
// shownUntil). A script from before burial-day photos sends only the approved ones. Newest first.
export async function listGallery() {
  const { photos, burialDayPhotos = [] } = await fetch(`${API_URL}?action=gallery`).then(parse)
  return [...photos, ...burialDayPhotos].map(toRecord).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

export async function listAll() {
  const { submissions } = await post({ action: 'staffList', idToken: sessionStorage.getItem(TOKEN_KEY) })
  return submissions.map(toRecord).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

// shownUntil is set when a burial photo passed the AI check and is in the gallery until then.
export async function addSubmission(record) {
  const { shownUntil } = await post({
    action: 'submit',
    event: record.event,
    caption: record.caption,
    consent: record.consent,
    fileName: record.fileName,
    aiCheck: record.aiCheck,
    mimeType: record.image.type || 'image/jpeg',
    image: await toBase64(record.image),
  })
  return { shownUntil: shownUntil ?? '' }
}

export async function setStatus(id, status) {
  await post({ action: 'setStatus', id, status, idToken: sessionStorage.getItem(TOKEN_KEY) })
}

export async function checkAI(id) {
  const { aiCheck } = await post({
    action: 'checkAI',
    id,
    idToken: sessionStorage.getItem(TOKEN_KEY),
  })
  return aiCheck
}

export async function listEvents() {
  const { events } = await fetch(`${API_URL}?action=events`).then(parse)
  return events
}

export async function addEvent(name, type = 'event', details = '') {
  const { events } = await post({ action: 'addEvent', name, type, details, idToken: sessionStorage.getItem(TOKEN_KEY) })
  return events
}

export async function deleteEvent(id) {
  const { events } = await post({ action: 'deleteEvent', id, idToken: sessionStorage.getItem(TOKEN_KEY) })
  return events
}

// idToken is the credential Google Sign-In gives the browser. It's re-sent with every
// staff action (like the password before it) rather than kept server-side, since Apps
// Script web apps are stateless; it naturally expires after about an hour, at which
// point the next action fails and the Staff page asks to sign in again.
export async function unlockStaff(idToken) {
  try {
    await post({ action: 'staffList', idToken })
  } catch (err) {
    if (err.code === 'unauthorized') return false
    throw err
  }
  sessionStorage.setItem(TOKEN_KEY, idToken)
  return true
}

export const isStaffUnlocked = () => Boolean(sessionStorage.getItem(TOKEN_KEY))
export const lockStaff = () => sessionStorage.removeItem(TOKEN_KEY)
