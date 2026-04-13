import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const clientId = process.env.SLACK_CLIENT_ID!
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/slack/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: '',
    user_scope: 'users.profile:read,users.profile:write,dnd:write',
    state: session.user.id,
  })

  const slackAuthUrl = `https://slack.com/oauth/v2/authorize?${params}`

  return NextResponse.redirect(slackAuthUrl)
}
