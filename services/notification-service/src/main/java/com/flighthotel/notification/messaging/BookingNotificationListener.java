package com.flighthotel.notification.messaging;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.booking.BookingCancellationFailed;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.payment.InvoiceIssued;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;
import com.flighthotel.notification.document.Document;
import com.flighthotel.notification.document.DocumentService;
import com.flighthotel.notification.email.BookingEmailComposer;
import com.flighthotel.notification.email.EmailContent;
import com.flighthotel.notification.email.EmailContent.Attachment;
import com.flighthotel.notification.email.EmailSender;
import com.flighthotel.notification.entity.EmailMessage;
import com.flighthotel.notification.entity.EmailMessage.EmailStatus;
import com.flighthotel.notification.preference.NotificationPreferences;
import com.flighthotel.notification.preference.NotificationPreferences.Category;
import com.flighthotel.notification.preference.NotificationPreferences.Channel;
import com.flighthotel.notification.projection.BookingContacts;
import com.flighthotel.notification.projection.BookingContacts.BookingContact;
import com.flighthotel.notification.repository.EmailMessageRepository;
import com.flighthotel.notification.service.NotificationService;
import com.flighthotel.notification.ticket.TicketService;

/**
 * Tells the customer about their booking and money (API_DOCUMENTATION.md section 10): an in-app notification for each
 * step and an e-mail where it matters, with the PDF attached when there is one. Each event is handled once (inbox). If
 * an e-mail cannot be sent the transaction rolls back and Kafka retries; a crash after sending can repeat one e-mail,
 * which is harmless. Documents are generated before the e-mail goes out, so a retry never sends it twice because of a
 * document.
 */
@Component
public class BookingNotificationListener {

    static final String BOOKINGS = "notification-bookings";
    static final String PAYMENTS = "notification-payments";
    private static final Logger log = LoggerFactory.getLogger(BookingNotificationListener.class);

    private final ProcessedEventStore processedEvents;
    private final NotificationService notifications;
    private final NotificationPreferences preferences;
    private final DocumentService documents;
    private final BookingContacts contacts;
    private final TicketService tickets;
    private final BookingEmailComposer composer;
    private final EmailSender sender;
    private final EmailMessageRepository emailMessages;
    private final Clock clock;

    public BookingNotificationListener(ProcessedEventStore processedEvents, NotificationService notifications,
            NotificationPreferences preferences, DocumentService documents, BookingContacts contacts,
            TicketService tickets, BookingEmailComposer composer, EmailSender sender,
            EmailMessageRepository emailMessages, Clock clock) {
        this.processedEvents = processedEvents;
        this.notifications = notifications;
        this.preferences = preferences;
        this.documents = documents;
        this.contacts = contacts;
        this.tickets = tickets;
        this.composer = composer;
        this.sender = sender;
        this.emailMessages = emailMessages;
        this.clock = clock;
    }

    @KafkaListener(id = BOOKINGS, groupId = BOOKINGS, topics = "booking.events")
    @Transactional
    public void onBookingEvent(ConsumerRecord<String, Object> record) {
        handleBookingEvent(EventHeaders.eventId(record), record.value());
    }

    @KafkaListener(id = PAYMENTS, groupId = PAYMENTS, topics = "payment.events")
    @Transactional
    public void onPaymentEvent(ConsumerRecord<String, Object> record) {
        handlePaymentEvent(EventHeaders.eventId(record), record.value());
    }

