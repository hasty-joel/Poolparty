import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { FAQItem } from '../types/event';

const FAQ_LIST: FAQItem[] = [
  {
    id: 'receive-ticket',
    question: 'How do I receive my ticket?',
    answer: 'Once your payment is confirmed, your official admission pass is instantly delivered to the email address and phone number you provided during checkout. The delivery includes a high-resolution PDF pass and an SMS quick-access link with your unique QR code that can be saved directly to your phone.',
  },
  {
    id: 'qr-entry',
    question: 'How does QR-code entry work at Prince Resort?',
    answer: 'At the entrance gate, simply present your digital QR code on your smartphone screen (or a printed copy) to the event check-in staff. Our gate scanner reads the cryptographic signature in under two seconds to confirm validity and admits you to the resort grounds.',
  },
  {
    id: 'payment-failure',
    question: 'What happens if my payment fails?',
    answer: 'If your MTN Mobile Money prompt times out, you enter an incorrect PIN, or your card bank declines the transaction, your reservation is safely rolled back without deducting any money. You will receive an on-screen notice with options to retry or switch between MTN MoMo, Airtel Money, or Card.',
  },
  {
    id: 'reuse-ticket',
    question: 'Can I reuse a ticket or share a screenshot with friends?',
    answer: 'No. Every individual ticket code is strictly single-use. Once the gate scanner validates your QR code upon initial entry, that ticket is immediately stamped as "USED" in the system. Any duplicate presentation of the same QR code will trigger an invalid entry warning.',
  },
  {
    id: 'refund-policy',
    question: 'What is the refund and cancellation policy?',
    answer: '[Organizer Policy Placeholder] Ticket purchases are generally non-refundable except in the unexpected case of full event postponement or cancellation by the organizers. If you are unable to attend, ticket transfers to another person are permitted up to 7 days prior to Friday, 11 December 2026 by contacting event support.',
  },
  {
    id: 'age-dress-code',
    question: 'What is the age requirement and recommended dress code?',
    answer: 'POOL PARTY is strictly an 18+ event. Please have a valid National ID, passport, or driving permit ready for age verification. The dress code is upscale resort pool chic — stylish swimwear, linen shirts, poolside coverups, and sunglasses.',
  },
  {
    id: 'outside-refreshments',
    question: 'Are outside food and drinks allowed into the resort?',
    answer: 'Outside beverages and food are not permitted inside Prince Resort. The venue features multiple staffed cocktail bars, fresh fruit smoothie stations, and a poolside grill serving barbecue and light bites all day and night.',
  },
  {
    id: 'parking-security',
    question: 'Is parking available and secure?',
    answer: 'Yes, Prince Resort offers guarded on-site parking for all ticket holders. We also strongly recommend utilizing Kampala rideshare services (Uber, SafeBoda, Bolt) for convenient drop-off and pickup right at the main reception entrance.',
  },
];

export const FAQ: React.FC = () => {
  const [openId, setOpenId] = useState<string | null>('receive-ticket');

  const toggleItem = (id: string) => {
    setOpenId(openId === id ? null : id);
  };

  return (
    <section id="faq" className="py-24 bg-[#030712] relative border-t border-white/[0.06]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-14">
          <div className="text-xs font-semibold tracking-widest text-cyan-400 uppercase mb-2">
            Got Questions?
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white font-display [text-wrap:balance]">
            Frequently Asked Questions
          </h2>
          <p className="mt-3 text-base text-slate-300">
            Everything you need to know about ticketing, gate entry, and event day policies.
          </p>
        </div>

        {/* FAQ Accordion */}
        <div className="space-y-3">
          {FAQ_LIST.map((item) => {
            const isOpen = openId === item.id;
            return (
              <div
                key={item.id}
                className="glass-panel-subtle rounded-xl border border-white/10 overflow-hidden transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left text-white font-semibold hover:text-cyan-300 transition-colors cursor-pointer gap-4"
                  aria-expanded={isOpen}
                >
                  <span className="text-sm sm:text-base font-medium">{item.question}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-cyan-400 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-6 pb-5 pt-1 text-slate-300 text-sm leading-relaxed border-t border-white/5 animate-fadeIn">
                    <p>{item.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Support Help Box */}
        <div className="mt-12 p-6 glass-panel rounded-2xl border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <HelpCircle className="w-6 h-6 text-cyan-400 shrink-0" />
            <div>
              <h4 className="text-white font-semibold text-sm">Have additional questions?</h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Our support team is available for group booking inquiries and resort policy clarifications.
              </p>
            </div>
          </div>
          <a
            href="mailto:support@poolparty.ug"
            className="px-5 py-2.5 text-xs font-semibold text-slate-200 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            Contact Organizer Support
          </a>
        </div>
      </div>
    </section>
  );
};
