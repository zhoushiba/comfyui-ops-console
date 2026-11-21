/** 应用外壳：左侧导航 + 顶栏连接状态 + 全局 Toast */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { Spinner } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: '总览', icon: 'grid', end: true },
  { to: '/tasks', label: '任务', icon: 'list' },
  { to: '/create', label: '出图', icon: 'spark' },
  { to: '/gallery', label: '图库', icon: 'image' },
  { to: '/usage', label: '用量', icon: 'chart' },
  { to: '/agents', label: '代理商', icon: 'users' },
  { to: '/settings', label: '设置', icon: 'gear' },
];

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    list: 'M4 6h16M4 12h16M4 18h10',
    spark: 'M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4z',
    image: 'M4 5h16v14H4zM4 15l4.5-4 3.5 3 3-2.5L20 15',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 4a3.5 3.5 0 010 7M18 21a6 6 0 00-3-5.2',
    gear: 'M12 15.5A3.5 3.5 0 1012 8.5a3.5 3.5 0 000 7zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}

function ToastHost() {
  const items = useToastStore((state) => state.items);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <div className="toast-host" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast toast--${item.kind}`} role="status">
          <div>
            <p className="toast__title">{item.title}</p>
            {item.description ? <p className="toast__desc">{item.description}</p> : null}
          </div>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="关闭提示" onClick={() => dismiss(item.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);
  const [menuOpen, setMenuOpen] = useState(false);

  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: Boolean(token) });
  useEffect(() => {
    if (meQuery.data?.user) setUser(meQuery.data.user);
  }, [meQuery.data, setUser]);

  const statusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: api.system.status,
    refetchInterval: 30_000,
    retry: 1,
  });

  const online = statusQuery.data?.comfyui?.reachable === true;
  const statusText = statusQuery.isLoading ? '检测中' : online ? 'ComfyUI 在线' : 'ComfyUI 离线';

  return (
    <div className="shell">
      <aside className={`sidebar${menuOpen ? ' sidebar--open' : ''}`}>
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ◉
          </span>
          <div>
            <p className="brand__name">ComfyUI Ops</p>
            <p className="brand__sub">算力运营控制台</p>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__foot">
          <div className={`conn conn--${online ? 'ok' : statusQuery.isLoading ? 'pending' : 'bad'}`}>
            <span className="conn__dot" />
            <span>{statusText}</span>
          </div>
          <p className="sidebar__version">v{statusQuery.data ? '1.0.0' : '1.0.0'} · {statusQuery.data?.db === 'ok' ? 'DB 正常' : 'DB 未知'}</p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="切换菜单" onClick={() => setMenuOpen((value) => !value)}>
            ☰
          </button>
          <div className="topbar__crumb">
            {statusQuery.isError ? <span className="muted">{errorMessage(statusQuery.error)}</span> : null}
          </div>
          <div className="topbar__right">
            {statusQuery.isFetching ? <Spinner /> : null}
            <div className="user">
              <span className="user__avatar">{(user?.name ?? '访').slice(0, 1)}</span>
              <div className="user__meta">
                <span className="user__name">{user?.name ?? '未登录'}</span>
                <span className="user__role">{user?.role ?? '—'}{user?.agentName ? ` · ${user.agentName}` : ''}</span>
              </div>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
            >
              退出
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
      <ToastHost />
    </div>
  );
}
