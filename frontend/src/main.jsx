import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { BrowserRouter } from 'react-router-dom'
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3'
import App from './App.jsx'
import './index.css'
import ReactGA from 'react-ga4';

const defaultGoogleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#020617',
          color: '#f8fafc',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: "'Outfit', sans-serif"
        }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '1rem', color: '#fc5200' }}>Something went wrong</h1>
          <p style={{ maxWidth: '500px', marginBottom: '1.5rem', color: '#94a3b8' }}>
            Clocking Sweat encountered an unexpected error loading the application. Please refresh the page or try again in a few moments.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#fc5200',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '1rem'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

async function init() {
  let config = {
    VITE_API_URL: import.meta.env.VITE_API_URL,
    VITE_GOOGLE_CLIENT_ID: defaultGoogleClientId,
    VITE_STRAVA_CLIENT_ID: import.meta.env.VITE_STRAVA_CLIENT_ID,
  };

  console.log('Fetching configuration...', { envApi: config.VITE_API_URL });
  try {
    const response = await fetch('/config.json');
    if (response.ok) {
      const remoteConfig = await response.json();
      console.log('Dynamic config loaded successfully:', remoteConfig);
      if (remoteConfig && typeof remoteConfig === 'object') {
        for (const [key, value] of Object.entries(remoteConfig)) {
          if (typeof value === 'string' && value.trim() !== '') {
            config[key] = value.trim();
          }
        }
      }
    } else {
      console.warn(`Dynamic config fetch returned status: ${response.status}`);
    }
  } catch (err) {
    console.error('Dynamic config fetch failed unexpectedly:', err);
  }

  console.log('Initializing with final config:', {
    apiUrl: config.VITE_API_URL,
    googleId: config.VITE_GOOGLE_CLIENT_ID ? 'set' : 'missing',
    stravaId: config.VITE_STRAVA_CLIENT_ID ? 'set' : 'missing'
  });

  // Initialize GA4
  try {
    ReactGA.initialize('G-9V6LR6MVNN');
  } catch (err) {
    console.warn('Failed to initialize GA4:', err);
  }

  const appContent = config.VITE_GOOGLE_CLIENT_ID ? (
    <GoogleOAuthProvider clientId={config.VITE_GOOGLE_CLIENT_ID}>
      <App dynamicConfig={config} />
    </GoogleOAuthProvider>
  ) : (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#020617',
      color: '#f8fafc',
      padding: '2rem',
      textAlign: 'center',
      fontFamily: "'Outfit', sans-serif"
    }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '1rem', color: '#fc5200' }}>Service Notice</h1>
      <p style={{ maxWidth: '500px', marginBottom: '1.5rem', color: '#94a3b8' }}>
        Clocking Sweat is temporarily unavailable while completing configuration updates. Please check back shortly.
      </p>
    </div>
  );

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <GoogleReCaptchaProvider reCaptchaKey="6LcgYacsAAAAAC1-1ZFBZAhF-0hzFtuhdMSMN3Id">
            {appContent}
          </GoogleReCaptchaProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

init();
