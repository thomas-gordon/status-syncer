// Standalone sync worker — runs alongside Next.js
// Uses dynamic import to load the compiled sync module

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function runSync() {
  try {
    const users = await prisma.user.findMany({
      where: {
        settings: { enableSync: true },
        googleAccount: { isNot: null },
        slackAccount: { isNot: null },
      },
      select: { id: true },
    })

    if (users.length === 0) return

    // Dynamic import of sync function from the compiled Next.js server
    const syncModule = await import('./.next/server/chunks/215.js').catch(() => null)

    if (!syncModule) {
      console.error('[worker] Could not load sync module')
      return
    }

    // Fallback: call the sync API endpoint locally
    for (const user of users) {
      try {
        await syncUser(user.id)
      } catch (err) {
        console.error(`[worker] Error syncing user ${user.id}:`, err)
      }
    }
  } catch (error) {
    console.error('[worker] Sync error:', error)
  }
}

// Inline sync logic to avoid Next.js module resolution issues
async function syncUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { googleAccount: true, slackAccount: true, settings: true },
  })

  if (!user?.settings || !user.googleAccount || !user.slackAccount) return

  const { settings } = user

  if (!settings.enableSync) return

  // Check working hours in user's timezone
  const now = new Date()
  const tz = settings.timezone || process.env.TZ || 'UTC'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || ''
  const hourStr = parts.find((p) => p.type === 'hour')?.value || '0'
  const minuteStr = parts.find((p) => p.type === 'minute')?.value || '0'
  const dayOfWeek = dayMap[weekdayStr] ?? now.getDay()
  const hour = parseInt(hourStr, 10) % 24
  const currentMinutes = hour * 60 + parseInt(minuteStr, 10)

  const enabledDays = settings.workingDays.split(',').map((d) => parseInt(d.trim(), 10))
  if (!enabledDays.includes(dayOfWeek)) return

  const [startH, startM] = settings.workStartTime.split(':').map(Number)
  const [endH, endM] = settings.workEndTime.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM
  if (currentMinutes < startMinutes || currentMinutes >= endMinutes) {
    // Outside working hours — clear if needed
    if (settings.clearStatusOnEnd && settings.lastSetStatusText) {
      await clearSlackStatus(user.slackAccount.accessToken)
      await prisma.settings.update({
        where: { userId },
        data: { lastSetStatusText: null, lastSetEventId: null },
      })
    }
    return
  }

  // Determine what status to set based on status source
  const source = settings.statusSource || 'calendar'
  let statusText = null
  let statusEmoji = null
  let statusExpiration = 0
  let statusId = null // used for dedup

  // --- Calendar logic ---
  async function getCalendarStatus() {
    if (!user.googleAccount) return null

    const accessToken = await refreshGoogleToken(userId)
    if (!accessToken) return null

    let events = await fetchCurrentEvents(accessToken, user.googleAccount.calendarId || 'primary')
    events = events.filter((e) => e.eventType !== 'workingLocation')

    if (settings.privateEventMode === 'ignore') {
      events = events.filter((e) => e.visibility !== 'private')
    } else {
      events = events.map((e) =>
        e.visibility === 'private' ? { ...e, summary: 'Busy' } : e
      )
    }

    if (events.length === 0) return null

    const getPriority = (et) => {
      if (et === 'outOfOffice') return 3
      if (et === 'focusTime') return 2
      return 1
    }
    const sorted = [...events].sort((a, b) => {
      const pDiff = getPriority(b.eventType) - getPriority(a.eventType)
      if (pDiff !== 0) return pDiff
      const aStart = new Date(a.start?.dateTime || a.start?.date || 0).getTime()
      const bStart = new Date(b.start?.dateTime || b.start?.date || 0).getTime()
      return bStart - aStart
    })

    let selectedEvent = null
    let selectedEmoji = settings.regularEventsEmoji

    for (const event of sorted) {
      const et = event.eventType
      if (et === 'outOfOffice') {
        if (!settings.outOfOfficeEnabled) continue
        selectedEmoji = settings.outOfOfficeEmoji
      } else if (et === 'focusTime') {
        if (!settings.focusTimeEnabled) continue
        selectedEmoji = settings.focusTimeEmoji
      } else {
        if (!settings.regularEventsEnabled) continue
        selectedEmoji = settings.regularEventsEmoji
      }
      selectedEvent = event
      break
    }

    if (!selectedEvent) return null

    const endStr = selectedEvent.end?.dateTime || selectedEvent.end?.date
    const endTime = endStr ? new Date(endStr) : null

    return {
      text: selectedEvent.summary || 'Meeting',
      emoji: selectedEmoji,
      expiration: endTime ? Math.floor(endTime.getTime() / 1000) : 0,
      id: `cal:${selectedEvent.id}`,
      endTime,
    }
  }

  // --- Last.fm logic ---
  async function getMusicStatus() {
    if (!settings.lastfmUsername || !process.env.LASTFM_API_KEY) return null

    const track = await fetchNowPlaying(settings.lastfmUsername)
    if (!track) return null

    const text = `${track.name} — ${track.artist}`
    return {
      text,
      emoji: settings.musicEmoji || '',
      expiration: 0, // no expiration for music — we clear when stopped
      id: `music:${track.name}:${track.artist}`,
      endTime: null,
    }
  }

  // Resolve status based on source mode
  if (source === 'calendar') {
    const cal = await getCalendarStatus()
    if (cal) {
      statusText = cal.text
      statusEmoji = cal.emoji
      statusExpiration = cal.expiration
      statusId = cal.id
    }
  } else if (source === 'music') {
    const music = await getMusicStatus()
    if (music) {
      statusText = music.text
      statusEmoji = music.emoji
      statusExpiration = music.expiration
      statusId = music.id
    }
  } else if (source === 'calendar_music') {
    const cal = await getCalendarStatus()
    if (cal) {
      statusText = cal.text
      statusEmoji = cal.emoji
      statusExpiration = cal.expiration
      statusId = cal.id
    } else {
      const music = await getMusicStatus()
      if (music) {
        statusText = music.text
        statusEmoji = music.emoji
        statusExpiration = music.expiration
        statusId = music.id
      }
    }
  }

  // No status to set — clear if needed
  if (!statusText) {
    if (settings.clearStatusOnEnd && settings.lastSetStatusText) {
      await clearSlackStatus(user.slackAccount.accessToken)
      await prisma.settings.update({
        where: { userId },
        data: { lastSetStatusText: null, lastSetEventId: null },
      })
    }
    return
  }

  // Skip if same status already set
  if (settings.lastSetEventId === statusId) return

  // Respect manual status
  if (settings.respectManualStatus && settings.lastSetStatusText) {
    const current = await getSlackStatus(user.slackAccount.accessToken)
    if (current && current.status_text !== '' && current.status_text !== settings.lastSetStatusText) {
      return
    }
  }

  console.log(`[worker] Setting status: "${statusText}" for user ${userId}`)

  const success = await setSlackStatus(
    user.slackAccount.accessToken,
    statusText,
    statusEmoji,
    statusExpiration
  )

  if (!success) return

  // DND (only for calendar events with end times)
  if (settings.muteDnd && statusId?.startsWith('cal:')) {
    const cal = await getCalendarStatus()
    if (cal?.endTime) {
      const remainingMinutes = Math.ceil((cal.endTime.getTime() - now.getTime()) / (1000 * 60))
      if (remainingMinutes > 0) {
        await setDnd(user.slackAccount.accessToken, remainingMinutes)
      }
    }
  }

  await prisma.settings.update({
    where: { userId },
    data: { lastSetStatusText: statusText, lastSetEventId: statusId },
  })
}

