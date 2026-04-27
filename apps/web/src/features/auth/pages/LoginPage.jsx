import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, loading, error } = useAuthStore();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    const result = await login(usernameOrEmail, password);
    if (!result.success) return;
    if (result.role === 'super_admin') navigate('/');
    else if (result.role === 'manager') navigate('/');
    else navigate('/unauthorized');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <form className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4" onSubmit={onSubmit}>
        <h1 className="text-2xl font-semibold">Hadir.AI Admin Portal</h1>
        <input className="w-full rounded-md bg-slate-800 p-3" placeholder="Username or email" value={usernameOrEmail} onChange={(e) => setUsernameOrEmail(e.target.value)} />
        <input className="w-full rounded-md bg-slate-800 p-3" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button className="w-full rounded-md bg-indigo-600 p-3 font-medium disabled:opacity-60" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
