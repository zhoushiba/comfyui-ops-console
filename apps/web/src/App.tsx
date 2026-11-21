/** 路由表：除登录页外均包在 AppLayout 内 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from './store/auth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/Login';
import OverviewPage from './pages/Overview';
import TasksPage from './pages/Tasks';
import TaskDetailPage from './pages/TaskDetail';
import CreatePage from './pages/Create';
import GalleryPage from './pages/Gallery';
import UsagePage from './pages/Usage';
import AgentsPage from './pages/Agents';
import AgentDetailPage from './pages/AgentDetail';
import SettingsPage from './pages/Settings';

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="create" element={<CreatePage />} />
        <Route path="gallery" element={<GalleryPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
