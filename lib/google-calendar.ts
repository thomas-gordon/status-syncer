import { prisma } from '@/lib/db'

interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

interface CalendarEvent {
  id: string
  summary: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  eventType?: string
  status?: string
}

export async function refreshAccessToken(userId: string): Promise<string | null> {
  const googleAccount = await prisma.googleAccount.findUnique({
    where: { userId },
  })

  if (!googleAccount || !googleAccount.refreshToken) {
    return null
  }

  // Check if token needs refresh (within 1 minute of expiry)
  const now = new Date()
  const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000)

  if (googleAccount.expiresAt && googleAccount.expiresAt > oneMinuteFromNow) {
    return googleAccount.accessToken
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: googleAccount.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      console.error('Failed to refresh Google token:', await response.text())
      return null
    }

    const tokens: GoogleTokens = await response.json()

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null

    await prisma.googleAccount.update({
      where: { userId },
      data: {
        accessToken: tokens.access_token,
        expiresAt,
      },
    })

    return tokens.access_token
  } catch (error) {
    console.error('Error refreshing Google token:', error)
    return null
  }
}

export async function getCurrentEvents(userId: string): Promise<CalendarEvent[]> {
  const accessToken = await refreshAccessToken(userId)

  if (!accessToken) {
    return []
  }

  const googleAccount = await prisma.googleAccount.findUnique({
    where: { userId },
  })

  if (!googleAccount) {
    return []
  }

  const now = new Date()
  const timeMin = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString()
  const timeMax = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString()

  const calendarId = encodeURIComponent(googleAccount.calendarId || 'primary')

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      console.error('Failed to fetch calendar events:', await response.text())
      return []
    }

    const data = await response.json()
    const events: CalendarEvent[] = data.items || []

    // Filter for events that are currently happening (start <= now < end)
    const currentEvents = events.filter((event) => {
      const startStr = event.start?.dateTime || event.start?.date
      const endStr = event.end?.dateTime || event.end?.date

      if (!startStr || !endStr) return false

      const start = new Date(startStr)
      const end = new Date(endStr)

      return start <= now && now < end
    })

    // Filter out declined and cancelled events
    return currentEvents.filter(
      (e) => e.status !== 'cancelled'
    )
  } catch (error) {
    console.error('Error fetching calendar events:', error)
    return []
  }
}
