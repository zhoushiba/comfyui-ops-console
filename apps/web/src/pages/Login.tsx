/** 登录页：演示账号快捷填充 + 错误提示 */
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { Spinner } from '../components/ui';

const DEMO_ACCOUNTS = [
  { label: '管理员', email: 'admin@ops.local', password: 'Admin@123456' },
  { label: '运营', email: 'operator@ops.local', password: 'Ops@123456' },
  { label: '代理商', email: 'studio@ops.local', password: 'Studio@123456' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((state) => state.token);
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState('admin@ops.local');
  const [password, setPassword] = useState('Admin@123456');

  const login = useMutation({
    mutationFn: () => api.login(email.trim(), password),
    onSuccess: (data) => {
      setSession(data.token, data.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    },
  });

  if (token) return <Navigate to="/" replace />;

  return (
    <div className="login">
      <section className="login__intro">
        <div className="brand brand--lg">
          <span className="brand__mark" aria-hidden="true">
            ◉
          </span>
          <div>
            <p className="brand__name">ComfyUI Ops Console</p>
            <p className="brand__sub">算力运营控制台</p>
          </div>
        </div>
        <h1>
          把 ComfyUI 变成
          <br />
          可运营的出图服务
        </h1>
        <p className="login__lead">
          任务编排、轮询下载、图库管理、用量结算与 CSV 导出，一套后台跑通完整链路。
        </p>
        <ul className="login__points">
          <li>幂等提交 + 指数退避，故障可观测</li>
          <li>PNG / JPEG / WebP 转换与缩略图</li>
          <li>阶梯计价、分成与结算单流转</li>
          <li>用量报表一键导出（UTF-8 BOM）</li>
        </ul>
        <div className="login__diagram" aria-hidden="true">
          <span>Web</span>
          <i>→</i>
          <span>Server</span>
          <i>→</i>
          <span>ComfyUI</span>
        </div>
      </section>

      <section className="login__panel">
        <div className="login__card">
          <h2>登录控制台</h2>
          <p className="muted">使用种子账号体验完整流程</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              login.mutate();
            }}
          >
            <label className="field">
              <span className="field__label">邮箱</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">密码</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {login.isError ? <p className="form-error">{errorMessage(login.error)}</p> : null}
            <button type="submit" className="btn btn--primary btn--block" disabled={login.isPending}>
              {login.isPending ? <Spinner label="登录中" /> : '登录'}
            </button>
          </form>

          <div className="login__demo">
            <span className="muted">快速填充：</span>
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="chip"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                }}
              >
                {account.label}
              </button>
            ))}
          </div>
          <p className="login__hint">
            种子密码统一为 <code>Admin@123456</code> 等，详见 README 第 8 节。
          </p>
        </div>
      </section>
    </div>
  );
}
