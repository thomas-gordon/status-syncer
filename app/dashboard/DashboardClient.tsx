'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { signOut } from 'next-auth/react'

export interface SettingsData {
  enableSync: boolean
  clearStatusOnEnd: boolean
  respectManualStatus: boolean
  muteDnd: boolean
  regularEventsEnabled: boolean
  regularEventsEmoji: string
  focusTimeEnabled: boolean
  focusTimeEmoji: string
  outOfOfficeEnabled: boolean
  outOfOfficeEmoji: string
  workStartTime: string
  workEndTime: string
  workingDays: string
  timezone: string
  privateEventMode: string
}

interface Props {
  user: { email: string; name: string | null; memberSince: Date }
  isGoogleConnected: boolean
  googleEmail: string | null
  isSlackConnected: boolean
  slackTeamName: string | null
  initialSettings: SettingsData
  connectionMessage?: string
  errorMessage?: string
}

const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [
        'Australia/Melbourne',
        'Australia/Sydney',
        'Australia/Perth',
        'Europe/London',
        'Europe/Berlin',
        'America/New_York',
        'America/Los_Angeles',
        'Asia/Tokyo',
        'Asia/Singapore',
        'UTC',
      ]

const DAY_LABELS = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
  { value: '0', label: 'Sun' },
]

