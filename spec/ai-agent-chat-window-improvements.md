# AI Agent Chat Window Improvements

## Context

The AI Agent chat widget in Pig-Tech ERP has three usability issues: the FAB button is hard to reach on mobile, the 420px-wide chat can't display wide tables on desktop, and there's no way to browse past conversations. The two-tab mode split (Производство / Справки) stays as-is.

## Changes

### 1. Mobile FAB — fix visibility

The FAB is `position: fixed` but can be obscured by mobile browser chrome and lacks safe-area support for notched phones.

**Files:**
- `spa/index.html` — add `viewport-fit=cover` to viewport meta tag
- `spa/src/components/AgentChat.css` — update mobile `@media` block

**Details:**
- FAB bottom: `calc(16px + env(safe-area-inset-bottom, 0px))`
- Chat panel bottom: `calc(80px + env(safe-area-inset-bottom, 0px))`
- Use `100dvh` (with `100vh` fallback) for chat max-height to handle dynamic mobile browser chrome
- Apply same `env(safe-area-inset-bottom)` pattern to desktop rules too (no-op fallback keeps behavior identical)

### 2. Desktop expand/collapse toggle

**Files:**
- `spa/src/components/AgentChat.jsx` — add `expanded` state + toggle button in header
- `spa/src/components/AgentChat.css` — add `.agent-chat-expanded` styles

**Details:**
- New state: `const [expanded, setExpanded] = useState(false)`
- Toggle button in header between "+" and "×" buttons, using ↗/↙ arrows
- Button hidden on mobile via `.desktop-only` class (chat is already full-width)
- Root div gets class: `agent-chat ${expanded ? 'agent-chat-expanded' : ''}`
- CSS: `.agent-chat-expanded { width: 800px; }` with `transition: width 0.3s ease` on `.agent-chat`
- Expanded mode: `.agent-msg { max-width: 95% }`, `.agent-messages { max-height: 600px }`
- Chat is anchored to `right: 24px` so it grows leftward — correct behavior

### 3. Chat history panel

**Backend — new `agentSessions` endpoint:**
- File: `functions/api/agent/index.mjs` — add `agentSessions(db, { personnel_id, limit })` function
- SQL: GROUP BY `session_id` on `agent_conversations` WHERE `personnel_id = $1`, returning `session_id`, `started_at`, `last_message_at`, `message_count`, and first user message as preview
- ORDER BY most recent, LIMIT 20
- File: `functions/api/index.mjs` line 7 — add `agentSessions` to import; line 341 — add `if (action === 'agent.sessions') return ok(await agentSessions(db, body))`

**Frontend — history panel in chat widget:**
- File: `spa/src/components/AgentChat.jsx`
- New state: `historyOpen`, `sessions`, `sessionsLoading`
- History icon button (🕐) in header actions
- Inline panel between header and messages area (not a separate page)
- Each item shows: first message preview (truncated to 60 chars) + timestamp
- Clicking a session sets `sessionId` in state + sessionStorage → existing `useEffect` loads messages
- `handleNewSession` also closes the history panel
- File: `spa/src/components/AgentChat.css` — `.agent-history-panel` with `max-height: 250px`, `overflow-y: auto`, sticky title

## Implementation Order

1. **Mobile FAB fix** (change 1) — standalone CSS/HTML change
2. **Expand/collapse** (change 2) — adds state + CSS
3. **Chat history** (change 3) — adds backend endpoint + frontend panel

## Critical Files

| File | Changes |
|------|---------|
| `spa/index.html` | Add `viewport-fit=cover` |
| `spa/src/components/AgentChat.jsx` | Add expanded + history states, history panel UI |
| `spa/src/components/AgentChat.css` | Add expanded/history/safe-area styles |
| `functions/api/agent/index.mjs` | Add `agentSessions` function |
| `functions/api/index.mjs` | Add `agent.sessions` route (line 341), update import (line 7) |

## Verification

1. **Mobile FAB**: Open on mobile (or Chrome DevTools mobile emulation) — FAB should be visible above browser chrome, no scrolling needed
2. **Expand/collapse**: Click expand button on desktop — chat widens to 800px smoothly; button hidden on mobile
3. **History**: Click history icon → panel shows past sessions; click one → loads that conversation; click "+" → starts fresh
4. **Tabs**: Производство / Справки tabs remain and work as before
5. Build with `cd spa && npm run build` and deploy with `openkbs site push`
