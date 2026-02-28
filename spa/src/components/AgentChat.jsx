import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { Plus, Send } from 'lucide-react'
import './AgentChat.css'

const MODES = [
  { key: 'production', label: 'Производство' },
  { key: 'query', label: 'Справки' }
]

function getSessionId() {
  let id = sessionStorage.getItem('agent_session_id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('agent_session_id', id)
  }
  return id
}

function newSession() {
  const id = crypto.randomUUID()
  sessionStorage.setItem('agent_session_id', id)
  return id
}

function ToolCallIcons({ toolCalls }) {
  const [expandedIdx, setExpandedIdx] = useState(null)

  if (!toolCalls || toolCalls.length === 0) return null

  return (
    <div className="tool-calls-row">
      {toolCalls.map((tc, idx) => (
        <div key={idx} className="tool-call-item">
          <button
            className={`tool-call-icon ${expandedIdx === idx ? 'active' : ''}`}
            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            title={tc.name}
          >
            {tc.name.replace(/^get_/, '').charAt(0).toUpperCase()}
          </button>
          {expandedIdx === idx && (
            <div className="tool-call-detail">
              <div className="tool-call-name">{tc.name}</div>
              <div className="tool-call-section">
                <strong>Request</strong>
                <pre>{JSON.stringify(tc.args, null, 2)}</pre>
              </div>
              {tc.result != null && (
                <div className="tool-call-section">
                  <strong>Response</strong>
                  <pre>{JSON.stringify(tc.result, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function AgentChat({ isOpen, onClose }) {
  const { user } = useAuth()
  const [mode, setMode] = useState('production')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [sessionId, setSessionId] = useState(getSessionId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const messagesEnd = useRef(null)
  const textareaRef = useRef(null)

  const scrollToBottom = useCallback(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Load history on open / session change
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    api('agent.history', { session_id: sessionId })
      .then(data => {
        if (!cancelled) setMessages(data.messages || [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isOpen, sessionId])

  // Auto-scroll on new messages
  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  // Load sessions when history panel opens
  const loadSessions = useCallback(async () => {
    if (!user?.id) return
    setSessionsLoading(true)
    try {
      const data = await api('agent.sessions', { personnel_id: user.id })
      setSessions(data.sessions || [])
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (historyOpen) loadSessions()
  }, [historyOpen, loadSessions])

  // Focus textarea on open
  useEffect(() => {
    if (isOpen) textareaRef.current?.focus()
  }, [isOpen])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const data = await api('agent.chat', {
        session_id: sessionId,
        personnel_id: user?.id,
        message: text,
        mode
      })
      setMessages(prev => [...prev, { role: 'assistant', content: data.response, tool_calls: data.tool_calls || [] }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Грешка: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleNewSession = () => {
    const id = newSession()
    setSessionId(id)
    setMessages([])
    setHistoryOpen(false)
  }

  const handleSelectSession = (sid) => {
    sessionStorage.setItem('agent_session_id', sid)
    setSessionId(sid)
    setHistoryOpen(false)
  }

  if (!isOpen) return null

  return (
    <div className={`agent-chat ${expanded ? 'agent-chat-expanded' : ''}`}>
      <div className="agent-chat-header">
        <h4>AI Асистент</h4>
        <div className="agent-chat-header-actions">
          <button onClick={handleNewSession} title="Нов разговор">
            <Plus size={14} />
          </button>
          <button onClick={() => setHistoryOpen(h => !h)} title="История">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          <button onClick={() => setExpanded(e => !e)} title={expanded ? 'Компактен изглед' : 'Цял екран'}>
            {expanded
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            }
          </button>
          <button onClick={onClose} title="Затвори">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {historyOpen && (
        <div className="agent-history-panel">
          <div className="agent-history-title">История на разговорите</div>
          {sessionsLoading ? (
            <div className="agent-history-loading">Зареждане...</div>
          ) : sessions.length === 0 ? (
            <div className="agent-history-empty">Няма предишни разговори</div>
          ) : (
            <div className="agent-history-list">
              {sessions.map(s => (
                <button
                  key={s.session_id}
                  className={`agent-history-item ${s.session_id === sessionId ? 'active' : ''}`}
                  onClick={() => handleSelectSession(s.session_id)}
                >
                  <span className="agent-history-preview">
                    {s.first_message
                      ? (s.first_message.length > 60
                          ? s.first_message.slice(0, 60) + '...'
                          : s.first_message)
                      : '(празен разговор)'}
                  </span>
                  <span className="agent-history-time">
                    {new Date(s.started_at).toLocaleDateString('bg-BG', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="agent-mode-toggle">
        {MODES.map(m => (
          <button key={m.key} className={mode === m.key ? 'active' : ''} onClick={() => setMode(m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="agent-messages">
        {messages.length === 0 && !loading && (
          <div className="agent-empty">
            {mode === 'production'
              ? 'Питайте за KPI, аларми, раждания, смъртност, халета...'
              : 'Задайте въпрос за данните — ще генерирам SQL заявка.'}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`agent-msg ${msg.role}`}>
            {msg.role === 'assistant' && msg.tool_calls?.length > 0 && (
              <ToolCallIcons toolCalls={msg.tool_calls} />
            )}
            {msg.role === 'assistant' ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            ) : (
              msg.content
            )}
          </div>
        ))}
        {loading && <div className="agent-msg thinking">Мисля...</div>}
        <div ref={messagesEnd} />
      </div>

      <div className="agent-input-area">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'production' ? 'Напр. Какви са текущите KPI?' : 'Напр. Колко свине-майки имаме?'}
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}><Send size={16} /></button>
      </div>
    </div>
  )
}
