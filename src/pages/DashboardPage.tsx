import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';
import { paths } from '../data/routes';

export default function DashboardPage() {
  const { user } = useAuth();
  const { locale } = useLocale();
  const t = translations[locale];

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <section className="rounded-3xl border border-maroon/10 bg-white p-8 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-maroon/70">{t.account}</p>
            <h1 className="mt-3 text-3xl font-semibold text-maroon">
              {t.welcomeUser} {user?.displayName}
            </h1>
            <p className="mt-2 text-slate-600">{t.dashboardIntro}</p>
          </div>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Link to={paths.planner} className="rounded-3xl border border-maroon/10 bg-cream p-6 transition hover:-translate-y-1 hover:shadow-lg">
            <h2 className="text-xl font-semibold text-maroon">{t.planner}</h2>
            <p className="mt-3 text-slate-600">{locale === 'ar' ? 'انشئ خطة رحلة شخصية' : 'Create a personalized itinerary.'}</p>
          </Link>
          <Link
            to={paths.marketplace}
            className="rounded-3xl border border-maroon/10 bg-cream p-6 transition hover:-translate-y-1 hover:shadow-lg"
          >
            <h2 className="text-xl font-semibold text-maroon">{t.marketplace}</h2>
            <p className="mt-3 text-slate-600">{locale === 'ar' ? 'تصفح كوبونات الخصومات المحلية' : 'Browse local coupon offers.'}</p>
          </Link>
          {user?.role === 'merchant' && (
            <Link
              to={paths.merchant}
              className="rounded-3xl border border-maroon/10 bg-cream p-6 transition hover:-translate-y-1 hover:shadow-lg"
            >
              <h2 className="text-xl font-semibold text-maroon">{t.merchantDashboard}</h2>
              <p className="mt-3 text-slate-600">{t.merchantIntro}</p>
            </Link>
          )}
          {(user?.role === 'admin' || user?.role === 'merchant') && (
            <Link
              to={paths.admin}
              className="rounded-3xl border border-maroon/10 bg-cream p-6 transition hover:-translate-y-1 hover:shadow-lg"
            >
              <h2 className="text-xl font-semibold text-maroon">{t.adminDashboard}</h2>
              <p className="mt-3 text-slate-600">{t.adminIntro}</p>
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
