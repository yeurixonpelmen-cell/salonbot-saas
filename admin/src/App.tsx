import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, clearToken } from './api';
import { Layout } from './components/Layout';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { MastersPage } from './pages/MastersPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SchedulePage } from './pages/SchedulePage';
import { ServicesPage } from './pages/ServicesPage';
import { SettingsPage } from './pages/SettingsPage';
import { SelectSalonPage } from './pages/SelectSalonPage';
import { ClientsPage } from './pages/ClientsPage';
import { ClientDetailsPage } from './pages/ClientDetailsPage';
import { FinancePage } from './pages/FinancePage';
import { SuperAdminPage, SuperLoginPage } from './pages/SuperAdminPage';

function ProtectedRoute() {
  const { isAuthenticated, refreshAuth } = useAuth();
  const [checking, setChecking] = useState(isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    api
      .get('/api/admin/salon')
      .then(() => {
        if (!cancelled) setChecking(false);
      })
      .catch(() => {
        clearToken();
        refreshAuth();
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, refreshAuth]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (checking) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-sub" style={{ margin: 0 }}>Перевірка сесії…</p>
        </div>
      </div>
    );
  }
  return <Layout />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/select-salon" element={<SelectSalonPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/super/login" element={<SuperLoginPage />} />
      <Route path="/super" element={<SuperAdminPage />} />
      <Route path="/super/finance" element={<FinancePage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<SchedulePage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:id" element={<ClientDetailsPage />} />
        <Route path="/masters" element={<MastersPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
