import type { TripRequest, TripResponse } from '../types';

const GEMINI_URL = 'https://gemini.googleapis.com/v1/models/gemini-1.5/text:generate';

export async function fetchTripPlan(request: TripRequest): Promise<TripResponse> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    return {
      itinerary:
        'Please configure VITE_GEMINI_API_KEY in your environment to enable AI trip planning.',
    };
  }

  const payload = {
    temperature: 0.7,
    candidateCount: 1,
    prompt: `Plan a premium travel itinerary in Qatar for ${request.duration}, focused on ${request.interests}. The trip should stay within ${request.budget} and highlight cultural, dining, and shopping experiences.`,
  };

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return {
      itinerary: 'Unable to connect to Gemini. Please verify your API key and network connection.',
    };
  }

  const data = await response.json();
  const itinerary = data?.candidates?.[0]?.content ?? data?.output?.[0]?.content ?? '';

  return {
    itinerary: itinerary || 'Gemini did not return an itinerary. Please try again later.',
  };
}
