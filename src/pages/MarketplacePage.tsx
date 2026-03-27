import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';
import { mockCoupons } from '../data/mockCoupons';

export default function MarketplacePage() {
  const { locale } = useLocale();
  const t = translations[locale];

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <section className="rounded-3xl border border-maroon/10 bg-white p-8 shadow-soft">
        <h1 className="text-3xl font-semibold text-maroon">{t.marketplace}</h1>
        <p className="mt-3 text-slate-600">{t.featuredDeals}</p>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {mockCoupons.map((coupon) => (
            <article key={coupon.id} className="rounded-3xl border border-maroon/10 bg-cream p-6 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-maroon">{coupon.title}</h2>
                  <p className="mt-2 text-sm text-slate-600">{coupon.merchant}</p>
                </div>
                <span className="rounded-full bg-maroon px-3 py-2 text-xs font-semibold text-cream">{coupon.discount}</span>
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-700">{coupon.description}</p>
              <div className="mt-6 flex items-center justify-between text-xs uppercase tracking-[0.25em] text-slate-500">
                <span>{coupon.category}</span>
                <span>{coupon.validUntil}</span>
              </div>
              <button className="mt-6 w-full rounded-3xl bg-maroon px-4 py-3 text-sm font-semibold text-cream transition hover:bg-maroon/90">
                {t.couponButton}
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
