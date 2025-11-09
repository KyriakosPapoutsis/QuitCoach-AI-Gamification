// src/BackHandler.jsx
/**
 * Module: Native back button handler (Capacitor)
 *
 * Purpose
 * - Intercepts Android's hardware back button.
 * - Navigates to Dashboard if not already there.
 * - On Dashboard, requires a double press within 2s to exit the app.
 *
 * Behavior
 * - Uses Capacitor’s App.addListener('backButton').
 * - Shows a toast hint on first press.
 * - Works only on native builds; ignored on web.
 */

import { useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Toast } from '@capacitor/toast';
import { useLocation, useNavigate } from 'react-router-dom';

export default function BackHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  const DASH = '/dashboard';
  const HOME_SET = new Set(['/', DASH]);
  const norm = (p) => (p.replace(/\/+$/, '') || '/').toLowerCase();

  // helper: force-go-home (uses hard replace on native to avoid flaky history)
  const goHome = () => {
    if (Capacitor.isNativePlatform()) {
      // Hard replace avoids any leftover history entries in the WebView
      window.location.replace(DASH);
    } else {
      navigate(DASH, { replace: true });
    }
  };

 useEffect(() => {
  let handle; // will hold PluginListenerHandle once resolved

  // Register and capture the real handle (addListener returns a Promise)
  CapApp.addListener('backButton', async () => {
    const path = norm(location.pathname);

    // If not at a home route, ALWAYS jump to Dashboard
    if (!HOME_SET.has(path)) {
      goHome();
      return;
    }

    // Already on Dashboard/home: double-back to exit
    const now = Date.now();
    BackHandler._lastBack = BackHandler._lastBack || 0;

    if (now - BackHandler._lastBack < 2000) {
      CapApp.exitApp();
    } else {
      BackHandler._lastBack = now;
      await Toast.show({ text: 'Press back again to exit', duration: 'short' });
    }
  }).then(h => {
    handle = h;
  });

  // Cleanup: only call remove() once we have a handle
  return () => {
    if (handle && typeof handle.remove === 'function') {
      handle.remove();
    }
  };
}, [location.pathname, navigate]);


  return null;
}
