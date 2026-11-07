# Pool Party Imagery & Venue Showcase Gallery

Integrate high-fidelity photography across Prince Resort Bunamwaya's venue showcase, poolside vibes, and VIP experience gallery with an interactive lightbox preview and direct ticket-booking CTAs.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following directions were confirmed during interactive clarification and shape this visual implementation:

- **Confirmed Image Placement**: Prominently featured across a dedicated **Venue Showcase & Poolside Experience Gallery** (between Lineup and Ticket Purchase), the **Venue & Location Section**, and the **VIP Cabana Spotlight**.
- **Confirmed Visual Aesthetic**: **Vibrant tropical day-to-night poolside party aesthetic**—warm sun-drenched turquoise waters, lush palm foliage, stylish resort loungers, ambient twilight pool illumination, and premium cocktail hospitality.
- **Interaction Model (Default)**: **Inline curated photo cards with lightbox modal preview**—visitors can tap any photo to view full-resolution photography, descriptive experience captions, and an instant "Get Tickets" shortcut.

---

### 1. Overview & Core Concept

- **What It Does**: Enhances the Pool Party 2026 landing page with vivid, authentic visual proof of the event atmosphere at Prince Resort Bunamwaya. Combines high-resolution photography with clear captions, a responsive asymmetric Bento gallery layout, and an accessible, smooth image lightbox modal.
- **Target Audience / Persona**: Event-goers, music lovers, VIP table bookers, and party groups in Kampala and Wakiso looking for a premium, high-energy poolside social retreat.
- **Key Value**: Replaces text-heavy descriptions with rich visual evidence of the luxury resort pool, sound setup, tropical cocktails, and VIP cabanas, dramatically increasing buyer confidence and ticket conversions.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Browsing the Event Flow**: As attendees scroll past the Hero and Lineup sections, they encounter a visually captivating 4-card asymmetric Bento gallery titled **The Poolside & Venue Experience**.
2. **Category Tabs & Filtering**: Users can filter between curated perspectives:
   - `All Moments`: The complete 6-image curated collection.
   - `Poolside Vibes`: Sun deck loungers, crystal water, and day-to-night swim atmosphere.
   - `VIP & Cabanas`: Private shaded lounges, twilight lighting, and bottle service setups.
   - `Sound & Sips`: Trevor DJ acoustic sound booth, fresh fruit smoothies, and artisan cocktails.
3. **Interactive Lightbox Inspection**: Clicking any image opens a distraction-free, high-resolution modal with:
   - Full-bleed image scaling with preserved aspect ratio.
   - Editorial caption and ambient detail tag (e.g., *Heated Water*, *Twilight Illumination*, *VIP Bottle Service*).
   - Navigation controls (Next / Previous buttons, keyboard Left/Right arrows, ESC to close).
   - Direct CTA: *"Reserve Passes from UGX 20,000"*, which smoothly scrolls to the live ticket inventory.
4. **Venue & Location Integration**: In the `Venue & RSVP` section, a contextual resort venue preview card is embedded alongside the Google Maps button, anchoring the physical location at Bunamwaya Bella Zone.

#### Visual Identity & Theme
- **Color Discipline (60-30-10)**:
  - `60% Neutral Canvas`: Deep obsidian `#080c14` and rich midnight slate `#0d1522`.
  - `30% Structural Surfaces`: Hairline borders (`border-white/10`), subtle dark glass panels (`bg-[#050b14]/70`), and crisp unboxed text metadata with `·` separators.
  - `10% Accent Intent`: Warm marigold/amber (`#F59E0B`) for VIP cues and primary CTAs, with tropical electric cyan (`#06B6D4`) for water highlights.
- **Typography**:
  - Display Headings: Bold geometric headline typography (`font-display font-black tracking-tight text-white`).
  - Editorial Kicker: Natural human title-case subheadings (`01. Crystal Waters & Sun Loungers`, `02. Twilight VIP Cabanas`).
  - No code-comment prefixes (`//`), no mechanical uppercase tags, and no arbitrary badge islands.
