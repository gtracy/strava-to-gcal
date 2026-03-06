import { GoogleLogo } from './GoogleLogo';
import { useState, useEffect } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import axios from 'axios'
import './App.css'

function App({ dynamicConfig }) {
  const API_URL = dynamicConfig?.VITE_API_URL || import.meta.env.VITE_API_URL;
  const STRAVA_CLIENT_ID = dynamicConfig?.VITE_STRAVA_CLIENT_ID || import.meta.env.VITE_STRAVA_CLIENT_ID;
  const REDIRECT_URI = window.location.origin;

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: 'error' }); // type: 'error' | 'success'
  const [calendars, setCalendars] = useState([]);
  const [isEditingCalendar, setIsEditingCalendar] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  const showMessage = (text, type = 'error') => {
    setMsg({ text, type });
    if (type === 'success') {
      setTimeout(() => setMsg({ text: '', type: 'error' }), 3000);
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
  }, []);

  const login = useGoogleLogin({
    onSuccess: async (codeResponse) => {
      setLoading(true);
      try {
        const res = await axios.post(`${API_URL}/auth/google`, {
          code: codeResponse.code,
          redirectUri: window.location.origin
        });

        setUser(res.data.user);
        localStorage.setItem('strava_gcal_user', JSON.stringify(res.data.user));
        if (res.data.token) {
          localStorage.setItem('strava_gcal_token', res.data.token);
        }
        if (res.data.user.googleUserId) {
          fetchCalendars(res.data.token);
        }
      } catch (err) {
        console.error(err);
        const errorMsg = err.response?.data?.error || 'Login Failed';
        showMessage(errorMsg);
      } finally {
        setLoading(false);
      }
    },
    flow: 'auth-code',
    scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events openid email profile'
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

  const handleLogout = (message = '') => {
    setUser(null);
    localStorage.removeItem('strava_gcal_user');
    localStorage.removeItem('strava_gcal_token');
    if (message) showMessage(message);
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
      handleLogout('Account deleted successfully. All data has been removed.');
    } catch (err) {
      console.error("Failed to delete account", err);
      const errorMsg = err.response?.data?.error || 'Failed to delete account';
      showMessage(errorMsg);
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
    <div className="container fade-in-up">
      <h1 className="title">Sync Strava to Google Calendar</h1>
      {msg.text && (
        <div className={`alert ${msg.type === 'success' ? 'alert-success' : 'alert-error'} fade-in`}>
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
            <p className="subtitle" style={{ marginBottom: '1.5rem' }}>Ready to get started?</p>
            <button className="btn-google" style={{ marginTop: '0' }} onClick={() => login()}>
              <div className="btn-google__icon">
                <GoogleLogo />
              </div>
              <span className="btn-google__text">Continue with Google</span>
            </button>
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
                <button className="btn-strava" onClick={handleStravaConnect}>
                  Connect
                </button>
              </div>
            )}
          </div>

          {user.hasStrava && (
            <div className="card-item fade-in-up" style={{ animationDelay: '0.5s', marginTop: '2rem', border: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.03)' }}>
              {!showDeleteModal ? (
                <>
                  <div className="icon" style={{ color: 'var(--accent-color)' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  </div>
                  <div className="status-text">
                    <span className="status-title">Everything is set!</span>
                    <span className="status-desc" style={{ fontSize: '0.95rem', lineHeight: '1.4' }}>
                      Hello, {user.firstName || 'there'}. You are all setup! Data will flow seamlessly in the background and there's nothing left for you to do.
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
          )}

        </div>
      )}
    </div>
  )
}

export default App
