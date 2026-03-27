import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';

export default function MerchantPage() {
  const { locale } = useLocale();
  const t = translations[locale];

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <section className="rounded-3xl border border-maroon/10 bg-white p-8 shadow-soft">
        <h1 className="text-3xl font-semibold text-maroon">{t.merchantDashboard}</h1>
        <p className="mt-3 text-slate-600">{t.merchantIntro}</p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-maroon/10 bg-cream p-6">
            <h2 className="text-xl font-semibold text-maroon">{t.manageCoupons}</h2>
            <p className="mt-3 text-slate-600">{locale === 'ar' ? 'نشر كوبونات جديدة ومتابعة المبيعات.' : 'Publish new coupons and track performance.'}</p>
          </div>
          <div className="rounded-3xl border border-maroon/10 bg-cream p-6">
            <h2 className="text-xl font-semibold text-maroon">{locale === 'ar' ? 'تحليلات العملاء' : 'Customer analytics'}</h2>
            <p className="mt-3 text-slate-600">{locale === 'ar' ? 'عرض سلوك العملاء وتجاربهم.' : 'Review customer trends and engagement.'}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
