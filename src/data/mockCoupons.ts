import type { Coupon } from '../types';

export const mockCoupons: Coupon[] = [
  {
    id: 'c1',
    title: 'Dine with Gold Discount',
    description: '15% off at top Doha restaurants with premium dining experiences.',
    discount: '15% off',
    merchant: 'Souq Gourmet',
    category: 'Dining',
    validUntil: '2026-12-31',
  },
  {
    id: 'c2',
    title: 'Desert Adventure Voucher',
    description: 'Exclusive savings for dune bashing, camel riding, and luxury campsite entry.',
    discount: 'QR 80 off',
    merchant: 'Qatar Safari Tours',
    category: 'Experiences',
    validUntil: '2026-10-15',
  },
  {
    id: 'c3',
    title: 'Souvenir Shopping Pass',
    description: 'Save 20% at select artisan markets and luxury mall boutiques.',
    discount: '20% off',
    merchant: 'Qatar Souq',
    category: 'Shopping',
    validUntil: '2026-11-30',
  },
];
