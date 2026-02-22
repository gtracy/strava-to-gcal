import { GoogleLogo } from './GoogleLogo';
import { useState, useEffect } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import axios from 'axios'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL;
const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID;
const REDIRECT_URI = window.location.origin;

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: 'error' }); // type: 'error' | 'success'
  const [calendars, setCalendars] = useState([]);
  const [isEditingCalendar, setIsEditingCalendar] = useState(false);

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
        handleLogout('Session expired. Please log in again.');
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
        handleLogout('Session expired. Please log in again.');
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
        handleLogout('Session expired. Please log in again.');
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
        handleLogout('Session expired. Please log in again.');
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

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button className="btn-outline fade-in-up" onClick={() => handleLogout()} style={{ animationDelay: '0.5s' }}>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
