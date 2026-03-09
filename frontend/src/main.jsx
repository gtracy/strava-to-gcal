import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App.jsx'
import './index.css'
import ReactGA from 'react-ga4';

const defaultGoogleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

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
      config = { ...config, ...remoteConfig };
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
  ReactGA.initialize('G-9V6LR6MVNN');

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <GoogleOAuthProvider clientId={config.VITE_GOOGLE_CLIENT_ID}>
        <App dynamicConfig={config} />
      </GoogleOAuthProvider>
    </React.StrictMode>,
  )
}

init();
