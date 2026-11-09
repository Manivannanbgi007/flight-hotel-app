package com.flighthotel.notification.ticket;

import java.time.Clock;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.flighthotel.notification.email.BookingEmailComposer;
import com.flighthotel.notification.email.EmailContent;
import com.flighthotel.notification.email.EmailSender;
import com.flighthotel.notification.entity.EmailMessage;
import com.flighthotel.notification.entity.EmailMessage.EmailStatus;
import com.flighthotel.notification.preference.NotificationPreferences;
import com.flighthotel.notification.preference.NotificationPreferences.Category;
import com.flighthotel.notification.preference.NotificationPreferences.Channel;
import com.flighthotel.notification.repository.EmailMessageRepository;

/**
 * The e-mail a customer gets when support answers their ticket (category SUPPORT, which they may switch off). It goes
 * out after the reply is committed, so a rolled-back reply never sends mail and a slow mail server never blocks the
 * agent's reply; a failed send is logged (the bell entry is there anyway).
 */
@Component
public class TicketEmails {

    private static final Logger log = LoggerFactory.getLogger(TicketEmails.class);

    private final BookingEmailComposer composer;
    private final EmailSender sender;
    private final NotificationPreferences preferences;
    private final EmailMessageRepository emailMessages;
    private final Clock clock;

    public TicketEmails(BookingEmailComposer composer, EmailSender sender, NotificationPreferences preferences,
            EmailMessageRepository emailMessages, Clock clock) {
        this.composer = composer;
        this.sender = sender;
        this.preferences = preferences;
        this.emailMessages = emailMessages;
        this.clock = clock;
    }

    /** Called in the reply's transaction. */
    void answered(SupportTicket ticket, UUID messageId) {
        String to = ticket.getCustomerEmail();
        if (to == null || !preferences.enabled(ticket.getUserId(), Category.SUPPORT, Channel.EMAIL)) {
            return;
        }
        EmailContent content = composer.ticketAnswered(ticket.getId().toString(), ticket.getTicketNumber(),
                ticket.getSubject());
        emailMessages.save(new EmailMessage(messageId.toString(), ticket.getUserId(), to, "TICKET_ANSWERED",
                content.subject(), EmailStatus.SENT, clock.instant()));
        String number = ticket.getTicketNumber();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    sender.send(to, content);
                    log.info("Ticket answer e-mail sent ticket={}", number);
                } catch (RuntimeException ex) {
                    log.error("Ticket answer e-mail failed ticket={} error={}", number, ex.toString());
                }
            }
        });
    }
}
