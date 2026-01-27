import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../lib/socket';

let messageIdCounter = 0;

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'bot',
      type: 'text',
      message: 'Welcome to FuturesAI Chat.\nType "help" to see available commands.',
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Socket listener for replies
  useEffect(() => {
    const socket = getSocket();
    const onReply = (reply) => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: (reply.id || Date.now()) + '-reply',
        role: 'bot',
        type: reply.type || 'text',
        message: reply.message || '',
        data: reply.data || null,
        timestamp: reply.timestamp || Date.now()
      }]);
    };
    socket.on('chat:reply', onReply);
    return () => socket.off('chat:reply', onReply);
  }, []);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    const id = `msg-${++messageIdCounter}`;

    setMessages(prev => [...prev, {
      id,
      role: 'user',
      type: 'text',
      message: text,
      timestamp: Date.now()
    }]);

    setInput('');
    setIsTyping(true);

    // Timeout fallback for typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: id + '-timeout',
        role: 'bot',
        type: 'error',
        message: 'No response received. Server may be busy.',
        timestamp: Date.now()
      }]);
    }, 15000);

    const socket = getSocket();
    socket.emit('chat:message', { message: text, id });
  }, [input]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const renderMessage = (msg) => {
    if (msg.role === 'user') {
      return <div className="chat-msg-text">{msg.message}</div>;
    }

    // Bot message with optional rich data
    if ((msg.type === 'analysis' || msg.type === 'settings' || msg.type === 'positions') && msg.data) {
      return (
        <div className="chat-rich">
          <div className="chat-msg-text">{msg.message}</div>
          {msg.type === 'analysis' && msg.data && (
            <div className="chat-data-grid">
              {msg.data.signal && (
                <div className="chat-data-item">
                  <span>Signal</span>
                  <span className={msg.data.signal.includes('LONG') ? 'positive' : msg.data.signal.includes('SHORT') ? 'negative' : ''}>{msg.data.signal}</span>
                </div>
              )}
              {msg.data.confidence && <div className="chat-data-item"><span>Confidence</span><span>{msg.data.confidence}%</span></div>}
              {msg.data.price && <div className="chat-data-item"><span>Price</span><span>${msg.data.price}</span></div>}
              {msg.data.rsi && <div className="chat-data-item"><span>RSI</span><span>{msg.data.rsi}</span></div>}
              {msg.data.trend && <div className="chat-data-item"><span>Trend</span><span>{msg.data.trend}</span></div>}
              {msg.data.macd && <div className="chat-data-item"><span>MACD</span><span>{msg.data.macd}</span></div>}
            </div>
          )}
        </div>
      );
    }

    return <div className="chat-msg-text">{msg.message}</div>;
  };

  return (
    <>
      {/* Floating chat button */}
      <button
        className={`chat-fab ${isOpen ? 'chat-fab-active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle chat"
      >
        {isOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <div className="chat-panel-title">
              <div className="ai-icon" style={{ width: 22, height: 22, fontSize: '0.625rem', fontWeight: 700 }}>AI</div>
              <span>FuturesAI Assistant</span>
            </div>
            <button className="chat-close-btn" onClick={() => setIsOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="chat-messages">
            {messages.map(msg => (
              <div key={msg.id} className={`chat-msg chat-msg-${msg.role} ${msg.type === 'error' ? 'chat-msg-error' : ''}`}>
                {renderMessage(msg)}
              </div>
            ))}
            {isTyping && (
              <div className="chat-msg chat-msg-bot">
                <div className="chat-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <input
              ref={inputRef}
              className="chat-input"
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Type a command... (try "help")'
            />
            <button className="chat-send-btn" onClick={sendMessage} disabled={!input.trim() || isTyping}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
