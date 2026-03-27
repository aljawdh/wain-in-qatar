# Wain in Qatar

## Product Specification

Wain in Qatar is a bilingual travel guide and coupon marketplace targeting:
- Tourists exploring Qatar with curated itineraries and offers.
- Residents seeking local deals and experiences.
- Merchants publishing coupons and managing promotions.
- Admins overseeing user activity and marketplace content.

### Core Features
- AI-powered trip planner using Google Gemini.
- Coupon marketplace for dining, shopping, and experiences.
- Firebase Auth for email/password sign in.
- Firestore backend for user roles and data storage.
- RTL support with Arabic and English language switching.
- Responsive UI with maroon, cream, and gold branding.

### User Flows
- Auth: Login, signup, protected dashboard pages.
- Browsing: Home, planner, marketplace pages.
- Purchasing: Activate coupons and view offers.
- Dashboards: User, merchant, and admin access control.

## Architecture

- Frontend: React, TypeScript, Vite, Tailwind CSS, React Router.
- State: Context API for auth and locale management.
- Backend: Firebase Auth and Firestore database.
- AI Integration: Google Gemini API for itinerary generation.

## Folder Structure

- `src/`
  - `App.tsx`
  - `main.tsx`
  - `index.css`
  - `vite-env.d.ts`
  - `components/Navigation.tsx`
  - `context/AuthContext.tsx`
  - `context/LocaleContext.tsx`
  - `routes/ProtectedRoute.tsx`
  - `pages/` (Home, Login, Signup, Planner, Marketplace, Dashboard, Merchant, Admin, NotFound)
  - `lib/firebase.ts`
  - `lib/gemini.ts`
  - `data/` (translations, mock coupons)
  - `types.ts`
- `index.html`
- `.env.example`
- `package.json`
- `vite.config.ts`
- `tailwind.config.js`
- `postcss.config.js`

## Setup

1. Copy `.env.example` to `.env`.
2. Set Firebase values and `VITE_GEMINI_API_KEY`.
3. Run:
   ```bash
   npm install
   npm run dev
   ```
4. Visit `http://localhost:4173`.

## Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com.
2. Enable Email/Password sign-in in Authentication.
3. Create a Firestore database in production or test mode.
4. Copy config values into `.env`.

## Gemini API Setup

1. Create a Google Cloud project and enable Gemini API.
2. Create an API key with access to the Gemini model.
3. Add `VITE_GEMINI_API_KEY` to `.env`.

## Git Commands

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin <repo_url>
git push -u origin main
```

## Vercel Deployment

1. Create a new Vercel project from this repository.
2. Set environment variables in Vercel matching `.env.example`.
3. Use the default build command:
   - Build command: `npm run build`
   - Output directory: `dist`

## Notes

- The application is ready for production build and supports both LTR and RTL locales.
- A Firebase project and Gemini API key are required for auth and AI trip planning.
