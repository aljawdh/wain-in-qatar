import { Link } from 'react-router-dom';
import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';
import { paths } from '../data/routes';

export default function NotFoundPage() {
  const { locale } = useLocale();
  const t = translations[locale];

  return (
    <main className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-5xl font-semibold text-maroon">404</h1>
      <p className="mt-4 text-xl text-slate-700">{t.pageNotFound}</p>
      <Link
        to={paths.home}
        className="mt-8 inline-flex rounded-full bg-maroon px-6 py-3 text-sm font-semibold text-cream transition hover:bg-maroon/90"
      >
        {t.home}
      </Link>
    </main>
  );
}
