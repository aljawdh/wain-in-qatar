import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LocaleProvider } from './context/LocaleContext';
import Navigation from './components/Navigation';
import Loading from './components/Loading';
import ProtectedRoute from './routes/ProtectedRoute';
import { paths } from './data/routes';

const HomePage = lazy(() => import('./pages/HomePage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const PlannerPage = lazy(() => import('./pages/PlannerPage'));
const MarketplacePage = lazy(() => import('./pages/MarketplacePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const MerchantPage = lazy(() => import('./pages/MerchantPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <div className="min-h-screen bg-cream text-slate-900">
          <BrowserRouter>
            <Navigation />
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path={paths.home} element={<HomePage />} />
                <Route path={paths.login} element={<LoginPage />} />
                <Route path={paths.signup} element={<SignupPage />} />
                <Route path={paths.planner} element={<PlannerPage />} />
                <Route path={paths.marketplace} element={<MarketplacePage />} />
                <Route
                  path={paths.dashboard}
                  element={
                    <ProtectedRoute>
                      <DashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={paths.merchant}
                  element={
                    <ProtectedRoute requiredRole="merchant">
                      <MerchantPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={paths.admin}
                  element={
                    <ProtectedRoute requiredRole="admin">
                      <AdminPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </div>
      </AuthProvider>
    </LocaleProvider>
  );
}

export default App;