// --- Slack helpers ---

async function setSlackStatus(token, text, emoji, expiration) {
  const resp = await fetch('https://slack.com/api/users.profile.set', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: { status_text: text, status_emoji: emoji, status_expiration: expiration } }),
  })
  const data = await resp.json()
  if (!data.ok) console.error('[worker] Slack status error:', data.error)
  return data.ok
}

async function clearSlackStatus(token) {
  const resp = await fetch('https://slack.com/api/users.profile.set', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: { status_text: '', status_emoji: '', status_expiration: 0 } }),
  })
  const data = await resp.json()
  return data.ok
}

async function getSlackStatus(token) {
  const resp = await fetch('https://slack.com/api/users.profile.get', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await resp.json()
  return data.ok ? data.profile : null
}

async function setDnd(token, minutes) {
  await fetch(`https://slack.com/api/dnd.setSnooze?num_minutes=${minutes}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}

// --- Google helpers ---

async function refreshGoogleToken(userId) {
  const ga = await prisma.googleAccount.findUnique({ where: { userId } })
  if (!ga?.refreshToken) return null

  const now = new Date()
  if (ga.expiresAt && ga.expiresAt > new Date(now.getTime() + 60000)) {
    return ga.accessToken
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: ga.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!resp.ok) {
    console.error('[worker] Google token refresh failed:', await resp.text())
    return null
  }

  const tokens = await resp.json()
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null

  await prisma.googleAccount.update({
    where: { userId },
    data: { accessToken: tokens.access_token, expiresAt },
  })

  return tokens.access_token
}

async function fetchCurrentEvents(accessToken, calendarId) {
  const now = new Date()
  const timeMin = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString()
  const timeMax = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString()
  const cid = encodeURIComponent(calendarId)
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime' })

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${cid}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!resp.ok) {
    console.error('[worker] Google calendar fetch failed:', await resp.text())
    return []
  }

  const data = await resp.json()
  const events = data.items || []

  return events.filter((e) => {
    const startStr = e.start?.dateTime || e.start?.date
    const endStr = e.end?.dateTime || e.end?.date
    if (!startStr || !endStr) return false
    return new Date(startStr) <= now && now < new Date(endStr)
  }).filter((e) => e.status !== 'cancelled')
}

// --- Last.fm helpers ---

async function fetchNowPlaying(username) {
  try {
    const params = new URLSearchParams({
      method: 'user.getrecenttracks',
      user: username,
      api_key: process.env.LASTFM_API_KEY,
      format: 'json',
      limit: '1',
    })

    const resp = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`)
    if (!resp.ok) {
      console.error('[worker] Last.fm API error:', resp.status)
      return null
    }

    const data = await resp.json()
    const tracks = data?.recenttracks?.track
    if (!tracks || tracks.length === 0) return null

    const track = tracks[0]
    // Check if currently playing (not just recently played)
    const isNowPlaying = track['@attr']?.nowplaying === 'true'
    if (!isNowPlaying) return null

    return {
      name: track.name || 'Unknown Track',
      artist: track.artist?.['#text'] || track.artist || 'Unknown Artist',
      album: track.album?.['#text'] || '',
    }
  } catch (err) {
    console.error('[worker] Last.fm fetch error:', err)
    return null
  }
}

// --- Main loop ---

console.log('[worker] Starting sync worker (every 60s)')

// Run immediately
runSync().catch((err) => console.error('[worker] Initial sync error:', err))

// Then every 60 seconds
setInterval(() => {
  runSync().catch((err) => console.error('[worker] Sync error:', err))
}, 60 * 1000)