- **Accessibility & Touch Targets**:
  - All interactive thumbnail triggers and lightbox buttons have $\ge 44\text{px}$ touch targets.
  - Full keyboard trap and focus restoration (`Esc` key, arrow keys, `Tab` cycling) in the lightbox modal.
  - Image tags enforce `referrerPolicy="no-referrer"`, descriptive `alt` text, and graceful CSS skeleton fallback containers.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Asymmetric Bento Gallery vs. Generic Carousel**
  - *Chosen Approach*: Responsive 12-column asymmetric Bento layout with 1 marquee feature card (`col-span-7`) alongside balanced supporting cards (`col-span-5`), accompanied by an interactive modal.
  - *Why*: Horizontal carousels hide 70% of photos on desktop screens; an asymmetric Bento grid immediately rewards visual scannability on both desktop and mobile without requiring tedious swiping.
  - *Alternatives Considered*: A slider/carousel was considered but dismissed as it reduces immediate visual impact and requires more user effort.

- **Decision 2: Image Pipeline & Fallback Discipline**
  - *Chosen Approach*: Curate the existing high-fidelity Prince Resort visual assets in `src/assets/images/` and generate two supplementary high-resolution assets (VIP twilight cabana lounge & tropical pool entry) via `generate_image`.
  - *Why*: Eliminates broken third-party image URLs, guarantees zero-latency asset loading, and ensures consistent lighting and color grading across the entire landing page.
  - *Alternatives Considered*: External Unsplash or CDN links were rejected per the anti-slop and hermetic build constraints.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                           App.tsx                               │
│  ├── Navbar (Header navigation with smooth scroll anchors)      │
│  ├── Hero (Event branding, date, countdown, 20K/50K selector)   │
│  ├── LineupAndVibe (Trevor DJ, surprise headliner, DJ roster)   │
│  ▼                                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ExperienceGallery.tsx (NEW)                               │  │
│  │ ├── Interactive Filter Tabs (All / Pool / VIP / Sips)     │  │
│  │ ├── Asymmetric Bento Grid of 4–6 Curated Image Cards      │  │
│  │ └── Lightbox Trigger Handlers (Click / Enter / Space)     │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ▼                                                              │
│  ├── TicketPurchase.tsx (Supabase live inventory 20K / 50K)     │
│  ├── VenueAndRsvp.tsx (Updated with Prince Resort photo preview)│
│  └── Footer.tsx                                                 │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ImageLightboxModal.tsx (NEW)                              │  │
│  │ ├── Fullscreen Backdrop with backdrop-blur & dark scrim   │  │
│  │ ├── High-res Image Renderer with aspect-ratio containment │  │
│  │ ├── Keyboard Navigation (ESC, Left, Right Arrow Keys)     │  │
│  │ └── Direct Booking CTA ("Reserve Passes From UGX 20,000") │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### Image Asset Inventory
1. `resort_pool_luxury`: Main resort pool with sun loungers and crystal water (Hero & Bento anchor).
2. `pool_atmosphere`: Daytime poolside ambiance, floating loungers, and tropical greenery.
3. `vip_cabana_twilight`: Luxury twilight cabana with ambient underwater illumination and plush seating.
4. `poolside_music`: Trevor DJ acoustic sound booth and poolside audio setup.
5. `pool_refreshments`: Artisan tropical fruit cocktails, chilled drinks, and grill comfort food.
6. `resort_venue_prince`: Architectural exterior and pool deck landscape at Bunamwaya Bella.

#### Interactive Component & State Mapping
- `activeCategory`: String state (`'all' | 'pool' | 'vip' | 'music_sips'`) controlling the displayed Bento set.
- `lightboxIndex`: Number or `null` state in `ExperienceGallery.tsx`. When non-null, `<ImageLightboxModal>` renders with the active photo index, handling cycling via `(index + 1) % total` and `(index - 1 + total) % total`.
- `onBookPasses`: Triggers a smooth scroll to `#tickets` while closing the lightbox modal.
