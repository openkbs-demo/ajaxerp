import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
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
  const [sessionId, setSessionId] = useState(getSessionId)
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
  }

  if (!isOpen) return null

  return (
    <div className="agent-chat">
      <div className="agent-chat-header">
        <h4>AI Асистент</h4>
        <div className="agent-chat-header-actions">
          <button onClick={handleNewSession} title="Нов разговор">+</button>
          <button onClick={onClose} title="Затвори">&times;</button>
        </div>
      </div>

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
        <button onClick={handleSend} disabled={loading || !input.trim()}>&#9654;</button>
      </div>
    </div>
  )
}
