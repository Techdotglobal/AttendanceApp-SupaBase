import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './core/router/AppRouter';
import { API_BASE_URL } from './core/config/api';
import './shared/styles/index.css';

if (import.meta.env.DEV) {
  console.log('[app] API_BASE_URL (backend):', API_BASE_URL || '<missing — set VITE_API_GATEWAY_URL or NEXT_PUBLIC_API_URL>');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  </React.StrictMode>
);
