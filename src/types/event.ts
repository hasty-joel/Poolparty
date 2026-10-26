/**
 * Event Types & Data strictly aligned with Official Poster
 */

export type TicketTier = 'ordinary' | 'vip';

export interface TicketTierInfo {
  id: TicketTier;
  name: string;
  priceUgx: number;
  label: string;
  perks: string[];
}

export const TICKET_TIERS: Record<TicketTier, TicketTierInfo> = {
  ordinary: {
    id: 'ordinary',
    name: 'Ordinary',
    priceUgx: 20000,
    label: '20K',
    perks: [
      'Full Pool Access & Swim Area',
      'Live DJ Music & MC Performances',
      'Access to Swimwear Contest & Games',
      'Digital QR Code Ticket to Email & SMS',
    ],
  },
  vip: {
    id: 'vip',
    name: 'VIP',
    priceUgx: 50000,
    label: '50K',
    perks: [
      'Fast-track VIP Gate Entry',
      'Reserved Poolside Lounge & Cabana Area',
      'Complimentary Welcome Drink & BBQ skewer',
      'Dedicated Table & Bottle Service',
      'Close Proximity to DJ Booth & Surprise Artist Stage',
    ],
  },
};

export const EVENT_DATA = {
  name: 'POOL PARTY',
  venue: 'Prince Resort',
  subVenue: 'Bunamwaya Bella',
  city: 'Kampala / Wakiso',
  country: 'Uganda',
  date: 'Friday, December 11th 2026',
  time: '12 PM – till late',
  host: 'Trevor DJ',
  specialGuest: 'Special Surprise Artist',
  lineup: [
    { role: 'MC', name: 'MC Benji' },
    { role: 'DJ', name: 'DJ Liquid' },
    { role: 'MC', name: 'MC Jace' },
    { role: 'DJ', name: 'DJ Trizy' },
    { role: 'DJ', name: 'DJ Wicky' },
    { role: 'DJ', name: 'DJ Xela' },
  ],
  activities: [
    { title: 'Live DJ Music', icon: 'headphones', desc: 'Non-stop Afrobeats, Amapiano & Dancehall' },
    { title: 'Swimwear Contest', icon: 'swimmer', desc: 'Poolside runway & prizes for best drip' },
    { title: 'Party Games', icon: 'flame', desc: 'Eat My Apple & Truth or Dare challenges' },
    { title: 'Live Barbeque', icon: 'utensils', desc: 'Poolside grill, skewers & chilled drinks' },
  ],
  rsvpPhone: '+256 775 198484',
  rsvpTel: '+256775198484',
  rsvpWhatsApp: 'https://wa.me/256775198484',
  googleMapsUrl: 'https://maps.google.com/?q=Prince+Resort+Bunamwaya+Bella+Uganda',
  flyerImage: '/public/assets/aistudio/Luxury_Tropical_Pool_Party_Flyer_724fe1fb.png',
};

export type PaymentMethod = 'mtn_momo' | 'airtel_money' | 'card';

export interface BuyerForm {
  fullName: string;
  email: string;
  phone: string;
  tier: TicketTier;
  quantity: number;
  paymentMethod: PaymentMethod;
}

export interface ReservationOrder {
  orderId: string;
  timestamp: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  tier: TicketTier;
  tierName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  paymentMethod: PaymentMethod;
  status: 'pending_payment' | 'integration_sandbox';
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category?: string;
}

