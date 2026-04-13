interface SlackStatusResponse {
  ok: boolean
  error?: string
  profile?: {
    status_text?: string
    status_emoji?: string
    status_expiration?: number
  }
}

interface SlackApiResponse {
  ok: boolean
  error?: string
}

export async function setSlackStatus(
  accessToken: string,
  statusText: string,
  statusEmoji: string,
  expirationUnix: number
): Promise<boolean> {
  try {
    const response = await fetch('https://slack.com/api/users.profile.set', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profile: {
          status_text: statusText,
          status_emoji: statusEmoji,
          status_expiration: expirationUnix,
        },
      }),
    })

    const data: SlackApiResponse = await response.json()

    if (!data.ok) {
      console.error('Failed to set Slack status:', data.error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error setting Slack status:', error)
    return false
  }
}

export async function clearSlackStatus(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch('https://slack.com/api/users.profile.set', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profile: {
          status_text: '',
          status_emoji: '',
          status_expiration: 0,
        },
      }),
    })

    const data: SlackApiResponse = await response.json()

    if (!data.ok) {
      console.error('Failed to clear Slack status:', data.error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error clearing Slack status:', error)
    return false
  }
}

export async function getSlackStatus(accessToken: string): Promise<{
  statusText: string
  statusEmoji: string
  statusExpiration: number
} | null> {
  try {
    const response = await fetch('https://slack.com/api/users.profile.get', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    const data: SlackStatusResponse = await response.json()

    if (!data.ok || !data.profile) {
      console.error('Failed to get Slack status:', data.error)
      return null
    }

    return {
      statusText: data.profile.status_text || '',
      statusEmoji: data.profile.status_emoji || '',
      statusExpiration: data.profile.status_expiration || 0,
    }
  } catch (error) {
    console.error('Error getting Slack status:', error)
    return null
  }
}

export async function setDnd(
  accessToken: string,
  numMinutes: number
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://slack.com/api/dnd.setSnooze?num_minutes=${numMinutes}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    const data: SlackApiResponse = await response.json()

    if (!data.ok) {
      console.error('Failed to set Slack DND:', data.error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error setting Slack DND:', error)
    return false
  }
}

export async function endDnd(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch('https://slack.com/api/dnd.endSnooze', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    const data: SlackApiResponse = await response.json()

    if (!data.ok) {
      console.error('Failed to end Slack DND:', data.error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error ending Slack DND:', error)
    return false
  }
}

export async function testSlackConnection(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch('https://slack.com/api/auth.test', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    const data: SlackApiResponse = await response.json()
    return data.ok
  } catch (error) {
    console.error('Error testing Slack connection:', error)
    return false
  }
}
