import { useState, useEffect } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import axios from 'axios'
import stravaConnectBtn from './assets/btn_strava_connectwith_orange.svg';
import stravaPoweredBy from './assets/api_logo_pwrdBy_strava_horiz_white.svg';
import './App.css'
import ReactGA from 'react-ga4';

function App({ dynamicConfig }) {
  const API_URL = dynamicConfig?.VITE_API_URL || import.meta.env.VITE_API_URL;
  const STRAVA_CLIENT_ID = dynamicConfig?.VITE_STRAVA_CLIENT_ID || import.meta.env.VITE_STRAVA_CLIENT_ID;
  const REDIRECT_URI = window.location.origin;

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: 'error', fading: false }); // type: 'error' | 'success'
  const [calendars, setCalendars] = useState([]);
  const [isEditingCalendar, setIsEditingCalendar] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  const showMessage = (text, type = 'error') => {
    setMsg({ text, type, fading: false });
    if (type === 'success') {
      setTimeout(() => {
        setMsg(prev => ({ ...prev, fading: true }));
        setTimeout(() => setMsg({ text: '', type: 'error', fading: false }), 500);
      }, 5000);
    }
  };

  // Check for Strava Callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const scope = params.get('scope');

    if (code && !user) {
      // We need the user to be logged in with Google first to link account. 
      // If we are coming back from Strava, we better have the user in localStorage or memory.
      const storedUser = localStorage.getItem('strava_gcal_user');
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        linkStrava(parsedUser.googleUserId, code);
      } else {
        showMessage('Please login with Google first (Session lost).');
      }
      // Clean URL back to root to remove OAuth query parameters
      window.history.replaceState({}, document.title, '/');
    }

    // Auto-fetch calendars on load if we have a user in session
    const storedUser = localStorage.getItem('strava_gcal_user');
    const token = localStorage.getItem('strava_gcal_token');
    if (storedUser && token && !user && !code) {
      setUser(JSON.parse(storedUser));
      fetchCalendars(token);
    }

    // Track initial page view
    ReactGA.send({ hitType: 'pageview', page: window.location.pathname });
  }, []);

  const login = useGoogleLogin({
    onSuccess: async (codeResponse) => {
      setLoading(true);
      try {
        const res = await axios.post(`${API_URL}/auth/google`, {
          code: codeResponse.code,
          redirectUri: REDIRECT_URI,
        });

        setUser(res.data.user);
        localStorage.setItem('strava_gcal_user', JSON.stringify(res.data.user));
        if (res.data.token) {
          localStorage.setItem('strava_gcal_token', res.data.token);
        }
        if (res.data.user.googleUserId) {
          fetchCalendars(res.data.token);
        }

        ReactGA.event({
          category: 'Engagement',
          action: 'Google Login',
          label: 'Success'
        });
      } catch (err) {
        console.error(err);
        const errorMsg = err.response?.data?.error || 'Login Failed';
        showMessage(errorMsg);
      } finally {
        setLoading(false);
      }
    },
    onError: () => showMessage('Google Login Failed'),
    flow: 'auth-code',
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  });

  const fetchCalendars = async (tokenOverride) => {
    try {
      const token = tokenOverride || localStorage.getItem('strava_gcal_token');
      if (!token) return;
      const res = await axios.get(`${API_URL}/user/calendars`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const fetchedCalendars = res.data;
      setCalendars(fetchedCalendars);

      const stravaCal = fetchedCalendars.find(c => c.summary.toLowerCase() === 'strava');

      setUser(prev => {
        if (!prev) return prev;

        // Auto-select Strava calendar if it exists and user hasn't selected another non-primary calendar
        if (stravaCal && (!prev.selectedCalendarId || prev.selectedCalendarId === 'primary')) {
          axios.patch(`${API_URL}/user`, { selectedCalendarId: stravaCal.id }, {
            headers: { Authorization: `Bearer ${token}` }
          }).catch(console.error);

          const updatedUser = { ...prev, selectedCalendarId: stravaCal.id };
          localStorage.setItem('strava_gcal_user', JSON.stringify(updatedUser));
          return updatedUser;
        }

        return prev;
      });
    } catch (err) {
      console.error("Failed to fetch calendars", err);
      if (err.response?.status === 401 || err.response?.status === 404) {
        handleLogout();
      }
    }
  };

  const createCalendar = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('strava_gcal_token');
      const res = await axios.post(`${API_URL}/user/calendars/strava`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const newCalendarId = res.data.calendarId;
      setUser(prev => ({ ...prev, selectedCalendarId: newCalendarId }));
      localStorage.setItem('strava_gcal_user', JSON.stringify({ ...user, selectedCalendarId: newCalendarId }));

      await fetchCalendars(token);
      showMessage('Calendar created successfully!', 'success');

      ReactGA.event({
        category: 'Engagement',
        action: 'Create Calendar',
        label: 'Success'
      });
    } catch (err) {
      console.error("Failed to create calendar", err);
      if (err.response?.status === 401 || err.response?.status === 404) {
        handleLogout();
        return;
      }
      const errorMsg = err.response?.data?.error || 'Failed to create calendar';
      showMessage(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = (message = '', type = 'error') => {
    setUser(null);
    localStorage.removeItem('strava_gcal_user');
    localStorage.removeItem('strava_gcal_token');
    if (message) showMessage(message, type);
    setDeleteConfirmed(false);
    setShowDeleteModal(false);
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirmed) return;
    setIsDeleting(true);
    setLoading(true);
    try {
      const token = localStorage.getItem('strava_gcal_token');
      await axios.delete(`${API_URL}/user`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      handleLogout('Account deleted successfully. All data has been removed!', 'success');

      ReactGA.event({
        category: 'Engagement',
        action: 'Account Disconnect',
        label: 'Success'
      });
    } catch (err) {
      console.error("Failed to delete account", err);
      // Gracefully handle 404: if the user is already deleted, just log them out and reset UI
      if (err.response?.status === 404) {
        handleLogout('Account disconnected successfully!', 'success');
      } else {
        const errorMsg = err.response?.data?.error || 'Failed to delete account';
        showMessage(errorMsg);
      }
    } finally {
      setIsDeleting(false);
      setLoading(false);
    }
  };

  const handleCalendarChange = async (e) => {
    const newCalendarId = e.target.value;
    const prevCalendarId = user.selectedCalendarId;
    try {
      // Optimistic update
      const updatedUser = { ...user, selectedCalendarId: newCalendarId };
      setUser(updatedUser);

      const token = localStorage.getItem('strava_gcal_token');
      await axios.patch(`${API_URL}/user`, { selectedCalendarId: newCalendarId }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      localStorage.setItem('strava_gcal_user', JSON.stringify(updatedUser));
    } catch (err) {
      console.error("Failed to update calendar preference", err);
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      const errorMsg = err.response?.data?.error || 'Failed to save calendar preference';
      showMessage(errorMsg);
      // Revert optimistic update
      setUser({ ...user, selectedCalendarId: prevCalendarId });
    }
  };

  const linkStrava = async (googleUserId, code) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('strava_gcal_token');
      await axios.post(`${API_URL}/auth/strava`, {
        googleUserId,
        code
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Refresh user status
      const res = await axios.get(`${API_URL}/user/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(prev => ({ ...prev, hasStrava: true }));
      showMessage('Strava Connected Successfully!', 'success');

      ReactGA.event({
        category: 'Engagement',
        action: 'Strava Connect',
        label: 'Success'
      });
    } catch (err) {
      console.error("Strava Connection Error", err);
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      const errorMsg = err.response?.data?.error || 'Strava Connection Failed';
      showMessage(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleStravaConnect = () => {
    const stravaUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=read,activity:read_all`;
    window.location.href = stravaUrl;
  };

  return (
    <div className="app-wrapper">
      <div className="container fade-in-up">
        <h1 className="title" style={{ lineHeight: '1.1', marginBottom: '0.5rem' }}>
          Sync your Strava activities<br />to Google Calendar
        </h1>
        {msg.text && (
          <div className={`alert ${msg.type === 'success' ? 'alert-success' : 'alert-error'} ${msg.fading ? 'fade-out-shrink' : 'fade-in'}`}>
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="loading-spinner fade-in">Loading...</div>
        ) : !user ? (
          <div className="landing-container fade-in-up" style={{ animationDelay: '0.1s' }}>

            <div className="steps-card glass-panel">
              <h2 className="steps-title">How it works</h2>
              <div className="steps-list">
                <div className="step-item">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h3>Connect Google</h3>
                    <p>Sign into your Google account and grant access to your calendar</p>
                  </div>
                </div>
                <div className="step-connector"></div>
                <div className="step-item">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h3>Select Calendar</h3>
                    <p>Choose a calendar to sync with</p>
                  </div>
                </div>
                <div className="step-connector"></div>
                <div className="step-item">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <h3>Link Strava</h3>
                    <p>Sign into your Strava account to begin syncing</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="login-card glass-panel" style={{ marginTop: '0' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Sign in with Google to get started</p>
              <div style={{ marginTop: '1rem' }}>
                <button
                  onClick={() => login()}
                  className="btn btn-primary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    width: '280px',
                    backgroundColor: 'white',
                    color: '#3c4043',
                    border: '1px solid #dadce0',
                    fontWeight: 500,
                    margin: '0 auto',
                    borderRadius: '24px',
                    height: '40px',
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px 0 rgba(60,64,67,0.3)',
                    fontFamily: '"Roboto", "Google Sans", "Inter", sans-serif',
                    fontSize: '14px'
                  }}
                  onMouseOver={(e) => Object.assign(e.target.style, { backgroundColor: '#f8f9fa' })}
                  onMouseOut={(e) => Object.assign(e.target.style, { backgroundColor: 'white' })}
                >
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path><path fill="none" d="M0 0h48v48H0z"></path></svg>
                  Continue with Google
                </button>
              </div>
            </div>

          </div>
        ) : (
          <div className="dashboard glass-panel fade-in-up" style={{ animationDelay: '0.1s' }}>

            <div className="card-item fade-in-up" style={{ animationDelay: '0.2s' }}>
              <span className="icon success-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <div className="status-text">
                <span className="status-title">Google Account Connected</span>
                <span className="status-desc">{user.email}</span>
              </div>
            </div>

            <div className="card-item fade-in-up" style={{ animationDelay: '0.3s' }}>
              {!isEditingCalendar ? (
                <>
                  <span className="icon success-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </span>
                  <div className="connect-action">
                    <div className="status-text">
                      <span className="status-title">Destination Calendar</span>
                      <span className="status-desc">
                        {user.selectedCalendarId && user.selectedCalendarId !== 'primary'
                          ? (calendars.find(c => c.id === user.selectedCalendarId)?.summary || 'Selected Calendar')
                          : 'Primary Calendar'}
                      </span>
                    </div>
                    <button className="btn-outline" style={{ padding: '0.5em 1em', fontSize: '0.85rem' }} onClick={() => setIsEditingCalendar(true)}>
                      Edit
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </div>
                  <div className="status-text">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span className="status-title" style={{ display: 'block' }}>Choose your destination calendar</span>
                        <span className="status-desc" style={{ display: 'block', marginTop: '0.2rem' }}>We recommend creating a standalone calendar called "Strava"</span>
                      </div>
                      <button className="btn-outline" style={{ padding: '0.3em 0.8em', fontSize: '0.8rem', border: 'none', marginLeft: '1rem' }} onClick={() => setIsEditingCalendar(false)}>
                        Close
                      </button>
                    </div>

                    {calendars.some(c => c.summary.toLowerCase() === 'strava') ? (
                      // Strava calendar exists
                      <select
                        className="custom-select"
                        value={user.selectedCalendarId || 'primary'}
                        onChange={handleCalendarChange}
                        disabled={calendars.length === 0}
                        style={{ marginTop: '1rem' }}
                      >
                        {/* Put Strava first if it exists */}
                        {calendars.filter(c => c.summary.toLowerCase() === 'strava').map(c => (
                          <option key={c.id} value={c.id}>
                            {c.summary}
                          </option>
                        ))}
                        <option value="primary">Primary Calendar</option>
                        {calendars.filter(c => !c.primary && c.summary.toLowerCase() !== 'strava').map(c => (
                          <option key={c.id} value={c.id}>
                            {c.summary}
                          </option>
                        ))}
                      </select>
                    ) : (
                      // Strava calendar does NOT exist
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                        <button
                          className="btn-strava"
                          onClick={createCalendar}
                          style={{ width: '100%', padding: '0.8em 1em', fontSize: '0.95rem' }}
                        >
                          Create "Strava" Calendar
                        </button>

                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          or pick from the list
                        </div>

                        <select
                          className="custom-select"
                          value={user.selectedCalendarId || 'primary'}
                          onChange={handleCalendarChange}
                          disabled={calendars.length === 0}
                        >
                          <option value="primary">Primary Calendar</option>
                          {calendars.filter(c => !c.primary).map(c => (
                            <option key={c.id} value={c.id}>
                              {c.summary}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div style={{ marginTop: '1rem' }}>
                      <span className="status-desc" style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Note: Changing this won't move your past events. Old activities will stay on the previous calendar.
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="card-item fade-in-up" style={{ animationDelay: '0.4s' }}>
              {user.hasStrava ? (
                <>
                  <span className="icon success-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </span>
                  <div className="status-text">
                    <span className="status-title">Strava Connected</span>
                    <span className="status-desc">Ready to sync your activities</span>
                  </div>
                </>
              ) : (
                <div className="connect-action">
                  <div className="status-text">
                    <span className="status-title">Link Strava</span>
                    <span className="status-desc">Action required to enable sync</span>
                  </div>
                  <button className="strava-connect-btn" onClick={handleStravaConnect} aria-label="Connect with Strava">
                    <img src={stravaConnectBtn} alt="Connect with Strava" />
                  </button>
                </div>
              )}
            </div>

            {user.hasStrava && (
              <div className="fade-in-up" style={{ animationDelay: '0.45s', textAlign: 'center', width: '100%' }}>
                <a
                  href="https://buymeacoffee.com/gregtracy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bmc-btn"
                >
                  <span className="bmc-emoji" role="img" aria-label="coffee">🧡</span>
                  Free, but buy me some Skratch? 🙏
                </a>
              </div>
            )}

            <div className="card-item fade-in-up" style={{ animationDelay: '0.5s', marginTop: '2rem', border: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.03)' }}>
              {!showDeleteModal ? (
                <>
                  <div className="icon" style={{ color: 'var(--accent-color)' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  </div>
                  <div className="status-text">
                    <span className="status-title">Hello, {user.firstName || 'there'}!</span>
                    <span className="status-desc" style={{ fontSize: '0.95rem', lineHeight: '1.4' }}>
                      {user.hasStrava
                        ? "You are all setup! Data will flow seamlessly in the background and there's nothing left for you to do."
                        : "Connect your Strava account above to finalize the setup."}
                    </span>

                    <div style={{ marginTop: '1rem', paddingLeft: '0.5rem' }}>
                      <button
                        className="btn-text"
                        style={{ fontSize: '0.875rem', opacity: 0.7, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: 0, backgroundColor: 'transparent', border: 'none' }}
                        onClick={() => setShowDeleteModal(true)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c-.6 0-1.1.2-1.5.5L8.6 5.6C9.6 4.6 10.7 4.1 12 4c5.5 0 10 4.5 10 10 0 1.3-.3 2.5-1 3.5l-1.5-1.5c.3-.6.5-1.3.5-2 0-4.4-3.6-8-8-8zm4.4 12.3-1.4-1.4c-.9.7-1.9 1.1-3 1.1-4.4 0-8-3.6-8-8 0-1.1.4-2.1 1.1-3l-1.4-1.4C2.7 8.1 2 9.9 2 12c0 5.5 4.5 10 10 10 2.1 0 3.9-.7 5.4-1.7zM13 12.8V9c0-.6-.4-1-1-1s-1 .4-1 1v3.8l2 2zM3 2.3 1.7 3.6l19 19 1.3-1.3-19-19z" /></svg>
                        Disconnect all services
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="status-text fade-in" style={{ width: '100%' }}>
                  <span className="status-title" style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Sorry to see you go, {user.firstName || 'there'}!</span>
                  <span className="status-desc" style={{ fontSize: '0.95rem', marginBottom: '1rem', display: 'block' }}>
                    Here's what will happen next when you delete your account:
                  </span>

                  <div className="status-desc" style={{ marginBottom: '1.5rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.8rem', fontSize: '0.9rem', opacity: 0.8 }}>
                    <div>🚫 Our access to your Google Calendar will be revoked.</div>
                    <div>🚫 Our access to your Strava account will be revoked.</div>
                    <div>🧹 All of your calendar and Strava synchronization settings will be deleted.</div>
                    <div>📌 We won't touch your existing calendar events. They will remain on your calendar.</div>
                  </div>

                  <label className="checkbox-container" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={deleteConfirmed}
                      onChange={(e) => setDeleteConfirmed(e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                    <span className="status-desc" style={{ fontSize: '0.85rem' }}>I want to permanently delete my account.</span>
                  </label>

                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-start' }}>
                    <button
                      className="btn-outline"
                      style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                      onClick={() => setShowDeleteModal(false)}
                      disabled={isDeleting}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-strava"
                      style={{
                        fontSize: '0.85rem',
                        padding: '0.5rem 1rem',
                        backgroundColor: deleteConfirmed ? '#555' : '#333',
                        borderColor: deleteConfirmed ? '#555' : '#333',
                        opacity: deleteConfirmed ? 1 : 0.5
                      }}
                      disabled={!deleteConfirmed || isDeleting}
                      onClick={handleDeleteAccount}
                    >
                      {isDeleting ? 'Processing...' : 'Confirm Disconnect'}
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {!loading && (
        <footer className="global-footer fade-in" style={{ animationDelay: '0.6s' }}>
          <div className="footer-content">
            <div className="footer-left">
              <a href="https://www.threads.com/@gftracy" target="_blank" rel="noopener noreferrer" className="social-link" title="Threads" aria-label="Threads">
                <svg viewBox="0 0 192 192" fill="currentColor" width="22" height="22">
                  <path d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.537 60.5382 122.616 44.905 97.5619 44.745C97.4484 44.7443 97.3355 44.7443 97.222 44.7443C82.2364 44.7443 69.7731 51.1409 62.102 62.7807L75.881 72.2328C81.6116 63.5383 90.6052 61.6848 97.2286 61.6848C97.3051 61.6848 97.3819 61.6848 97.4576 61.6855C105.707 61.7381 111.932 64.1366 115.961 68.814C118.893 72.2193 120.854 76.925 121.825 82.8638C114.511 81.6207 106.601 81.2385 98.145 81.7233C74.3247 83.0954 59.0111 96.9879 60.0396 116.292C60.5615 126.084 65.4397 134.508 73.775 140.011C80.8224 144.663 89.899 146.938 99.3323 146.423C111.79 145.74 121.563 140.987 128.381 132.296C133.559 125.696 136.834 117.143 138.28 106.366C144.217 109.949 148.617 114.664 151.047 120.332C155.179 129.967 155.42 145.8 142.501 158.708C131.182 170.016 117.576 174.908 97.0135 175.059C74.2042 174.89 56.9538 167.575 45.7381 153.317C35.2355 139.966 29.8077 120.682 29.6052 96C29.8077 71.3178 35.2355 52.0336 45.7381 38.6827C56.9538 24.4249 74.2039 17.11 97.0132 16.9405C119.988 17.1113 137.539 24.4614 149.184 38.788C154.894 45.8136 159.199 54.6488 162.037 64.9503L178.184 60.6422C174.744 47.9622 169.331 37.0357 161.965 27.974C147.036 9.60668 125.202 0.195148 97.0695 0H96.9569C68.8816 0.19447 47.2921 9.6418 32.7883 28.0793C19.8819 44.4864 13.2244 67.3157 13.0007 95.9325L13 96L13.0007 96.0675C13.2244 124.684 19.8819 147.514 32.7883 163.921C47.2921 182.358 68.8816 191.806 96.9569 192H97.0695C122.03 191.827 139.624 185.292 154.118 170.811C173.081 151.866 172.51 128.119 166.26 113.541C161.776 103.087 153.227 94.5962 141.537 88.9883ZM98.4405 129.507C88.0005 130.095 77.1544 125.409 76.6196 115.372C76.2232 107.93 81.9158 99.626 99.0812 98.6368C101.047 98.5234 102.976 98.468 104.871 98.468C111.106 98.468 116.939 99.0737 122.242 100.233C120.264 124.935 108.662 128.946 98.4405 129.507Z" />
                </svg>
              </a>
              <a href="https://github.com/gtracy/strava-to-gcal" target="_blank" rel="noopener noreferrer" className="social-link" title="GitHub" aria-label="GitHub">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48A10.001 10.001 0 0022 12c0-5.523-4.477-10-10-10z"></path>
                </svg>
              </a>
              <a href="https://www.strava.com/athletes/6866927" target="_blank" rel="noopener noreferrer" className="social-link" title="Strava Profile" aria-label="Strava">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"></path>
                </svg>
              </a>
              <a href="https://buymeacoffee.com/gregtracy" target="_blank" rel="noopener noreferrer" className="bmc-footer-icon" title="Buy me some Skratch" aria-label="Buy me some Skratch">
                🧡
              </a>
            </div>

            <div className="footer-center">
              <a href="#" className="footer-link">privacy policy</a>
              <span className="footer-separator">|</span>
              <a href="#" className="footer-link">terms of service</a>
            </div>

            <div className="footer-right">
              <img src={stravaPoweredBy} alt="Powered by Strava" className="powered-by-img" />
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}

export default App
