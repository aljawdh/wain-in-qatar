import { FormEvent, useMemo, useState } from 'react';
import { useLocale } from '../context/LocaleContext';
import { translations } from '../data/translations';
import { fetchTripPlan } from '../lib/gemini';
import type { TripRequest } from '../types';

export default function PlannerPage() {
  const { locale } = useLocale();
  const t = translations[locale];
  const [request, setRequest] = useState<TripRequest>({
    destination: locale === 'ar' ? 'الدوحة' : 'Doha',
    duration: locale === 'ar' ? '3 أيام' : '3 days',
    interests: locale === 'ar' ? 'ثقافة وتسوق' : 'culture and shopping',
    budget: locale === 'ar' ? 'متوسط' : 'moderate',
  });
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const placeholder = useMemo(() => t.noPlanYet, [t.noPlanYet]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const plan = await fetchTripPlan(request);
    setResponse(plan.itinerary);
    setLoading(false);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <section className="rounded-3xl border border-maroon/10 bg-white p-8 shadow-soft">
        <h1 className="text-3xl font-semibold text-maroon">{t.planner}</h1>
        <p className="mt-3 text-slate-600">{t.tagline}</p>
        <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              {t.destination}
              <input
                value={request.destination}
                onChange={(event) => setRequest({ ...request, destination: event.target.value })}
                className="mt-2 w-full rounded-3xl border border-maroon/20 bg-cream px-4 py-3 outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              {t.duration}
              <input
                value={request.duration}
                onChange={(event) => setRequest({ ...request, duration: event.target.value })}
                className="mt-2 w-full rounded-3xl border border-maroon/20 bg-cream px-4 py-3 outline-none"
              />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              {t.interests}
              <input
                value={request.interests}
                onChange={(event) => setRequest({ ...request, interests: event.target.value })}
                className="mt-2 w-full rounded-3xl border border-maroon/20 bg-cream px-4 py-3 outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              {t.budget}
              <input
                value={request.budget}
                onChange={(event) => setRequest({ ...request, budget: event.target.value })}
                className="mt-2 w-full rounded-3xl border border-maroon/20 bg-cream px-4 py-3 outline-none"
              />
            </label>
          </div>
          <button
            type="submit"
            className="w-full rounded-3xl bg-maroon px-6 py-3 text-sm font-semibold text-cream transition hover:bg-maroon/90"
          >
            {loading ? 'Generating...' : t.planTrip}
          </button>
        </form>
        <section className="mt-8 rounded-3xl border border-maroon/10 bg-maroon/5 p-6">
          <h2 className="text-xl font-semibold text-maroon">{t.itinerary}</h2>
          <p className="mt-4 whitespace-pre-line text-slate-700">{response || placeholder}</p>
        </section>
      </section>
    </main>
  );
}