export default function DashboardClient({
  user,
  isGoogleConnected,
  googleEmail,
  isSlackConnected,
  slackTeamName,
  initialSettings,
  connectionMessage,
  errorMessage,
}: Props) {
  const [settings, setSettings] = useState<SettingsData>(initialSettings)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [testingSlack, setTestingSlack] = useState(false)
  const [debugLog, setDebugLog] = useState<string[] | null>(null)
  const [runningDebug, setRunningDebug] = useState(false)

  // Emoji editing state
  const [editingEmoji, setEditingEmoji] = useState<string | null>(null)
  const [emojiInputValue, setEmojiInputValue] = useState('')

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)

  // Show toast from URL params on mount
  useEffect(() => {
    if (connectionMessage) {
      showToast(connectionMessage, 'success')
    } else if (errorMessage) {
      showToast(errorMessage, 'error')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const saveSettings = useCallback(async (data: SettingsData) => {
    setSaving(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (response.ok) {
        showToast('Settings saved', 'success')
      } else {
        showToast('Failed to save settings', 'error')
      }
    } catch {
      showToast('Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }, [])

  // Auto-save with debounce on settings change
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveSettings(settings)
    }, 500)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [settings, saveSettings])

  function updateSetting<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  function toggleWorkingDay(dayValue: string) {
    const current = settings.workingDays
      ? settings.workingDays.split(',').filter(Boolean)
      : []
    const isEnabled = current.includes(dayValue)
    let next: string[]
    if (isEnabled) {
      next = current.filter((d) => d !== dayValue)
    } else {
      next = [...current, dayValue]
    }
    // Sort days 0-6
    next.sort((a, b) => parseInt(a) - parseInt(b))
    updateSetting('workingDays', next.join(','))
  }

  function startEmojiEdit(field: string, currentValue: string) {
    setEditingEmoji(field)
    setEmojiInputValue(currentValue)
  }

  function commitEmojiEdit(field: keyof SettingsData) {
    if (emojiInputValue.trim()) {
      updateSetting(field, emojiInputValue.trim())
    }
    setEditingEmoji(null)
  }

  async function handleGoogleConnect() {
    window.location.href = '/api/integrations/google/connect'
  }

  async function handleGoogleDisconnect() {
    try {
      await fetch('/api/integrations/google/disconnect', { method: 'POST' })
      window.location.reload()
    } catch {
      showToast('Failed to disconnect Google Calendar', 'error')
    }
  }

  async function handleSlackConnect() {
    window.location.href = '/api/integrations/slack/connect'
  }

  async function handleSlackDisconnect() {
    try {
      await fetch('/api/integrations/slack/disconnect', { method: 'POST' })
      window.location.reload()
    } catch {
      showToast('Failed to disconnect Slack', 'error')
    }
  }

  async function handleTestSlack() {
    setTestingSlack(true)
    try {
      const response = await fetch('/api/integrations/slack/test', {
        method: 'POST',
      })
      if (response.ok) {
        showToast('Test status set for 5 minutes!', 'success')
      } else {
        const data = await response.json()
        showToast(data.error || 'Test failed', 'error')
      }
    } catch {
      showToast('Test failed', 'error')
    } finally {
      setTestingSlack(false)
    }
  }

  async function handleDebugSync() {
    setRunningDebug(true)
    setDebugLog(null)
    try {
      const response = await fetch('/api/sync/trigger', { method: 'POST' })
      const data = await response.json()
      setDebugLog(data.log || ['No output'])
    } catch {
      setDebugLog(['Failed to run debug sync'])
    } finally {
      setRunningDebug(false)
    }
  }

  const memberSinceDate = new Date(user.memberSince).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const enabledDays = settings.workingDays
    ? settings.workingDays.split(',').filter(Boolean)
    : []

  return (
    <div className="min-h-screen bg-[#f0ede5]">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg transition-all ${
            toast.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <header className="bg-[#f0ede5] border-b border-stone-200">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-stone-800">Dashboard</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-sm text-stone-500 hover:text-stone-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
        {/* Welcome */}
        <p className="text-stone-600 text-sm">
          Welcome back, {user.name || user.email.split('@')[0]}
        </p>

        {/* Profile card */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center text-stone-600 font-medium text-sm">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-stone-800">{user.email}</p>
              <p className="text-xs text-stone-400">Member since {memberSinceDate}</p>
            </div>
            {saving && (
              <span className="ml-auto text-xs text-stone-400">Saving...</span>
            )}
          </div>
        </div>

        {/* Google Calendar */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="18" height="17" rx="2" stroke="#4285f4" strokeWidth="1.5"/>
                <path d="M3 9h18" stroke="#4285f4" strokeWidth="1.5"/>
                <path d="M8 2v4M16 2v4" stroke="#4285f4" strokeWidth="1.5" strokeLinecap="round"/>
                <rect x="7" y="13" width="3" height="3" rx="0.5" fill="#34a853"/>
                <rect x="11" y="13" width="3" height="3" rx="0.5" fill="#fbbc04"/>
                <rect x="15" y="13" width="3" height="3" rx="0.5" fill="#ea4335"/>
              </svg>
              <h2 className="text-sm font-semibold text-stone-800">Google Calendar</h2>
            </div>
          </div>

          {isGoogleConnected ? (
            <div>
              <p className="text-xs text-stone-500 mb-3 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                Syncing from primary calendar{googleEmail ? ` for ${googleEmail}` : ''}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleGoogleConnect}
                  className="text-xs px-3 py-1.5 border border-stone-300 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  Reconnect
                </button>
                <button
                  onClick={handleGoogleDisconnect}
                  className="text-xs px-3 py-1.5 border border-stone-300 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-stone-400 mb-3">Not connected</p>
              <button
                onClick={handleGoogleConnect}
                className="text-xs px-3 py-1.5 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors"
              >
                Connect Google Calendar
              </button>
            </div>
          )}
        </div>

        {/* Slack */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <path d="M9.12 2C7.39 2 6 3.39 6 5.12c0 1.73 1.39 3.12 3.12 3.12h3.12V5.12C12.24 3.39 10.85 2 9.12 2z" fill="#e01e5a"/>
                <path d="M9.12 9.76H2.5C1.12 9.76 0 10.88 0 12.24s1.12 2.48 2.5 2.48h6.62v-4.96z" fill="#e01e5a"/>
                <path d="M14.88 22c1.73 0 3.12-1.39 3.12-3.12s-1.39-3.12-3.12-3.12h-3.12v3.12C11.76 20.61 13.15 22 14.88 22z" fill="#2eb67d"/>
                <path d="M14.88 14.24H21.5c1.38 0 2.5-1.12 2.5-2.48s-1.12-2.48-2.5-2.48h-6.62v4.96z" fill="#2eb67d"/>
                <path d="M2 14.88C2 16.61 3.39 18 5.12 18s3.12-1.39 3.12-3.12v-3.12H5.12C3.39 11.76 2 13.15 2 14.88z" fill="#36c5f0"/>
                <path d="M9.76 14.88V21.5c0 1.38 1.12 2.5 2.48 2.5s2.48-1.12 2.48-2.5v-6.62H9.76z" fill="#36c5f0"/>
                <path d="M22 9.12C22 7.39 20.61 6 18.88 6s-3.12 1.39-3.12 3.12v3.12h3.12C20.61 12.24 22 10.85 22 9.12z" fill="#ecb22e"/>
                <path d="M14.24 9.76V3.14c0-1.38-1.12-2.5-2.48-2.5S9.28 1.76 9.28 3.14v6.62h4.96z" fill="#ecb22e"/>
              </svg>
              <h2 className="text-sm font-semibold text-stone-800">Slack</h2>
            </div>
          </div>

          {isSlackConnected ? (
            <div>
              <p className="text-xs text-stone-500 mb-3 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                Connected to Slack{slackTeamName ? ` — ${slackTeamName}` : ''}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleTestSlack}
                  disabled={testingSlack}
                  className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {testingSlack ? 'Testing...' : 'Test Status'}
                </button>
                <button
                  onClick={handleSlackConnect}
                  className="text-xs px-3 py-1.5 border border-stone-300 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  Reconnect
                </button>
                <button
                  onClick={handleSlackDisconnect}
                  className="text-xs px-3 py-1.5 border border-stone-300 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-stone-400 mb-3">Not connected</p>
              <button
                onClick={handleSlackConnect}
                className="text-xs px-3 py-1.5 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors"
              >
                Connect Slack
              </button>
            </div>
          )}
        </div>

        {/* Sync Settings */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-stone-800 mb-4">Sync Settings</h2>
          <div className="space-y-3">
            <ToggleRow
              label="Enable Sync"
              description="Automatically update your Slack status based on calendar events"
              checked={settings.enableSync}
              onChange={(v) => updateSetting('enableSync', v)}
            />
            <ToggleRow
              label="Clear Status on Event End"
              description="Remove Slack status when a calendar event ends"
              checked={settings.clearStatusOnEnd}
              onChange={(v) => updateSetting('clearStatusOnEnd', v)}
            />
            <ToggleRow
              label="Respect Manual Status"
              description="Skip sync if you have manually set a different Slack status"
              checked={settings.respectManualStatus}
              onChange={(v) => updateSetting('respectManualStatus', v)}
            />
            <ToggleRow
              label="Mute Slack Notifications During Events"
              description="Enable Do Not Disturb mode for the duration of calendar events"
              checked={settings.muteDnd}
              onChange={(v) => updateSetting('muteDnd', v)}
            />
          </div>
        </div>

        {/* Event Type Settings */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-stone-800 mb-4">Event Types</h2>
          <div className="space-y-4">
            <EventTypeRow
              label="Regular Events"
              description="Standard calendar events"
              enabled={settings.regularEventsEnabled}
              emoji={settings.regularEventsEmoji}
              emojiField="regularEventsEmoji"
              editingEmoji={editingEmoji}
              emojiInputValue={emojiInputValue}
              onToggleEnabled={(v) => updateSetting('regularEventsEnabled', v)}
              onStartEmojiEdit={startEmojiEdit}
              onEmojiInputChange={setEmojiInputValue}
              onCommitEmojiEdit={commitEmojiEdit}
            />
            <EventTypeRow
              label="Focus Time"
              description="Google Calendar Focus Time blocks"
              enabled={settings.focusTimeEnabled}
              emoji={settings.focusTimeEmoji}
              emojiField="focusTimeEmoji"
              editingEmoji={editingEmoji}
              emojiInputValue={emojiInputValue}
              onToggleEnabled={(v) => updateSetting('focusTimeEnabled', v)}
              onStartEmojiEdit={startEmojiEdit}
              onEmojiInputChange={setEmojiInputValue}
              onCommitEmojiEdit={commitEmojiEdit}
            />
            <EventTypeRow
              label="Out of Office"
              description="Google Calendar Out of Office events"
              enabled={settings.outOfOfficeEnabled}
              emoji={settings.outOfOfficeEmoji}
              emojiField="outOfOfficeEmoji"
              editingEmoji={editingEmoji}
              emojiInputValue={emojiInputValue}
              onToggleEnabled={(v) => updateSetting('outOfOfficeEnabled', v)}
              onStartEmojiEdit={startEmojiEdit}
              onEmojiInputChange={setEmojiInputValue}
              onCommitEmojiEdit={commitEmojiEdit}
            />
          </div>
        </div>

        {/* Event Handling */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-stone-800 mb-4">Event Handling</h2>
          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
            <p className="text-sm font-medium text-stone-700 mb-3">Private Events</p>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="privateEventMode"
                  value="mask"
                  checked={settings.privateEventMode === 'mask'}
                  onChange={() => updateSetting('privateEventMode', 'mask')}
                  className="mt-0.5 text-red-500 focus:ring-stone-400"
                />
                <div>
                  <p className="text-sm font-medium text-stone-700">Mask</p>
                  <p className="text-xs text-stone-400">Show private events as &ldquo;Busy&rdquo;</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="privateEventMode"
                  value="ignore"
                  checked={settings.privateEventMode === 'ignore'}
                  onChange={() => updateSetting('privateEventMode', 'ignore')}
                  className="mt-0.5 text-red-500 focus:ring-stone-400"
                />
                <div>
                  <p className="text-sm font-medium text-stone-700">Ignore</p>
                  <p className="text-xs text-stone-400">Don&apos;t sync private events</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Working Hours */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-stone-800 mb-4">Working Hours</h2>
          <div className="mb-4">
            <label className="text-xs text-stone-500 block mb-1">Timezone</label>
            <select
              value={settings.timezone}
              onChange={(e) => updateSetting('timezone', e.target.value)}
              className="text-sm border border-stone-300 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-stone-400"
            >
              <option value="">Use server default</option>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-stone-500">Start</label>
              <input
                type="time"
                value={settings.workStartTime}
                onChange={(e) => updateSetting('workStartTime', e.target.value)}
                className="text-sm border border-stone-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-stone-400"
              />
            </div>
            <span className="text-stone-400 text-sm">—</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-stone-500">End</label>
              <input
                type="time"
                value={settings.workEndTime}
                onChange={(e) => updateSetting('workEndTime', e.target.value)}
                className="text-sm border border-stone-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-stone-400"
              />
            </div>
          </div>
          <div>
            <p className="text-xs text-stone-500 mb-2">Working days</p>
            <div className="grid grid-cols-4 gap-2">
              {DAY_LABELS.map((day) => (
                <label
                  key={day.value}
                  className="flex items-center gap-1.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={enabledDays.includes(day.value)}
                    onChange={() => toggleWorkingDay(day.value)}
                    className="rounded border-stone-300 text-stone-800 focus:ring-stone-400"
                  />
                  <span className="text-xs text-stone-600">{day.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Debug sync */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-stone-800">Debug Sync</h2>
            <button
              onClick={handleDebugSync}
              disabled={runningDebug}
              className="text-xs px-3 py-1.5 border border-stone-300 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              {runningDebug ? 'Running...' : 'Run diagnostic'}
            </button>
          </div>
          <p className="text-xs text-stone-400 mb-3">Check why events may not be syncing to your Slack status.</p>
          {debugLog && (
            <pre className="text-xs bg-stone-50 border border-stone-200 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono text-stone-700">
              {debugLog.join('\n')}
            </pre>
          )}
        </div>

        <p className="text-center text-xs text-stone-400 pb-4">
          Status Watcher syncs your status every 60 seconds
        </p>
      </main>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 rounded border-stone-300 text-stone-800 focus:ring-stone-400"
      />
      <div>
        <p className="text-sm font-medium text-stone-700">{label}</p>
        <p className="text-xs text-stone-400">{description}</p>
      </div>
    </label>
  )
}

function EventTypeRow({
  label,
  description,
  enabled,
  emoji,
  emojiField,
  editingEmoji,
  emojiInputValue,
  onToggleEnabled,
  onStartEmojiEdit,
  onEmojiInputChange,
  onCommitEmojiEdit,
}: {
  label: string
  description: string
  enabled: boolean
  emoji: string
  emojiField: string
  editingEmoji: string | null
  emojiInputValue: string
  onToggleEnabled: (v: boolean) => void
  onStartEmojiEdit: (field: string, value: string) => void
  onEmojiInputChange: (v: string) => void
  onCommitEmojiEdit: (field: keyof SettingsData) => void
}) {
  const isEditing = editingEmoji === emojiField

  return (
    <div className="flex items-center justify-between gap-3">
      <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-0">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          className="mt-0.5 rounded border-stone-300 text-stone-800 focus:ring-stone-400"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-700">{label}</p>
          <p className="text-xs text-stone-400">{description}</p>
        </div>
      </label>
      <div className="flex-shrink-0">
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={emojiInputValue}
            onChange={(e) => onEmojiInputChange(e.target.value)}
            onBlur={() => onCommitEmojiEdit(emojiField as keyof SettingsData)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onCommitEmojiEdit(emojiField as keyof SettingsData)
              }
              if (e.key === 'Escape') {
                onCommitEmojiEdit(emojiField as keyof SettingsData)
              }
            }}
            className="w-16 text-center text-xl border border-stone-300 rounded-lg px-1 py-1 focus:outline-none focus:ring-2 focus:ring-stone-400"
          />
        ) : (
          <button
            onClick={() => onStartEmojiEdit(emojiField, emoji)}
            className="w-12 h-12 flex flex-col items-center justify-center border border-stone-200 rounded-lg bg-stone-50 hover:bg-stone-100 transition-colors group"
            title="Click to change emoji"
          >
            <span className="text-xl leading-none">{emoji}</span>
            <span className="text-[9px] text-stone-400 group-hover:text-stone-500 mt-0.5">
              change
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
