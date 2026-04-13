import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') // userId
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL('/dashboard?error=slack_auth_failed', req.url)
    )
  }

  try {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/slack/callback`

    // Exchange code for token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        redirect_uri: redirectUri,
      }),
    })

    const data = await tokenResponse.json()

    if (!data.ok) {
      console.error('Slack OAuth failed:', data.error)
      return NextResponse.redirect(
        new URL('/dashboard?error=slack_token_failed', req.url)
      )
    }

    const authedUser = data.authed_user
    const team = data.team

    if (!authedUser?.access_token || !authedUser?.id) {
      console.error('Missing authed_user data from Slack')
      return NextResponse.redirect(
        new URL('/dashboard?error=slack_token_failed', req.url)
      )
    }

    // Upsert SlackAccount
    await prisma.slackAccount.upsert({
      where: { userId: state },
      create: {
        userId: state,
        accessToken: authedUser.access_token,
        slackUserId: authedUser.id,
        teamId: team?.id || '',
        teamName: team?.name || '',
      },
      update: {
        accessToken: authedUser.access_token,
        slackUserId: authedUser.id,
        teamId: team?.id || '',
        teamName: team?.name || '',
      },
    })

    return NextResponse.redirect(
      new URL('/dashboard?connected=slack', req.url)
    )
  } catch (error) {
    console.error('Slack callback error:', error)
    return NextResponse.redirect(
      new URL('/dashboard?error=slack_callback_failed', req.url)
    )
  }
}
