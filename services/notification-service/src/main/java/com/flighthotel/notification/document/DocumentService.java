package com.flighthotel.notification.document;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.payment.InvoiceIssued;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.notification.document.Document.Type;
import com.flighthotel.notification.projection.BookingContacts;
import com.flighthotel.notification.projection.BookingContacts.BookingContact;

/**
 * Generates each document once (requirement section 18) and serves it only to its owner or to staff with
 * {@code BOOKING_READ_ANY} (API_DOCUMENTATION.md section 10b). Files are written to {@link FileStorage} under a key
 * derived from the document id, so a retried event overwrites instead of leaving a second file.
 */
@Service
public class DocumentService {

    static final String READ_ANY = "BOOKING_READ_ANY";
    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);

    private final DocumentRepository documents;
    private final FileStorage storage;
    private final PdfRenderer renderer;
    private final DocumentFactory factory;
    private final BookingContacts contacts;
    private final RealtimePublisher realtime;
    private final Clock clock;

    public DocumentService(DocumentRepository documents, FileStorage storage, PdfRenderer renderer,
            DocumentFactory factory, BookingContacts contacts, RealtimePublisher realtime, Clock clock) {
        this.documents = documents;
        this.storage = storage;
        this.renderer = renderer;
        this.factory = factory;
        this.contacts = contacts;
        this.realtime = realtime;
        this.clock = clock;
    }

    /** {@code referenceId}: the source (booking, invoice, payment, cancellation or refund id). */
    public record DocumentView(UUID id, UUID bookingId, Type type, String referenceId, String title, String fileName,
            int sizeBytes, Instant createdAt) {

        static DocumentView of(Document document) {
            return new DocumentView(document.getId(), document.getBookingId(), document.getType(),
                    document.getReferenceId(), document.getTitle(), document.getFileName(), document.getSizeBytes(),
                    document.getCreatedAt());
        }
    }

    public record Download(String fileName, String contentType, byte[] content) {
    }

    // ------------------------------------------------------------------ generation (event listeners)

    /** Hotel voucher or flight itinerary, once the hotel or airline confirmed. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Document confirmation(BookingConfirmed confirmed) {
        boolean flight = confirmed.getFlight() != null;
        return ensure(Type.BOOKING_CONFIRMATION, confirmed.getBookingId(), confirmed.getBookingId(),
                confirmed.getUserId(), confirmed.getBookingReference(),
                () -> flight ? factory.flightItinerary(confirmed) : factory.hotelConfirmation(confirmed));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<Document> eTicket(BookingConfirmed confirmed) {
        if (confirmed.getFlight() == null) {
            return Optional.empty();
        }
        return Optional.of(ensure(Type.E_TICKET, confirmed.getBookingId(), confirmed.getBookingId(),
                confirmed.getUserId(), confirmed.getBookingReference(), () -> factory.eTicket(confirmed)));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Document invoice(InvoiceIssued invoice) {
        BookingContact contact = contacts.find(UUID.fromString(invoice.getBookingId())).orElse(null);
        return ensure(Type.INVOICE, invoice.getInvoiceId(), invoice.getBookingId(), invoice.getUserId(),
                invoice.getInvoiceNumber().replace('/', '-'), () -> factory.invoice(invoice, contact));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Document paymentReceipt(PaymentSucceeded payment) {
        BookingContact contact = contacts.find(UUID.fromString(payment.getBookingId())).orElse(null);
        return ensure(Type.PAYMENT_RECEIPT, payment.getPaymentId(), payment.getBookingId(), payment.getUserId(),
                contact == null ? "payment-" + payment.getPaymentId().substring(0, 8) : contact.bookingReference(),
                () -> factory.paymentReceipt(payment, contact));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Document cancellation(BookingCancelled cancelled) {
        return ensure(Type.CANCELLATION_CONFIRMATION, cancelled.getCancellationId(), cancelled.getBookingId(),
                cancelled.getUserId(), cancelled.getBookingReference(), () -> factory.cancellation(cancelled));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Document refundReceipt(RefundCompleted refund) {
        BookingContact contact = contacts.find(UUID.fromString(refund.getBookingId())).orElse(null);
        return ensure(Type.REFUND_RECEIPT, refund.getRefundId(), refund.getBookingId(), refund.getUserId(),
                contact == null ? "refund-" + refund.getRefundId().substring(0, 8) : contact.bookingReference(),
                () -> factory.refundReceipt(refund, contact));
    }

    /** The PDF bytes of a document (for e-mail attachments). */
    public byte[] content(Document document) {
        return storage.load(document.getStorageKey()).orElseThrow(() ->
                new IllegalStateException("Document file missing: " + document.getStorageKey()));
    }

    private Document ensure(Type type, String referenceId, String bookingId, String userId, String filePrefix,
            Supplier<PdfDocument> content) {
        UUID id = Document.idFor(type, referenceId);
        Optional<Document> existing = documents.findById(id);
        if (existing.isPresent()) {
            return existing.get();
        }
        byte[] pdf = renderer.render(content.get());
        String key = FileStorage.key("documents", id, "pdf");
        storage.put(key, pdf);
        Document document = documents.saveAndFlush(new Document(type, referenceId, UUID.fromString(bookingId),
                UUID.fromString(userId), type.title(), filePrefix + "-" + type.fileSuffix() + ".pdf", key, pdf.length,
                sha256(pdf), clock.instant()));
        realtime.publish(RealtimeMessage.of("document.created", "BOOKING", bookingId,
                        Map.of("documentId", id.toString(), "type", type.name())),
                RealtimeAudience.user(document.getUserId()).andRoles(Roles.ADMIN, Roles.SUPPORT_AGENT));
        log.info("Document generated type={} bookingId={} bytes={}", type, bookingId, pdf.length);
        return document;
    }

    // ------------------------------------------------------------------ API

    /** The booking's documents for its owner (or staff); someone else gets an empty list, never someone's files. */
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public List<DocumentView> forBooking(UUID bookingId) {
        AuthenticatedUser user = CurrentUser.require();
        List<Document> found = user.hasPermission(READ_ANY)
                ? documents.findByBookingIdOrderByCreatedAtAscIdAsc(bookingId)
                : documents.findByBookingIdAndUserIdOrderByCreatedAtAscIdAsc(bookingId, user.id());
        return found.stream().map(DocumentView::of).toList();
    }

    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public Download download(UUID id) {
        AuthenticatedUser user = CurrentUser.require();
        Document document = documents.findById(id)
                .filter(found -> found.getUserId().equals(user.id()) || user.hasPermission(READ_ANY))
                .orElseThrow(() -> new ResourceNotFoundException("Document", id));
        byte[] content = storage.load(document.getStorageKey()).orElseThrow(() ->
                new ResourceNotFoundException("Document", id));
        log.info("Document downloaded id={} type={} by={}", id, document.getType(), user.id());
        return new Download(document.getFileName(), document.getContentType(), content);
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
