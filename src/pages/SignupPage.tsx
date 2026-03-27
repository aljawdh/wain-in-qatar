import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';
import { paths } from '../data/routes';

export default function SignupPage() {
  const { register } = useAuth();
  const { locale } = useLocale();
  const t = translations[locale];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError('');
      await register(email, password, name || 'Guest', 'tourist');
      navigate(paths.dashboard);
    } catch (err) {
      setError(t.authError);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="rounded-3xl border border-maroon/10 bg-white p-10 shadow-soft">
        <h1 className="text-3xl font-semibold text-maroon">{t.signup}</h1>
        <p className="mt-3 text-sm text-slate-600">{t.signupPrompt}</p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            {t.enterName}
            <input
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-maroon/20 bg-cream px-4 py-3 outline-none transition focus:border-maroon focus:ring-2 focus:ring-maroon/10"
            />
          </label>
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
            {t.signup}
          </button>
        </form>
        <p className="mt-6 text-sm text-slate-600">
          {locale === 'ar' ? 'لديك حساب بالفعل؟' : 'Already have an account?'}{' '}
          <Link to={paths.login} className="font-semibold text-maroon underline">
            {t.login}
          </Link>
        </p>
      </section>
    </main>
  );
}
