import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') // userId
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL('/dashboard?error=google_auth_failed', process.env.NEXTAUTH_URL)
    )
  }

  try {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/google/callback`

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', await tokenResponse.text())
      return NextResponse.redirect(
        new URL('/dashboard?error=google_token_failed', process.env.NEXTAUTH_URL)
      )
    }

    const tokens = await tokenResponse.json()

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null

    // Fetch Google user email
    let googleEmail: string | null = null
    try {
      const userinfoResponse = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }
      )
      if (userinfoResponse.ok) {
        const userinfo = await userinfoResponse.json()
        googleEmail = userinfo.email || null
      }
    } catch (e) {
      console.error('Failed to fetch Google userinfo:', e)
    }

    // Upsert GoogleAccount
    await prisma.googleAccount.upsert({
      where: { userId: state },
      create: {
        userId: state,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt,
        email: googleEmail,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt,
        email: googleEmail,
      },
    })

    return NextResponse.redirect(
      new URL('/dashboard?connected=google', process.env.NEXTAUTH_URL)
    )
  } catch (error) {
    console.error('Google callback error:', error)
    return NextResponse.redirect(
      new URL('/dashboard?error=google_callback_failed', process.env.NEXTAUTH_URL)
    )
  }
}
