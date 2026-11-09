package com.flighthotel.notification.email;

import java.util.List;

/**
 * A rendered email: HTML for mail clients that show it, plain text for the rest (and for spam filters), and optional
 * attachments (the PDF documents of Phase 8).
 */
public record EmailContent(String subject, String html, String text, List<Attachment> attachments) {

    public EmailContent(String subject, String html, String text) {
        this(subject, html, text, List.of());
    }

    public EmailContent {
        attachments = attachments == null ? List.of() : List.copyOf(attachments);
    }

    public EmailContent withAttachments(List<Attachment> files) {
        return new EmailContent(subject, html, text, files);
    }

    public record Attachment(String fileName, String contentType, byte[] content) {
    }
}
