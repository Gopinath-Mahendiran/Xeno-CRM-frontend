import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE = 'http://127.0.0.1:8000';

// ──── Helpers ────────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('xeno_token');
const getUser  = () => {
  try { return JSON.parse(localStorage.getItem('xeno_user')); }
  catch { return null; }
};

const authHeaders = () => {
  const token = getToken();
  return token ? { Authorization: `Token ${token}` } : {};
};

const api = axios.create({ baseURL: API_BASE });
api.interceptors.request.use(config => {
  const token = getToken();
  if (token) config.headers.Authorization = `Token ${token}`;
  return config;
});

// ──── Icons ─────────────────────────────────────────────────────────────────
const Icons = {
  Chat: () => <span className="nav-icon"></span>,
  Campaigns: () => <span className="nav-icon"></span>,
  Customers: () => <span className="nav-icon"></span>,
  Segments: () => <span className="nav-icon"></span>,
  ArrowRight: () => <span>➔</span>,
  Send: () => <span>➤</span>,
  Plus: () => <span style={{ fontSize: '1.3rem', fontWeight: 700 }}>+</span>,
  Logout: () => <span style={{ fontSize: '0.9rem' }}>⏻</span>,
};


function App() {
  // ── View / Navigation State ──
  const [view, setView] = useState(() => {
    if (getToken()) return 'app';
    return 'login';
  });
  const [activeTab, setActiveTab] = useState('chat');
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'

  // ── Auth State ──
  const [user, setUser] = useState(getUser);
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // ── Chat State ──
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [chatSessions, setChatSessions] = useState([]);
  const chatBottomRef = useRef(null);

  // ── Data States ──
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignStats, setCampaignStats] = useState(null);
  const [campaignLogs, setCampaignLogs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [segments, setSegments] = useState([]);
  const [agentInfo, setAgentInfo] = useState({ provider: 'google', model: 'gemini-2.5-flash', is_local: false });

  // ── Segment Customer Drawer State ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSegment, setDrawerSegment] = useState(null);   // { id, name, natural_query }
  const [drawerCustomers, setDrawerCustomers] = useState([]);
  const [drawerTotal, setDrawerTotal] = useState(0);
  const [drawerPage, setDrawerPage] = useState(1);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerMode, setDrawerMode] = useState('preview'); // 'preview' | 'full'
  const [highlightedSegmentId, setHighlightedSegmentId] = useState(null);
  const DRAWER_PREVIEW_SIZE = 5;
  const DRAWER_PAGE_SIZE = 50;

  // ── Campaign Fire State ──
  const [firedCampaigns, setFiredCampaigns] = useState(() => {
    try { return JSON.parse(localStorage.getItem('xeno_fired_campaigns') || '[]'); }
    catch { return []; }
  });

  // ── Toast State ──
  const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });

  // ────────────────────────────────────────────────────────────────────────
  // Effects
  // ────────────────────────────────────────────────────────────────────────

  // Hash router
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (!getToken() && hash !== '#/login' && hash !== '#/register') {
        setView('login');
        return;
      }
      if (hash === '#/chat')       { setView('app'); setActiveTab('chat'); }
      else if (hash === '#/campaigns') { setView('app'); setActiveTab('campaigns'); }
      else if (hash === '#/customers') { setView('app'); setActiveTab('customers'); }
      else if (hash === '#/segments')  { setView('app'); setActiveTab('segments'); }
      else if (hash === '#/' || !hash) {
        setView(getToken() ? 'app' : 'login');
      }
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Scroll chat
  useEffect(() => {
    if (chatBottomRef.current) chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // Load data on view/tab change
  useEffect(() => {
    if (view === 'app') {
      fetchCampaigns(); fetchCustomers(); fetchSegments(); fetchAgentInfo();
      fetchChatSessions();
    }
  }, [view]);

  useEffect(() => {
    if (activeTab === 'campaigns') fetchCampaigns();
    else if (activeTab === 'customers') fetchCustomers();
    else if (activeTab === 'segments') fetchSegments();
  }, [activeTab]);

  // Poll selected campaign
  useEffect(() => {
    let intervalId = null;
    if (selectedCampaign?.id) {
      fetchCampaignStats(selectedCampaign.id);
      fetchCampaignLogs(selectedCampaign.id);
      if (selectedCampaign.status !== 'draft') {
        intervalId = setInterval(() => {
          fetchCampaignDetail(selectedCampaign.id);
          fetchCampaignStats(selectedCampaign.id);
          fetchCampaignLogs(selectedCampaign.id);
        }, 1500);
      }
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [selectedCampaign?.id, selectedCampaign?.status]);

  // Persist fired campaigns
  useEffect(() => {
    localStorage.setItem('xeno_fired_campaigns', JSON.stringify(firedCampaigns));
  }, [firedCampaigns]);

  // ────────────────────────────────────────────────────────────────────────
  // Auth Functions
  // ────────────────────────────────────────────────────────────────────────

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register/' : '/api/auth/login/';
      const payload = authMode === 'register'
        ? { username: authForm.username, email: authForm.email, password: authForm.password }
        : { username: authForm.username, password: authForm.password };
      const res = await axios.post(`${API_BASE}${endpoint}`, payload);

      localStorage.setItem('xeno_token', res.data.token);
      localStorage.setItem('xeno_user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      setView('app');
      setActiveTab('chat');
      window.location.hash = '#/chat';
    } catch (err) {
      const data = err.response?.data;
      if (data) {
        const msgs = typeof data === 'object'
          ? Object.values(data).flat().join(' ')
          : String(data);
        setAuthError(msgs);
      } else {
        setAuthError('Network error. Is the backend running?');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    api.post('/api/auth/logout/').catch(() => {});
    localStorage.removeItem('xeno_token');
    localStorage.removeItem('xeno_user');
    setUser(null);
    setView('login');
    setMessages([]);
    setChatSessions([]);
    setCurrentSessionId(null);
    window.location.hash = '#/login';
  };

  // ────────────────────────────────────────────────────────────────────────
  // Chat Session Functions
  // ────────────────────────────────────────────────────────────────────────

  const fetchChatSessions = async () => {
    try {
      const res = await api.get('/api/chat/sessions/');
      const sessions = res.data.results || [];
      setChatSessions(sessions);
      // Auto-select most recent session or create new one
      if (sessions.length > 0 && !currentSessionId) {
        loadSession(sessions[0]);
      } else if (sessions.length === 0 && !currentSessionId) {
        handleNewChat();
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    }
  };

  const loadSession = async (session) => {
    setCurrentSessionId(session.session_id);
    try {
      const res = await api.get(`/api/chat/sessions/${session.session_id}/messages/`);
      const dbMessages = (res.data.results || []).map(msg => ({
        sender: msg.role === 'human' ? 'user' : 'ai',
        text: msg.content,
        toolUsed: msg.tool_used || null,
        toolResult: msg.tool_result || null,
      }));
      if (dbMessages.length === 0) {
        setMessages([{
          sender: 'ai',
          text: "Hi! I am Xeno AI, your CRM campaign specialist. Tell me what audience segment you'd like to query or what campaign you want to launch today!",
          toolUsed: null, toolResult: null
        }]);
      } else {
        setMessages(dbMessages);
      }
    } catch (err) {
      console.error('Error loading session history:', err);
      setMessages([{
        sender: 'ai', text: "Hi! I am Xeno AI. What campaign would you like to create?",
        toolUsed: null, toolResult: null
      }]);
    }
  };

  const handleNewChat = async () => {
    try {
      const res = await api.post('/api/chat/sessions/create/');
      const newSession = res.data;
      setCurrentSessionId(newSession.session_id);
      setMessages([{
        sender: 'ai',
        text: "Hi! I am Xeno AI, your CRM campaign specialist. Tell me what audience segment you'd like to query or what campaign you want to launch today!",
        toolUsed: null, toolResult: null
      }]);
      // Refresh session list
      fetchChatSessions();
    } catch (err) {
      console.error('Error creating session:', err);
      // Fallback: generate local session
      const fallbackId = `session-${Date.now()}`;
      setCurrentSessionId(fallbackId);
      setMessages([{
        sender: 'ai', text: "Hi! I am Xeno AI. What campaign would you like to create?",
        toolUsed: null, toolResult: null
      }]);
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // API Calls
  // ────────────────────────────────────────────────────────────────────────

  const showToast = (text, type = 'info') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage({ text: '', type: '' }), 4000);
  };

  const fetchAgentInfo = async () => {
    try { const res = await api.get('/api/agent/info/'); setAgentInfo(res.data); }
    catch (err) { console.error('Error fetching agent info:', err); }
  };

  const fetchCampaigns = async () => {
    try { const res = await api.get('/api/campaigns/'); setCampaigns(res.data.results || []); }
    catch (err) { showToast('Failed to load campaigns', 'error'); }
  };

  const fetchCustomers = async (search = '') => {
    try { const res = await api.get(`/api/customers/?search=${search}`); setCustomers(res.data.results || []); }
    catch (err) { console.error('Error fetching customers:', err); }
  };

  const fetchSegments = async () => {
    try { const res = await api.get('/api/segments/'); setSegments(res.data.results || []); }
    catch (err) { console.error('Error fetching segments:', err); }
  };

  // ── Segment Customer Drawer ──
  const openSegmentDrawer = async (seg) => {
    // Always open in preview mode first (5 rows)
    setDrawerSegment(seg);
    setDrawerMode('preview');
    setDrawerOpen(true);
    setDrawerPage(1);
    setDrawerLoading(true);
    setDrawerCustomers([]);
    setDrawerTotal(0);
    try {
      const res = await api.get(`/api/segments/${seg.id}/preview/`, {
        params: { page: 1, page_size: DRAWER_PREVIEW_SIZE },
      });
      setDrawerCustomers(res.data.results || []);
      setDrawerTotal(res.data.customer_count || 0);
    } catch (err) {
      console.error('Error loading segment preview:', err);
    } finally {
      setDrawerLoading(false);
    }
  };

  const loadFullList = async (page = 1) => {
    setDrawerMode('full');
    setDrawerPage(page);
    setDrawerLoading(true);
    setDrawerCustomers([]);
    try {
      const res = await api.get(`/api/segments/${drawerSegment.id}/preview/`, {
        params: { page, page_size: DRAWER_PAGE_SIZE },
      });
      setDrawerCustomers(res.data.results || []);
      setDrawerTotal(res.data.customer_count || 0);
    } catch (err) {
      console.error('Error loading full segment list:', err);
    } finally {
      setDrawerLoading(false);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setDrawerSegment(null);
    setDrawerCustomers([]);
    setDrawerTotal(0);
    setDrawerPage(1);
    setDrawerMode('preview');
  };

  // Navigate to Segments tab and highlight + open the relevant segment
  const goToSegment = (seg) => {
    closeDrawer();
    setHighlightedSegmentId(seg.id);
    setActiveTab('segments');
    window.location.hash = '#/segments';
    // After segments load, auto-open the drawer for that segment
    setTimeout(() => {
      openSegmentDrawer(seg);
      // Scroll the highlighted card into view
      const el = document.getElementById(`segment-card-${seg.id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    // Clear highlight after 3 s
    setTimeout(() => setHighlightedSegmentId(null), 3500);
  };

  const drawerTotalPages = Math.ceil(drawerTotal / DRAWER_PAGE_SIZE);

  const fetchCampaignStats = async (id) => {
    try { const res = await api.get(`/api/campaigns/${id}/stats/`); setCampaignStats(res.data); }
    catch (err) { console.error('Error fetching stats:', err); }
  };

  const fetchCampaignLogs = async (id) => {
    try { const res = await api.get(`/api/campaigns/${id}/logs/`); setCampaignLogs(res.data.results || []); }
    catch (err) { console.error('Error fetching logs:', err); }
  };

  const fetchCampaignDetail = async (id) => {
    try { const res = await api.get(`/api/campaigns/${id}/`); setSelectedCampaign(res.data); }
    catch (err) { console.error('Error fetching campaign detail:', err); }
  };

  const handleSelectCampaign = (c) => {
    setSelectedCampaign(c);
    fetchCampaignDetail(c.id);
  };

  const handleSearchChange = (e) => {
    setCustomerSearch(e.target.value);
    fetchCustomers(e.target.value);
  };

  // ── Send Chat Message ──
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !currentSessionId) return;
    const userMsg = inputText.trim();
    setInputText('');
    setMessages(prev => [...prev, { sender: 'user', text: userMsg }]);
    setChatLoading(true);

    try {
      const res = await api.post('/api/chat/', {
        message: userMsg,
        session_id: currentSessionId,
      });
      const reply = res.data.reply || "No reply from agent";
      const toolUsed = res.data.tool_used;
      let toolResultParsed = null;
      if (res.data.tool_result) {
        try {
          toolResultParsed = typeof res.data.tool_result === 'string'
            ? JSON.parse(res.data.tool_result) : res.data.tool_result;
        } catch { toolResultParsed = res.data.tool_result; }
      }

      setMessages(prev => [...prev, {
        sender: 'ai', text: reply,
        toolUsed: toolUsed, toolResult: toolResultParsed
      }]);

      if (toolUsed === 'create_campaign') fetchCampaigns();
      // Refresh sessions to update title & last_message
      fetchChatSessions();
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: 'Sorry, I encountered an error. Please make sure the backend and model are running.',
        toolUsed: null, toolResult: null
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Fire Campaign ──
  const handleFireCampaign = async (id) => {
    try {
      const res = await api.post(`/api/campaigns/${id}/fire/`);
      showToast(res.data.message || 'Campaign fired successfully', 'success');
      // Mark as fired persistently
      setFiredCampaigns(prev => [...new Set([...prev, id])]);
      fetchCampaigns();
      if (selectedCampaign && selectedCampaign.id === id) {
        fetchCampaignDetail(id);
        fetchCampaignStats(id);
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to fire campaign', 'error');
    }
  };

  const isCampaignFired = (id) => firedCampaigns.includes(id);

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="w-full flex min-h-screen">

      {/* ═══════════════════════ LOGIN / REGISTER ═══════════════════════ */}
      {view === 'login' && (
        <div className="login-container">
          <div className="login-backdrop"></div>
          <div className="login-card">
            <div className="login-logo">
              <div className="login-logo-icon">X</div>
              <h1 className="login-title">Xeno CRM</h1>
              <p className="login-subtitle">AI-Powered Campaign Intelligence</p>
            </div>

            <div className="login-tabs">
              <button
                className={`login-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => { setAuthMode('login'); setAuthError(''); }}
              >Sign In</button>
              <button
                className={`login-tab ${authMode === 'register' ? 'active' : ''}`}
                onClick={() => { setAuthMode('register'); setAuthError(''); }}
              >Create Account</button>
            </div>

            <form className="login-form" onSubmit={handleAuth}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Enter your username"
                  value={authForm.username}
                  onChange={e => setAuthForm(p => ({...p, username: e.target.value}))}
                  required
                />
              </div>

              {authMode === 'register' && (
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input"
                    type="email"
                    placeholder="you@company.com"
                    value={authForm.email}
                    onChange={e => setAuthForm(p => ({...p, email: e.target.value}))}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="••••••••"
                  value={authForm.password}
                  onChange={e => setAuthForm(p => ({...p, password: e.target.value}))}
                  required
                  minLength={6}
                />
              </div>

              {authError && (
                <div className="form-error">{authError}</div>
              )}

              <button className="btn-auth" type="submit" disabled={authLoading}>
                {authLoading
                  ? <span className="loading-dots"><span></span><span></span><span></span></span>
                  : (authMode === 'login' ? 'Sign In' : 'Create Account')
                }
              </button>
            </form>

            <div className="login-footer-text">
              {authMode === 'login'
                ? <>Don't have an account? <button className="link-btn" onClick={() => setAuthMode('register')}>Sign up</button></>
                : <>Already have an account? <button className="link-btn" onClick={() => setAuthMode('login')}>Sign in</button></>
              }
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ LANDING PAGE ═══════════════════════════ */}
      {view === 'landing' && (
        <div className="landing-container">
          <div className="landing-header">
            <div className="landing-badge">
              <span className="status-dot"></span> Xeno CRM Agent Engine v2.5
            </div>
            <h1 className="landing-title">Xeno CRM AI</h1>
            <p className="landing-subtitle">
              An autonomous agentic CRM campaign planner. Segment audiences, write personalized copies, and track real-time campaign funnels via advanced Google Gemini-driven agents.
            </p>
          </div>
          <div className="landing-cta">
            <button className="btn-primary" onClick={() => { window.location.hash = '#/chat'; }}>
              Launch AI Workspace <Icons.ArrowRight />
            </button>
          </div>
          <div className="landing-features">
            <div className="feature-card">
              <div className="feature-icon-wrapper icon-purple">💬</div>
              <h3 className="feature-title">AI Agent Chatbot</h3>
              <p className="feature-desc">Simply state your target audience. The Gemini agent automatically parses parameters to build segments.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon-wrapper icon-green">📝</div>
              <h3 className="feature-title">Personalized Copywriter</h3>
              <p className="feature-desc">Drafts specific messages optimized for WhatsApp, SMS, or Email using tailored regional hooks.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon-wrapper icon-blue">📊</div>
              <h3 className="feature-title">Live Funnel Fun</h3>
              <p className="feature-desc">Fire campaigns immediately and inspect real-time progress bars as users open, click, and purchase.</p>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ APP SHELL ═══════════════════════════════ */}
      {view === 'app' && (
        <div className="app-container">
          {/* Sidebar */}
          <div className="sidebar">
            <div className="logo-section">
              <div className="logo-icon">X</div>
              <div className="logo-text">Xeno CRM</div>
              <div className="logo-badge">AI</div>
            </div>

            <ul className="nav-links">
              <li className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
                  onClick={() => { window.location.hash = '#/chat'; }}>
                <Icons.Chat /> Live Chat Agent
              </li>
              <li className={`nav-item ${activeTab === 'campaigns' ? 'active' : ''}`}
                  onClick={() => { window.location.hash = '#/campaigns'; }}>
                <Icons.Campaigns /> Campaigns
              </li>
              <li className={`nav-item ${activeTab === 'customers' ? 'active' : ''}`}
                  onClick={() => { window.location.hash = '#/customers'; }}>
                <Icons.Customers /> Customers
              </li>
              <li className={`nav-item ${activeTab === 'segments' ? 'active' : ''}`}
                  onClick={() => { window.location.hash = '#/segments'; }}>
                <Icons.Segments /> Segments
              </li>
            </ul>

            <div className="sidebar-footer">
              <div className="status">
                <span className="status-dot"></span> Agent Active
              </div>
              <div style={{ textTransform: 'capitalize', fontSize: '0.75rem', color: '#94a3b8' }}>
                Model: {agentInfo.model} ({agentInfo.is_local ? 'Local' : 'Gemini'})
              </div>
              {user && (
                <div className="user-profile-badge">
                  <div className="user-avatar">{user.username?.[0]?.toUpperCase() || 'U'}</div>
                  <div className="user-info">
                    <span className="user-name">{user.username}</span>
                    <span className="user-email">{user.email}</span>
                  </div>
                  <button className="btn-logout" onClick={handleLogout} title="Logout">
                    <Icons.Logout />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Main workspace */}
          <div className="main-content">
            <div className="top-bar">
              <div className="top-bar-title">
                {activeTab === 'chat' && 'AI Campaign Planner'}
                {activeTab === 'campaigns' && 'Campaign Funnel Dashboard'}
                {activeTab === 'customers' && 'Customer Database'}
                {activeTab === 'segments' && 'Saved Audience Segments'}
              </div>
              <div className="session-info">
                {currentSessionId && activeTab === 'chat' && (
                  <><span>Session:</span> <strong>{currentSessionId.substring(0, 16)}…</strong></>
                )}
              </div>
            </div>

            {/* View Panes */}
            <div className="view-pane">

              {/* ═══════ TAB 1: CHATBOT ═══════ */}
              {activeTab === 'chat' && (
                <div className="chat-layout">
                  {/* Chat Sessions Sidebar */}
                  <div className="chat-sessions-panel">
                    <div className="sessions-header">
                      <span className="sessions-title">Conversations</span>
                      <button className="btn-new-chat" onClick={handleNewChat} title="New Chat">
                        <Icons.Plus />
                      </button>
                    </div>
                    <div className="sessions-list">
                      {chatSessions.map(session => (
                        <div
                          key={session.session_id}
                          className={`session-item ${currentSessionId === session.session_id ? 'active' : ''}`}
                          onClick={() => loadSession(session)}
                        >
                          <div className="session-item-title">{session.title || 'New Chat'}</div>
                          <div className="session-item-meta">
                            <span>{session.message_count} msgs</span>
                            <span>{new Date(session.updated_at).toLocaleDateString()}</span>
                          </div>
                          {session.last_message && (
                            <div className="session-item-preview">{session.last_message}</div>
                          )}
                        </div>
                      ))}
                      {chatSessions.length === 0 && (
                        <div className="sessions-empty">No conversations yet. Start a new chat!</div>
                      )}
                    </div>
                  </div>

                  {/* Chat Main Area */}
                  <div className="chat-container">
                    <div className="chat-messages">
                      {messages.map((msg, index) => (
                        <div key={index} className={`chat-bubble-row ${msg.sender}`}>
                          <div className="avatar">
                            {msg.sender === 'user'
                              ? (user?.username?.[0]?.toUpperCase() || 'M')
                              : '🤖'}
                          </div>
                          <div className="flex flex-col gap-2 w-full">
                            <div className="bubble">
                              <p>{msg.text}</p>
                            </div>

                            {/* Render agent tool cards */}
                            {msg.toolUsed && msg.toolResult && (
                              <div className="tool-container">
                                <div className="tool-header">
                                  ⚙️ Agent called tool: <strong>{msg.toolUsed}</strong>
                                </div>
                                <div className="tool-body">

                                  {/* Tool 1: segment_customers */}
                                  {msg.toolUsed === 'segment_customers' && (
                                    <div className="segment-results">
                                      <div className="flex justify-between items-center">
                                        <div>
                                          <div className="box-label">Audience Size</div>
                                          <div className="segment-count-badge">
                                            {msg.toolResult.count} Customers Found
                                          </div>
                                        </div>
                                        {msg.toolResult.segment_id ? (
                                          <button className="btn-sim" onClick={() => openSegmentDrawer({
                                            id: msg.toolResult.segment_id,
                                            name: msg.toolResult.segment_name || 'Segment',
                                            natural_query: '',
                                          })}>
                                            👁 View Customers
                                          </button>
                                        ) : (
                                          <button className="btn-sim" onClick={() => { window.location.hash = '#/segments'; setActiveTab('segments'); }}>
                                            View in Segments
                                          </button>
                                        )}
                                      </div>
                                      {msg.toolResult.filters && (
                                        <div>
                                          <div className="box-label">Matched Filters</div>
                                          <div className="filters-pill-container">
                                            {msg.toolResult.filters.rules?.map((rule, idx) => (
                                              <span key={idx} className="filter-pill">
                                                {rule.field} {rule.operator} {rule.value}
                                              </span>
                                            ))}
                                            {msg.toolResult.filters.rules?.length === 0 && (
                                              <span className="filter-pill">All Database (No Filters)</span>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                      {msg.toolResult.preview && msg.toolResult.preview.length > 0 && (
                                        <div>
                                          <div className="box-label">Sample Preview</div>
                                          <div className="overflow-x-auto">
                                            <table className="customer-table-preview">
                                              <thead><tr><th>Name</th><th>City</th><th>Spent</th><th>Orders</th></tr></thead>
                                              <tbody>
                                                {msg.toolResult.preview.map((c, cidx) => (
                                                  <tr key={cidx}><td>{c.name}</td><td>{c.city}</td><td>₹{c.total_spent}</td><td>{c.order_count}</td></tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Tool 2: draft_message */}
                                  {msg.toolUsed === 'draft_message' && (
                                    <div>
                                      <div className="box-label">SMS/WhatsApp Live Preview</div>
                                      <div className="phone-mockup">
                                        <div className="phone-screen">
                                          <div className="whatsapp-bubble">
                                            {msg.toolResult.message || msg.toolResult.error}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="message-draft-meta">
                                        <span>Channel: <strong className="text-purple-400 capitalize">{msg.toolResult.channel}</strong></span>
                                      </div>
                                    </div>
                                  )}

                                  {/* Tool 3: create_campaign */}
                                  {msg.toolUsed === 'create_campaign' && (
                                    <div className="campaign-success">
                                      <span className="success-badge">✓ Campaign Created</span>
                                      <div>
                                        <h3>{msg.toolResult.name}</h3>
                                        <p className="text-sm text-gray-400 mt-1">
                                          Targets {msg.toolResult.audience_size} customers via {msg.toolResult.channel} (ID: {msg.toolResult.campaign_id})
                                        </p>
                                      </div>
                                      {msg.toolResult.message && (
                                        <div className="template-card-enhanced">
                                          <div className="template-card-header">
                                            <span className="template-channel-icon">
                                              {msg.toolResult.channel === 'whatsapp' ? '💬' : msg.toolResult.channel === 'sms' ? '📱' : msg.toolResult.channel === 'email' ? '📧' : '📨'}
                                            </span>
                                            <span className="template-channel-label">
                                              {msg.toolResult.channel?.toUpperCase()} Template
                                            </span>
                                            <span className="template-check">✓✓</span>
                                          </div>
                                          <div className="template-card-body">
                                            <p className="template-msg-text">{msg.toolResult.message}</p>
                                          </div>
                                          <div className="template-card-footer">
                                            <span className="template-time">{new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
                                            <span className="template-status">Saved ✓</span>
                                          </div>
                                        </div>
                                      )}
                                      <button
                                        className={`btn-fire ${isCampaignFired(msg.toolResult.campaign_id) ? 'fired' : ''}`}
                                        onClick={() => handleFireCampaign(msg.toolResult.campaign_id)}
                                        disabled={isCampaignFired(msg.toolResult.campaign_id)}
                                      >
                                        {isCampaignFired(msg.toolResult.campaign_id)
                                          ? '✓ Campaign Fired'
                                          : '🚀 Fire Campaign Now'
                                        }
                                      </button>
                                    </div>
                                  )}

                                  {/* Tool 4: get_stats */}
                                  {msg.toolUsed === 'get_stats' && (
                                    <div>
                                      <div className="box-label">Campaign Stats</div>
                                      <h4 className="font-semibold mb-3">{msg.toolResult.name} (Status: {msg.toolResult.status})</h4>
                                      <div className="funnel-container">
                                        {[
                                          { label: 'Sent', value: msg.toolResult.sent, pct: 100, cls: 'bar-sent' },
                                          { label: 'Delivered', value: msg.toolResult.delivered, pct: msg.toolResult.delivery_rate, cls: 'bar-delivered' },
                                          { label: 'Read', value: msg.toolResult.read, pct: msg.toolResult.read_rate, cls: 'bar-read' },
                                        ].map(s => (
                                          <div className="funnel-stage" key={s.label}>
                                            <div className="stage-label-row"><span>{s.label}</span><strong>{s.value} ({s.pct}%)</strong></div>
                                            <div className="stage-bar-outer">
                                              <div className={`stage-bar-inner ${s.cls}`} style={{ width: `${s.pct}%` }}></div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="chat-bubble-row ai">
                          <div className="avatar">🤖</div>
                          <div className="bubble">
                            <div className="loading-dots"><span></span><span></span><span></span></div>
                          </div>
                        </div>
                      )}
                      <div ref={chatBottomRef} />
                    </div>

                    <form className="chat-input-area" onSubmit={handleSendMessage}>
                      <div className="chat-input-wrapper">
                        <input
                          type="text"
                          className="chat-input"
                          placeholder="Type a campaign command (e.g. 'Find customers who spent > 5000')..."
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          disabled={chatLoading}
                        />
                        <button className="btn-send" type="submit" disabled={chatLoading || !inputText.trim()}>
                          <Icons.Send />
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* ═══════ TAB 2: CAMPAIGNS DASHBOARD ═══════ */}
              {activeTab === 'campaigns' && (
                <div className="dashboard-grid">
                  <div className="campaigns-list-card">
                    <div className="panel-title">Campaigns</div>
                    <div className="campaign-list-scroll">
                      {campaigns.map((c) => (
                        <div
                          key={c.id}
                          className={`campaign-item ${selectedCampaign?.id === c.id ? 'selected' : ''}`}
                          onClick={() => handleSelectCampaign(c)}
                        >
                          <div className="campaign-meta-row">
                            <span className="campaign-name">{c.name}</span>
                            <span className={`badge-status status-${c.status}`}>{c.status}</span>
                          </div>
                          <div className="campaign-info-sub">
                            <span>ID: {c.id}</span>
                            <span>Channel: {c.channel}</span>
                            <span>Audience: {c.segment?.customer_count}</span>
                          </div>
                        </div>
                      ))}
                      {campaigns.length === 0 && (
                        <div className="text-center text-gray-500 py-10">No campaigns found. Create one with the AI chat!</div>
                      )}
                    </div>
                  </div>

                  <div className="campaign-details-card">
                    {selectedCampaign ? (
                      <div>
                        <div className="detail-header">
                          <div className="detail-title">{selectedCampaign.name}</div>
                          <div className="flex gap-3">
                            <span className={`badge-status status-${selectedCampaign.status}`}>{selectedCampaign.status}</span>
                            <span className="text-sm text-gray-400">Channel: <strong className="capitalize">{selectedCampaign.channel}</strong></span>
                          </div>
                        </div>

                        <div className="detail-grid">
                          <div className="detail-item-box">
                            <div className="box-label">Audience Segment</div>
                            <div className="box-value">{selectedCampaign.segment?.name || 'Loading...'}</div>
                          </div>
                          <div className="detail-item-box">
                            <div className="box-label">Audience Size</div>
                            <div className="box-value-large">{selectedCampaign.segment?.customer_count}</div>
                          </div>
                        </div>

                        {/* Enhanced Message Template Display */}
                        <div className="detail-item-box mb-6">
                          <div className="template-card-enhanced">
                            <div className="template-card-header">
                              <span className="template-channel-icon">
                                {selectedCampaign.channel === 'whatsapp' ? '💬' : selectedCampaign.channel === 'sms' ? '📱' : selectedCampaign.channel === 'email' ? '📧' : '📨'}
                              </span>
                              <span className="template-channel-label">
                                {selectedCampaign.channel?.toUpperCase()} Template
                              </span>
                              <span className="template-check">✓✓</span>
                            </div>
                            <div className="template-card-body">
                              <p className="template-msg-text">{selectedCampaign.message_template}</p>
                            </div>
                            <div className="template-card-footer">
                              <span className="template-time">{new Date(selectedCampaign.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
                              <span className="template-status">Saved ✓</span>
                            </div>
                          </div>
                        </div>

                        {selectedCampaign.status === 'draft' && !isCampaignFired(selectedCampaign.id) && (
                          <div className="mb-8">
                            <button
                              className="btn-fire w-full py-4 text-lg"
                              onClick={() => handleFireCampaign(selectedCampaign.id)}
                            >
                              🚀 Fire Campaign Immediately
                            </button>
                          </div>
                        )}
                        {isCampaignFired(selectedCampaign.id) && selectedCampaign.status === 'draft' && (
                          <div className="mb-8">
                            <button className="btn-fire fired w-full py-4 text-lg" disabled>
                              ✓ Campaign Fired
                            </button>
                          </div>
                        )}

                        {campaignStats && (
                          <div className="funnel-container">
                            <div className="panel-title">Real-Time Funnel Statistics</div>
                            <div className="detail-grid">
                              <div className="detail-item-box">
                                <div className="box-label">Sent Messages</div>
                                <div className="box-value">{campaignStats.sent}</div>
                              </div>
                              <div className="detail-item-box">
                                <div className="box-label">Delivered Rate</div>
                                <div className="box-value text-green-400">{campaignStats.delivery_rate}%</div>
                              </div>
                            </div>
                            {[
                              { label: 'Sent', val: campaignStats.sent, pct: 100, cls: 'bar-sent' },
                              { label: 'Delivered', val: campaignStats.delivered, pct: campaignStats.delivery_rate, cls: 'bar-delivered', extra: `(${campaignStats.delivery_rate}%)` },
                              { label: 'Read', val: campaignStats.read, pct: campaignStats.read_rate, cls: 'bar-read', extra: `(${campaignStats.read_rate}%)` },
                              { label: 'Clicked', val: campaignStats.clicked, pct: campaignStats.click_rate, cls: 'bar-clicked', extra: `(${campaignStats.click_rate}%)` },
                              { label: 'Ordered', val: campaignStats.ordered, pct: (campaignStats.ordered / (campaignStats.sent || 1)) * 100, cls: 'bar-ordered' },
                            ].map(s => (
                              <div className="funnel-stage" key={s.label}>
                                <div className="stage-label-row"><span>{s.label}</span><strong>{s.val} {s.extra || ''}</strong></div>
                                <div className="stage-bar-outer">
                                  <div className={`stage-bar-inner ${s.cls}`} style={{ width: `${s.pct}%` }}>{s.pct >= 10 ? `${Math.round(s.pct)}%` : ''}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-500">
                        Select a campaign from the list to view live statistics and fire options.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ═══════ TAB 3: CUSTOMERS ═══════ */}
              {activeTab === 'customers' && (
                <div className="table-container">
                  <div className="controls-row">
                    <input
                      type="text" className="search-input"
                      placeholder="Search name, phone, email..."
                      value={customerSearch} onChange={handleSearchChange}
                    />
                    <div className="text-sm text-gray-400 flex items-center">Showing {customers.length} records</div>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>City</th><th>Total Spent</th><th>Orders</th></tr></thead>
                      <tbody>
                        {customers.map((c) => (
                          <tr key={c.id}>
                            <td>{c.id}</td><td><strong>{c.name}</strong></td><td>{c.email}</td>
                            <td>{c.phone}</td><td>{c.city}</td><td>₹{c.total_spent}</td><td>{c.order_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ═══════ TAB 4: SEGMENTS ═══════ */}
              {activeTab === 'segments' && (
                <div className="segments-grid">
                  {segments.map((seg) => (
                    <div
                      key={seg.id}
                      id={`segment-card-${seg.id}`}
                      className={`segment-card ${highlightedSegmentId === seg.id ? 'segment-card-highlighted' : ''}`}
                    >
                      {highlightedSegmentId === seg.id && (
                        <div className="segment-highlight-badge">📍 Navigated from Chat</div>
                      )}
                      <h3 className="segment-card-title">{seg.name}</h3>
                      <p className="segment-card-desc">{seg.natural_query || 'Custom filter segmentation rules'}</p>
                      <div className="segment-card-stat">
                        <span>Audience Count:</span>
                        <strong className="segment-card-stat-val">{seg.customer_count}</strong>
                      </div>
                      <button
                        className="btn-view-customers"
                        onClick={() => openSegmentDrawer(seg)}
                      >
                        👁 View Customers
                      </button>
                    </div>
                  ))}
                  {segments.length === 0 && (
                    <div className="col-span-3 text-center text-gray-500 py-20">
                      No segments found. Instruct the Chatbot to find one!
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ══════════════ SEGMENT CUSTOMER DRAWER ══════════════ */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={closeDrawer}>
          <div className="drawer-panel" onClick={e => e.stopPropagation()}>

            {/* Drawer Header */}
            <div className="drawer-header">
              <div className="drawer-header-left">
                <div className="drawer-title">{drawerSegment?.name}</div>
                {drawerSegment?.natural_query && (
                  <div className="drawer-subtitle">🎯 {drawerSegment.natural_query}</div>
                )}
              </div>
              <div className="drawer-header-right">
                <div className="drawer-count-badge">
                  {drawerLoading ? '…' : drawerTotal} customers
                </div>
                <button className="drawer-close" onClick={closeDrawer}>✕</button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="drawer-body">
              {drawerLoading ? (
                <div className="drawer-loading">
                  <div className="drawer-spinner"></div>
                  <span>{drawerMode === 'preview' ? 'Loading preview…' : 'Loading full list…'}</span>
                </div>
              ) : drawerCustomers.length === 0 ? (
                <div className="drawer-empty">No customers match this segment's filters.</div>
              ) : (
                <div className="drawer-table-wrap">
                  <table className="drawer-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>City</th>
                        <th>Total Spent</th>
                        <th>Orders</th>
                        <th>Last Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drawerCustomers.map((c, idx) => (
                        <tr key={c.id} className="drawer-row">
                          <td className="drawer-cell-dim">
                            {drawerMode === 'full'
                              ? (drawerPage - 1) * DRAWER_PAGE_SIZE + idx + 1
                              : idx + 1}
                          </td>
                          <td><strong>{c.name}</strong></td>
                          <td className="drawer-cell-dim">{c.email}</td>
                          <td>{c.phone}</td>
                          <td><span className="drawer-city-pill">{c.city}</span></td>
                          <td className="drawer-cell-spent">₹{Number(c.total_spent).toLocaleString()}</td>
                          <td>{c.order_count}</td>
                          <td className="drawer-cell-dim">
                            {c.last_order_at ? new Date(c.last_order_at).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Preview banner — shows only in preview mode */}
                  {drawerMode === 'preview' && (
                    <div className="drawer-preview-banner">
                      <span className="drawer-preview-hint">
                        Showing {drawerCustomers.length} of {drawerTotal} customers
                      </span>
                      <button
                        className="drawer-load-full-btn"
                        onClick={() => goToSegment(drawerSegment)}
                      >
                        🔗 View in Segments ({drawerTotal})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pagination — only in full mode */}
            {!drawerLoading && drawerMode === 'full' && drawerTotalPages > 1 && (
              <div className="drawer-pagination">
                <button
                  className="drawer-page-btn"
                  disabled={drawerPage <= 1}
                  onClick={() => loadFullList(drawerPage - 1)}
                >← Prev</button>
                <span className="drawer-page-info">
                  Page {drawerPage} of {drawerTotalPages}
                  &nbsp;·&nbsp; {drawerTotal} total
                </span>
                <button
                  className="drawer-page-btn"
                  disabled={drawerPage >= drawerTotalPages}
                  onClick={() => loadFullList(drawerPage + 1)}
                >Next →</button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Floating status Toast */}
      {statusMessage.text && (
        <div className={`fixed bottom-8 right-8 px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3 border z-50 text-sm font-semibold transition-all duration-300 ${
          statusMessage.type === 'success' ? 'bg-emerald-950 border-emerald-500 text-emerald-300' :
          statusMessage.type === 'error' ? 'bg-red-950 border-red-500 text-red-300' :
          'bg-slate-900 border-slate-700 text-slate-200'
        }`}>
          <span>🔔</span> {statusMessage.text}
        </div>
      )}
    </div>
  );
}

export default App;
