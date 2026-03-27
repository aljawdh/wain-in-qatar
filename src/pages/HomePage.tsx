import { Link } from 'react-router-dom';
import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';
import { mockCoupons } from '../data/mockCoupons';
import { paths } from '../data/routes';

export default function HomePage() {
  const { locale } = useLocale();
  const t = translations[locale];

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="grid gap-8 rounded-3xl border border-maroon/10 bg-cream p-8 shadow-soft lg:grid-cols-[1.3fr_0.9fr]">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-maroon/80">{t.tagline}</p>
          <h1 className="mt-5 text-4xl font-semibold text-maroon lg:text-5xl">{t.welcome}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-700">{t.explore}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              to={paths.planner}
              className="rounded-full bg-maroon px-6 py-3 text-sm font-semibold text-cream transition hover:bg-maroon/90"
            >
              {t.startPlanning}
            </Link>
            <Link
              to={paths.marketplace}
              className="rounded-full border border-maroon px-6 py-3 text-sm font-semibold text-maroon transition hover:bg-maroon/10"
            >
              {t.featuredDeals}
            </Link>
          </div>
        </div>
        <div className="grid gap-4">
          {mockCoupons.slice(0, 2).map((coupon) => (
            <article key={coupon.id} className="rounded-3xl border border-maroon/10 bg-white p-6 shadow-soft">
              <p className="text-sm font-semibold text-gold">{coupon.discount}</p>
              <h2 className="mt-3 text-xl font-semibold text-maroon">{coupon.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{coupon.description}</p>
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-500">{coupon.merchant}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="mt-10 grid gap-6 lg:grid-cols-3">
        {mockCoupons.map((coupon) => (
          <article
            key={coupon.id}
            className="rounded-3xl border border-maroon/10 bg-white p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-lg"
          >
            <h3 className="text-xl font-semibold text-maroon">{coupon.title}</h3>
            <p className="mt-3 text-sm text-slate-700">{coupon.description}</p>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>{coupon.category}</span>
              <span>{coupon.validUntil}</span>
            </div>
            <Link
              to={paths.marketplace}
              className="mt-6 inline-flex rounded-full bg-maroon px-4 py-3 text-sm font-semibold text-cream transition hover:bg-maroon/90"
            >
              {t.couponButton}
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
