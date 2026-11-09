/**
 * Help & Support answers. They follow BOOKING_WORKFLOW.md §4.1 (cancellations and refunds), API_DOCUMENTATION.md
 * §8.4, §9, §10b and PAYMENT_INTEGRATION.md: change them together with the rules.
 */
export interface FaqSection {
  id: string;
  title: string;
  items: { question: string; answer: string }[];
}

export const FAQ: readonly FaqSection[] = [
  {
    id: 'cancellations',
    title: 'Cancellations',
    items: [
      {
        question: 'How do I cancel a booking?',
        answer:
          'Open My Trips, choose the booking and select "Cancel booking". Before you confirm, you see the cancellation fee and exactly how much you get back.',
      },
      {
        question: 'Until when can I cancel?',
        answer:
          'Confirmed hotel stays can be cancelled online until the check-in time (hotel local time). Flights can be cancelled until 4 hours before the first departure. Bookings that are not confirmed yet cannot be cancelled; an unpaid booking simply expires when the time to pay runs out.',
      },
      {
        question: 'What does cancelling cost?',
        answer:
          'It depends on the terms you accepted when you booked; your booking shows them. Hotels: free until the free-cancellation date, then a share of the stay price; non-refundable rates are not refunded. Flights: a share of the fare (all of it for non-refundable fares), while taxes and airline charges come back. A coupon discount is not given back.',
      },
      {
        question: 'When is my booking really cancelled?',
        answer:
          'As soon as the hotel or airline confirms it, usually within minutes. Until then your booking stays valid. If they refuse, your booking stays confirmed, we e-mail you why, and a support ticket is opened for you automatically.',
      },
    ],
  },
  {
    id: 'refunds',
    title: 'Refunds',
    items: [
      {
        question: 'When do I get my money back?',
        answer:
          'Once the hotel or airline has confirmed the cancellation, we send the refund (what you paid minus the cancellation fee) back to the payment method you used. You can follow it in My Trips and in Payment history. How long your bank takes to show it depends on the bank.',
      },
      {
        question: 'I paid, but my booking could not be confirmed. What happens?',
        answer:
          'You get the full amount back automatically, for example when the hotel or airline could not confirm, or when the payment arrived after the time to pay had run out. You do not need to do anything.',
      },
      {
        question: 'My refund is taking long. What can I do?',
        answer:
          'Check the booking in My Trips first: it shows every refund and its status. If a refund failed, our team is alerted and sends it again. You can also create a support ticket for the booking.',
      },
    ],
  },
  {
    id: 'documents',
    title: 'Documents',
    items: [
      {
        question: 'Where do I find my confirmation, e-ticket and invoice?',
        answer:
          'On the booking\'s page in My Trips, under "Documents". My Trips also has a "Download confirmation" button, and Payment history has your receipts and invoices. Confirmations, e-tickets, receipts and cancellation documents are also attached to our e-mails.',
      },
      {
        question: 'My documents are not there yet.',
        answer:
          'Documents are made a few seconds after the booking is confirmed or the payment is received, and the page shows them by itself. The tax invoice is issued once the booking is confirmed.',
      },
      {
        question: 'Why do I need to log in to download them?',
        answer: 'Your documents contain personal details, so only you (and our support team) can download them, and only while logged in.',
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments',
    items: [
      {
        question: 'How can I pay?',
        answer:
          'Payments are made in Razorpay\'s secure window: card, UPI or net banking. Your card and UPI details are typed into Razorpay\'s window and are never stored by us.',
      },
      {
        question: 'How long do I have to pay?',
        answer:
          'Your room or seats are held for a short time after you book; the payment page shows a timer. If the time runs out, the booking expires and nothing is charged.',
      },
      {
        question: 'My payment failed. Was I charged?',
        answer:
          'No money is taken for a failed payment. You can try again while the timer on the payment page is still running. Payment history shows every attempt.',
      },
    ],
  },
];
