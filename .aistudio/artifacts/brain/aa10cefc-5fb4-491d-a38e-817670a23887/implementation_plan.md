# MTN MoMoPay Validity Approval & End-to-End Verification Guide

Comprehensive breakdown of how MTN MoMo merchant code payments are validated in the Pool Party ticketing system, covering automated real-time SMS matching, the manual Admin MoMo Desk approval flow, and an interactive end-to-end verification test procedure.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The application uses a secure dual-track validation architecture. Payments are never approved automatically based on customer input alone.

- **Track 1 (Automated Instant Verification)**: Triggered when an Android SMS forwarder or telecom gateway posts an incoming MTN MoMo notification to `/api/sms-listener`. The server parses the SMS, validates the exact amount and matching `POOL-XXXX` reference, transitions the order to `paid`, and issues cryptographically signed QR tickets.
- **Track 2 (Admin Manual Desk Verification)**: Triggered when an administrator logs into the Admin Dashboard (`ADMIN_PASSCODE = adminpoolparty`), inspects the `MTN MoMo Desk` tab, verifies the transaction ID against the official merchant SIM/portal, and clicks **Verify & Issue Ticket**.

---

## 1. Overview & Core Concept

When a buyer completes checkout on the website, they are assigned a unique reservation reference (e.g. `POOL-4821`) and instructed to dial `*165*3#` to pay the merchant code (`672190`). Because USSD payments happen externally on the customer's phone, validity is confirmed via one of two authoritative mechanisms:

```
                  ┌──────────────────────────────────────────────┐
                  │ Customer Pays via MTN USSD (*165*3#)         │
                  │ Enters Merchant Code 672190 + Ref POOL-XXXX  │
                  └──────────────────────┬───────────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
      ┌───────────────────────────┐             ┌───────────────────────────┐
      │  Track 1: Automated SMS   │             │   Track 2: Admin Desk     │
      │  Incoming MTN SMS Webhook │             │  Customer submits Tx ID   │
      │  matches POOL-XXXX + UGX  │             │  Admin audits MoMo portal │
      └─────────────┬─────────────┘             └─────────────┬─────────────┘
                    │                                         │
                    ▼                                         ▼
      ┌─────────────────────────────────────────────────────────────────────┐
      │  Secure Supabase Server Transition to PAID                          │
      │  - Validates stock inventory                                        │
      │  - Generates unique QR tokens & Canva-ready ticket assets           │
      │  - Unlocks Instant WhatsApp Delivery Button                         │
      │  - Enables Entrance Gate QR Scanner Validation                      │
      └─────────────────────────────────────────────────────────────────────┘
```

---

## 2. User Experience & Verification Flows

### Flow A: Automated SMS Match (Customer Perspective)
1. Customer selects ticket tier (VIP @ UGX 50,000 or Ordinary @ UGX 20,000).
2. Customer is shown the **MTN MoMoPay Checkout** modal with Merchant Code `672190` and reference `POOL-XXXX`.
3. Customer dials `*165*3#` on their handset and puts `POOL-XXXX` in the reason field.
4. The merchant phone receives: *"You have received UGX 50,000 from 25677... Ref: POOL-XXXX. Balance: UGX... TxId: 1984729184"*.
5. The SMS is posted to `/api/sms-listener`.
6. The customer's checkout modal automatically updates to **Payment Verified · Tickets Issued** without refreshing, displaying their QR code and **Send Ticket on WhatsApp** button.

### Flow B: Admin Manual Verification Desk (Administrator Perspective)
1. Customer pays but enters their Transaction ID manually into Step 2 of the checkout modal.
2. The order appears in the **Admin Dashboard** (`/admin` with passcode `256256`) under the **MTN MoMo Desk** tab.
3. The Admin views:
   - Customer Full Name, Email, and Phone Number
   - Pass Tier (VIP or Ordinary) & Quantity
   - Total UGX Amount Due
   - Customer-Submitted MTN Transaction ID & Order Reference
4. The Admin opens their physical MTN Merchant phone or MTN MoMo business portal, searches the transaction ID, and confirms the funds have arrived.
5. The Admin clicks **Verify & Issue Ticket**:
   - A modal prompt confirms: *"Have you independently verified transaction in your official MTN Merchant account?"*
   - Once confirmed, the system activates the ticket QR code in the database and prevents duplicate verification.
   - The Admin can click **Send Ticket on WhatsApp** to dispatch the ticket directly to the customer.
6. If the transaction ID is fraudulent or unreceived, the Admin clicks **Reject Payment**, inputs a rejection reason, and the reserved tickets are immediately returned to available inventory.

---

## 3. Step-by-Step Walk-Through Test Guide

To test the entire approval and verification process right now in the app:

### Step 1: Place a Test Order as a Customer
1. Scroll to the **Select Your Pool Pass** section on the homepage.
2. Select **1x Ordinary Pass (UGX 20,000)** or **VIP Pass (UGX 50,000)**.
3. Fill in the form:
   - Full Name: `Joel Test`
   - Email: `joel@example.com`
   - Phone: `0775198484`
4. Click **Continue to MTN MoMoPay Checkout**.
5. Note the generated Order Reference (e.g., `POOL-XXXX`).
6. In the modal, scroll to **Step 2 (Optional)**, enter a simulated MTN Transaction ID (e.g. `1029384756`), and click **Submit Transaction ID**.
7. The modal transitions to **Payment Submitted · Under Admin Verification**.

### Step 2: Open the Admin MoMo Desk
1. Click the **Admin** shield icon in the top navigation or navigate to `/admin`.
2. Enter the Admin Passcode: `adminpoolparty`.
3. Select the **MTN MoMo Desk** tab.
4. Your pending test order will be prominently displayed with the customer details, amount, order reference, and transaction ID.

### Step 3: Approve & Issue Ticket
1. Click the glowing green **Verify & Issue Ticket** button on the order card.
2. In the confirmation dialog, click **Confirm & Activate Ticket**.
3. The order status updates instantly to `PAID`, issuing the QR code.
4. A **Send Ticket on WhatsApp** button appears immediately on the card, formatted with international code `256` and the customer's phone number.

### Step 4: Validate at Gate Check-In
1. Navigate to the **Gate Check-In** scanner tab in the Admin Dashboard.
2. Enter the ticket token or scan the issued QR code.
3. The gate system confirms valid entry, displays attendee details, and marks the pass as `USED` to prevent reuse.

---

## 4. Technical Architecture & Endpoints

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND VERIFICATION API                       │
├──────────────────────────────┬─────────────────────────────────────────┤
│ Endpoint                     │ Role & Security                         │
├──────────────────────────────┼─────────────────────────────────────────┤
│ POST /api/sms-listener       │ Automated SMS parser for incoming MoMo   │
│ POST /api/payments/mtn-submit│ Customer transaction ID submission      │
│ POST /api/admin/mtn-verify   │ Admin verification (Requires Auth)      │
│ POST /api/admin/mtn-reject   │ Admin rejection & stock release (Auth)  │
│ GET  /api/orders/:ref/status │ Real-time polling for checkout modal    │
│ POST /api/admin/check-in     │ Gate QR validation (Single-use stamp)   │
└──────────────────────────────┴─────────────────────────────────────────┘
```
