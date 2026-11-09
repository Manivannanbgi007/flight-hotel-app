package com.flighthotel.notification.email;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;

import org.springframework.mail.MailException;
import org.springframework.mail.MailPreparationException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

import com.flighthotel.common.settings.SystemSettings;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;

/** Sends one email over SMTP (Mailpit locally, Amazon SES in production). Throws on failure so Kafka retries. */
@Component
public class EmailSender {

    private final JavaMailSender mailSender;
    private final EmailProperties properties;
    private final SystemSettings settings;

    public EmailSender(JavaMailSender mailSender, EmailProperties properties, SystemSettings settings) {
        this.mailSender = mailSender;
        this.properties = properties;
        this.settings = settings;
    }

    public void send(String to, EmailContent content) throws MailException {
        MimeMessage message = mailSender.createMimeMessage();
        try {
            MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            helper.setFrom(new InternetAddress(properties.from(), settings.getString("site.name", "FlightHotel"),
                    StandardCharsets.UTF_8.name()));
            helper.setTo(to);
            helper.setSubject(content.subject());
            helper.setText(content.text(), content.html());
            for (EmailContent.Attachment attachment : content.attachments()) {
                helper.addAttachment(attachment.fileName(),
                        new org.springframework.core.io.ByteArrayResource(attachment.content()),
                        attachment.contentType());
            }
        } catch (MessagingException | UnsupportedEncodingException ex) {
            throw new MailPreparationException("Could not build email", ex);
        }
        mailSender.send(message);
    }
}
