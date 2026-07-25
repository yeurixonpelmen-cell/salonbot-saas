import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { LocaleProvider } from './context/LocaleContext';
import { initAdminTheme } from './utils/theme';
import './index.css';

initAdminTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>
);