    /** Also called directly by tests (same transaction rules). */
    @Transactional
    public void handleBookingEvent(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, BOOKINGS)) {
            return;
        }
        switch (event) {
            case BookingAwaitingPayment awaiting -> {
                UUID userId = UUID.fromString(awaiting.getUserId());
                notifications.create(userId, "BOOKING", "Complete your payment", "Booking "
                                + awaiting.getBookingReference() + " is held for you: pay "
                                + BookingEmailComposer.format(awaiting.getAmount()) + " to confirm it.",
                        "/my-trips/" + awaiting.getBookingId() + "/pay", eventId);
                email(eventId, userId, awaiting.getContactEmail(), "BOOKING_RECEIVED", Category.BOOKING,
                        composer.bookingReceived(awaiting));
            }
            case BookingConfirmed confirmed -> {
                UUID userId = UUID.fromString(confirmed.getUserId());
                notifications.create(userId, "BOOKING", "Booking confirmed",
                        "Your booking " + confirmed.getBookingReference() + " is confirmed.",
                        "/my-trips/" + confirmed.getBookingId(), eventId);
                List<Document> attached = new ArrayList<>();
                attached.add(documents.confirmation(confirmed));
                documents.eTicket(confirmed).ifPresent(attached::add);
                email(eventId, userId, confirmed.getContactEmail(), "BOOKING_CONFIRMED", Category.BOOKING,
                        composer.confirmation(confirmed).withAttachments(attachments(attached)));
            }
            case BookingRefundRequested refund -> {
                UUID userId = UUID.fromString(refund.getUserId());
                notifications.create(userId, "REFUND", "Refund started",
                        "A refund of " + BookingEmailComposer.format(refund.getAmount()) + " for booking "
                                + refund.getBookingReference() + " is on its way.",
                        "/my-trips/" + refund.getBookingId(), eventId);
                // A cancellation's refund is already explained in the cancellation e-mail.
                if (!"CANCELLATION".equals(refund.getReason())) {
                    email(eventId, userId, refund.getContactEmail(), "REFUND_STARTED", Category.REFUND,
                            composer.refundStarted(refund));
                }
            }
            case BookingCancelled cancelled -> {
                UUID userId = UUID.fromString(cancelled.getUserId());
                boolean byTheHotel = "HOTEL".equals(cancelled.getInitiatedBy());
                notifications.create(userId, "BOOKING", byTheHotel ? "The hotel cancelled your stay" : "Booking cancelled",
                        (byTheHotel ? "We are sorry: the hotel had to cancel booking " + cancelled.getBookingReference()
                                + ". Full refund: " : "Your booking " + cancelled.getBookingReference()
                                + " is cancelled. Refund: ")
                                + BookingEmailComposer.format(cancelled.getRefundAmount()) + ".",
                        "/my-trips/" + cancelled.getBookingId(), eventId);
                Document confirmation = documents.cancellation(cancelled);
                email(eventId, userId, cancelled.getContactEmail(), "BOOKING_CANCELLED", Category.BOOKING,
                        composer.cancelled(cancelled).withAttachments(attachments(List.of(confirmation))));
            }
            case BookingCancellationFailed failed -> {
                UUID userId = UUID.fromString(failed.getUserId());
                notifications.create(userId, "BOOKING", "Cancellation not possible", "Booking "
                                + failed.getBookingReference() + " could not be cancelled and is still valid: "
                                + failed.getMessage(),
                        "/my-trips/" + failed.getBookingId(), eventId);
                tickets.cancellationRefused(failed, eventId);
                email(eventId, userId, failed.getContactEmail(), "CANCELLATION_FAILED", Category.BOOKING,
                        composer.cancellationFailed(failed));
            }
            default -> {
                // Other booking events (initiated, paid, expired, ...) need no message to the customer.
            }
        }
    }

    @Transactional
    public void handlePaymentEvent(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, PAYMENTS)) {
            return;
        }
        switch (event) {
            case PaymentSucceeded succeeded -> {
                UUID userId = UUID.fromString(succeeded.getUserId());
                notifications.create(userId, "PAYMENT", "Payment received", "We received your payment of "
                                + BookingEmailComposer.format(succeeded.getAmount()) + ". We are confirming your booking.",
                        "/my-trips/" + succeeded.getBookingId(), eventId);
                Document receipt = documents.paymentReceipt(succeeded);
                contact(succeeded.getBookingId()).ifPresentOrElse(contact -> email(eventId, userId,
                        contact.contactEmail(), "PAYMENT_RECEIVED", Category.PAYMENT,
                        composer.paymentReceived(succeeded, contact.bookingReference(), contact.description(),
                                contact.greetingName()).withAttachments(attachments(List.of(receipt)))),
                        () -> log.warn("No contact for booking {}: payment e-mail not sent", succeeded.getBookingId()));
            }
            case PaymentFailed failed -> {
                UUID userId = UUID.fromString(failed.getUserId());
                notifications.create(userId, "PAYMENT", "Payment failed",
                        "Your payment did not go through. You can try again before the booking expires.",
                        "/my-trips/" + failed.getBookingId(), eventId);
                contact(failed.getBookingId()).ifPresent(contact -> email(eventId, userId, contact.contactEmail(),
                        "PAYMENT_FAILED", Category.PAYMENT, composer.paymentFailed(failed.getBookingId(),
                                contact.bookingReference(), failed.getFailureReason(), contact.greetingName())));
            }
            case InvoiceIssued invoice -> notifications.create(UUID.fromString(invoice.getUserId()), "PAYMENT",
                    "Your invoice is ready", "Invoice " + invoice.getInvoiceNumber() + " is ready to download.",
                    "/my-trips/" + invoice.getBookingId(), eventId);
            case RefundCompleted completed -> {
                UUID userId = UUID.fromString(completed.getUserId());
                notifications.create(userId, "REFUND", "Refund completed", "Your refund of "
                                + BookingEmailComposer.format(completed.getAmount()) + " was processed.",
                        "/my-trips/" + completed.getBookingId(), eventId);
                Document receipt = documents.refundReceipt(completed);
                contact(completed.getBookingId()).ifPresent(contact -> email(eventId, userId, contact.contactEmail(),
                        "REFUND_COMPLETED", Category.REFUND, composer.refundCompleted(completed,
                                contact.bookingReference(), contact.greetingName())
                                .withAttachments(attachments(List.of(receipt)))));
            }
            case RefundFailed failed -> notifications.create(UUID.fromString(failed.getUserId()), "REFUND",
                    "Refund needs attention", "We could not process your refund yet. Our support team will contact you.",
                    "/my-trips/" + failed.getBookingId(), eventId);
            default -> {
                // Nothing else in payment.events is for the customer.
            }
        }
    }

    private java.util.Optional<BookingContact> contact(String bookingId) {
        return contacts.find(UUID.fromString(bookingId));
    }

    private List<Attachment> attachments(List<Document> attached) {
        return attached.stream().map(document -> new Attachment(document.getFileName(), document.getContentType(),
                documents.content(document))).toList();
    }

    private void email(String eventId, UUID userId, String to, String template, Category category,
            EmailContent content) {
        if (!preferences.enabled(userId, category, Channel.EMAIL)) {
            log.info("E-mail skipped by preference template={} userId={}", template, userId);
            return;
        }
        sender.send(to, content);
        emailMessages.save(new EmailMessage(eventId, userId, to, template, content.subject(), EmailStatus.SENT,
                clock.instant()));
        log.info("Booking email sent template={} userId={} eventId={} attachments={}", template, userId, eventId,
                content.attachments().size());
    }
}
