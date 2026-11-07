# Scattered Contextual Imagery Across Pool Party Website

Scatter authentic, high-fidelity poolside and venue photography organically across the existing sections of the Pool Party website—enhancing the Hero, Lineup, Ticket Tiers, and Venue sections without a standalone gallery.

### User Review & Critical Decisions

> [!IMPORTANT]
> Revised per your feedback: **No dedicated or standalone gallery**. Instead, curated photography is embedded directly into the flow of existing components so visitors naturally experience the venue, vibes, and VIP perks as they scroll.

- **Revised Layout Strategy**: Instead of clustering photos into a single gallery or grid, images are scattered across four key existing sections:
  1. **Lineup & Vibe Cards**: Embedding photography directly into the Trevor DJ and Sunset Headline stage cards.
  2. **Ticket Category Tier Cards (Ordinary vs. VIP)**: Adding vivid tier-specific imagery directly inside the Ordinary Pass (poolside daybeds) and VIP Pass (twilight cabana lounge & bottle service) checkout cards.
  3. **Venue & RSVP Location Block**: Embedding the Prince Resort Bunamwaya architectural pool deck photo alongside the Google Maps and contact panel.
  4. **Lifestyle Accent Spots**: Adding natural photo accents for poolside cocktails/grill and daytime water lounging within the existing flow.
- **Visual Aesthetic**: Vibrant tropical day-to-night poolside party aesthetic with authentic Ugandan resort lighting, clear waters, and warm twilight tones.
- **Preservation Principle**: No disruptive full-page overlays, no heavy carousels, and no disruption to the existing Supabase live inventory or MTN Mobile Money payment flows.

---

### 1. Overview & Core Concept

- **What It Does**: Distributes high-resolution, thematic photography across the existing website sections so that imagery supports the copy and value proposition at every touchpoint.
- **Target Audience / Persona**: Attendees, party groups, and VIP guests exploring the event details, lineup, ticket options, and location.
- **Key Value**: Provides effortless visual context throughout the browsing journey. Visitors immediately see the stage setup when reading about Trevor DJ, see the VIP cabana experience when choosing their ticket tier, and see the resort grounds when looking up the venue.

---

### 2. User Experience & Visual Placement

#### Scattered Image Touchpoints
1. **Lineup & Stage Section (`LineupAndVibe.tsx`)**:
   - **Host & Stage Card**: Feature image of the poolside DJ booth and high-energy acoustic sound rig integrated into the Trevor DJ card.
   - **Sunset Headline Card**: Atmospheric twilight poolside silhouette photo illustrating the sun setting over Bunamwaya for the Surprise Artist announcement.
2. **Ticket Purchase Tiers (`TicketPurchase.tsx`)**:
   - **Ordinary Pass Card (UGX 20,000)**: Embedded photo showing the sun-drenched turquoise resort pool and day loungers.
   - **VIP Pass Card (UGX 50,000)**: Embedded luxury photo showcasing private covered cabanas, twilight lighting, and dedicated bottle service attendants.
3. **Venue & Location Block (`VenueAndRsvp.tsx`)**:
   - **Resort Grounds Photo**: High-resolution wide photograph of Prince Resort Bunamwaya's pool deck and palm gardens embedded right above the Google Maps action button.
4. **Poolside Hospitality Accents**:
   - Subtle, crisp photo pairings for tropical cocktails / grill bites and poolside relaxation woven into the event details without disturbing the clean layout.

#### Visual Styling & Layout Discipline
- **Aspect Ratio & Containment**: Clean `16:9` and `4:3` cropped imagery with smooth rounded corners (`rounded-xl`), subtle hairline borders (`border border-white/10`), and gentle dark gradient scrims (`bg-gradient-to-t from-[#080c14] via-transparent to-transparent`) ensuring all typography remains 100% legible.
- **Anti-Slop Cleanliness**:
  - No decorative floating sticker frames, no generic sparkle overlays, and no broken external image links.
  - Zero pill-badge sandwiches on image headers.
  - Full responsive optimization for small mobile screens (320px–375px) up to 1440px desktop displays.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Section-Integrated Photography vs. Dedicated Gallery Section**
  - *Chosen Approach*: Scatter photos directly into the sections where decisions happen (Lineup, Tickets, Venue).
  - *Why*: Eliminates user fatigue from scrolling through an isolated gallery block. Placing images directly next to ticket options and venue directions directly reinforces the purchase decision.
  - *Alternatives Considered*: The standalone Bento gallery was removed per your explicit instruction.

- **Decision 2: Lightweight Asset Integration**
  - *Chosen Approach*: Leverage existing verified assets in `src/assets/images/` with optimized responsive loading (`loading="lazy"`, `referrerPolicy="no-referrer"`).
  - *Why*: Instant page load with zero network latency, zero external CDN dependencies, and guaranteed stability on Vercel.

---

### 4. Technical Architecture & Component Mapping

```
┌─────────────────────────────────────────────────────────────────┐
│                           App.tsx                               │
│                                                                 │
│  ├── Hero.tsx                                                   │
│  │   └── Ambient resort pool backdrop with subtle dark scrim    │
│  │                                                              │
│  ├── LineupAndVibe.tsx (UPDATED)                                │
│  │   ├── Trevor DJ Host Card ──► [Poolside Sound Deck Photo]    │
│  │   └── Surprise Artist Card ─► [Twilight Sunset Vibe Photo]   │
│  │                                                              │
│  ├── TicketPurchase.tsx (UPDATED)                               │
│  │   ├── Ordinary 20K Tier Card ──► [Daybed & Pool Water Photo] │
│  │   └── VIP 50K Tier Card ───────► [VIP Cabana & Lounge Photo] │
│  │                                                              │
│  └── VenueAndRsvp.tsx (UPDATED)                                 │
│      └── Prince Resort Bunamwaya ──► [Resort Grounds Photo]     │
└─────────────────────────────────────────────────────────────────┘
```

#### Files to Update During Execution
1. `src/components/LineupAndVibe.tsx`: Embed stage & twilight sunset imagery into the host and headline cards.
2. `src/components/TicketPurchase.tsx`: Add tier-specific visual cards illustrating Ordinary vs. VIP experiences.
3. `src/components/VenueAndRsvp.tsx`: Embed the Prince Resort pool deck photo above the location & directions button.
4. `test/supabase-ticketing.test.ts`: Verify test suite and build stability.
