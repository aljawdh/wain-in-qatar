import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';
import { paths } from '../data/routes';

export default function LoginPage() {
  const { login } = useAuth();
  const { locale } = useLocale();
  const t = translations[locale];
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError('');
      await login(email, password);
      navigate(paths.dashboard);
    } catch (err) {
      setError(t.authError);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="rounded-3xl border border-maroon/10 bg-white p-10 shadow-soft">
        <h1 className="text-3xl font-semibold text-maroon">{t.login}</h1>
        <p className="mt-3 text-sm text-slate-600">{t.loginPrompt}</p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            {t.enterEmail}
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-maroon/20 bg-cream px-4 py-3 outline-none transition focus:border-maroon focus:ring-2 focus:ring-maroon/10"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            {t.enterPassword}
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-maroon/20 bg-cream px-4 py-3 outline-none transition focus:border-maroon focus:ring-2 focus:ring-maroon/10"
            />
          </label>
          {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button type="submit" className="w-full rounded-3xl bg-maroon px-5 py-3 text-sm font-semibold text-cream transition hover:bg-maroon/90">
            {t.login}
          </button>
        </form>
        <p className="mt-6 text-sm text-slate-600">
          {locale === 'ar' ? 'ليس لديك حساب؟' : "Don't have an account?"}{' '}
          <Link to={paths.signup} className="font-semibold text-maroon underline">
            {t.signup}
          </Link>
        </p>
      </section>
    </main>
  );
}
