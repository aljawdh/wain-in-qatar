import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';

export default function AdminPage() {
  const { locale } = useLocale();
  const t = translations[locale];

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <section className="rounded-3xl border border-maroon/10 bg-white p-8 shadow-soft">
        <h1 className="text-3xl font-semibold text-maroon">{t.adminDashboard}</h1>
        <p className="mt-3 text-slate-600">{t.adminIntro}</p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-maroon/10 bg-cream p-6">
            <h2 className="text-xl font-semibold text-maroon">{locale === 'ar' ? 'التحقق من المستخدمين' : 'User verification'}</h2>
            <p className="mt-3 text-slate-600">{locale === 'ar' ? 'راقب الأدوار وصلاحيات الحساب.' : 'Monitor roles and account permissions.'}</p>
          </div>
          <div className="rounded-3xl border border-maroon/10 bg-cream p-6">
            <h2 className="text-xl font-semibold text-maroon">{locale === 'ar' ? 'إدارة العروض' : 'Offer administration'}</h2>
            <p className="mt-3 text-slate-600">{locale === 'ar' ? 'راجع وتحكم في سوق الكوبونات.' : 'Review and manage the coupon marketplace.'}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
