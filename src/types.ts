export type UserRole = 'tourist' | 'resident' | 'merchant' | 'admin';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string;
  role: UserRole;
  locale: 'en' | 'ar';
}

export interface Coupon {
  id: string;
  title: string;
  description: string;
  discount: string;
  merchant: string;
  category: string;
  validUntil: string;
}

export interface TripRequest {
  destination: string;
  duration: string;
  interests: string;
  budget: string;
}

export interface TripResponse {
  itinerary: string;
}
