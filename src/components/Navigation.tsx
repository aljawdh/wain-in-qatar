import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';
import { paths } from '../data/routes';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-medium transition ${
    isActive ? 'bg-maroon text-cream' : 'text-slate-700 hover:bg-maroon/10'
  }`;

export default function Navigation() {
  const { user, logout } = useAuth();
  const { locale, setLocale } = useLocale();
  const t = translations[locale];

  async function handleLogout() {
    await logout();
  }

  return (
    <header className="border-b border-maroon/20 bg-cream/90 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link to={paths.home} className="text-xl font-semibold text-maroon">
          {t.brand}
        </Link>
        <nav className="flex flex-wrap items-center gap-3">
          <NavLink to={paths.home} className={navClass} end>
            {t.home}
          </NavLink>
          <NavLink to={paths.planner} className={navClass}>
            {t.planner}
          </NavLink>
          <NavLink to={paths.marketplace} className={navClass}>
            {t.marketplace}
          </NavLink>
          {user && (
            <NavLink to={paths.dashboard} className={navClass}>
              {t.dashboard}
            </NavLink>
          )}
        </nav>
        <div className="flex items-center gap-3">
          <label className="sr-only" htmlFor="locale-select">
            {t.selectLocale}
          </label>
          <select
            id="locale-select"
            value={locale}
            onChange={(event) => setLocale(event.target.value as 'en' | 'ar')}
            className="rounded-full border border-maroon/20 bg-cream px-3 py-2 text-sm text-slate-900 outline-none"
          >
            <option value="en">EN</option>
            <option value="ar">عربي</option>
          </select>
          {user ? (
            <button
              onClick={handleLogout}
              className="rounded-full bg-maroon px-4 py-2 text-sm font-semibold text-cream transition hover:bg-maroon/90"
            >
              {t.logout}
            </button>
          ) : (
            <Link
              to={paths.login}
              className="rounded-full bg-maroon px-4 py-2 text-sm font-semibold text-cream transition hover:bg-maroon/90"
            >
              {t.login}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
