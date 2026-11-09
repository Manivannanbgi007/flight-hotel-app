package com.flighthotel.notification.newsletter;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.notification.email.BookingEmailComposer;
import com.flighthotel.notification.email.EmailProperties;
import com.flighthotel.notification.email.EmailSender;
import com.flighthotel.notification.newsletter.NewsletterSubscription.Status;

/**
 * The newsletter subscription (API_DOCUMENTATION.md section 10d). The public form is double opt-in: only the link in
 * the confirmation e-mail subscribes an address (its token is stored as SHA-256 and expires). Every newsletter e-mail
 * carries an unsubscribe link signed with HMAC-SHA256, so it works without storing a token and never expires. Nothing
 * in the answers tells whether an address is subscribed.
 */
@Service
public class NewsletterService {

    private static final Logger log = LoggerFactory.getLogger(NewsletterService.class);
    private static final String DEV_SECRET = "flighthotel-local-newsletter-secret";
    private static final Duration RESEND_PAUSE = Duration.ofMinutes(10);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder BASE64 = Base64.getUrlEncoder().withoutPadding();

    private final NewsletterSubscriptionRepository subscriptions;
    private final BookingEmailComposer composer;
    private final EmailSender sender;
    private final EmailProperties emailProperties;
    private final byte[] secret;
    private final Duration confirmValidity;
    private final Clock clock;

    public NewsletterService(NewsletterSubscriptionRepository subscriptions, BookingEmailComposer composer,
            EmailSender sender, EmailProperties emailProperties,
            @Value("${notification.newsletter.secret:}") String secret,
            @Value("${notification.newsletter.confirm-validity:48h}") Duration confirmValidity, Clock clock) {
        this.subscriptions = subscriptions;
        this.composer = composer;
        this.sender = sender;
        this.emailProperties = emailProperties;
        this.secret = (secret == null || secret.isBlank() ? DEV_SECRET : secret).getBytes(StandardCharsets.UTF_8);
        this.confirmValidity = confirmValidity;
        this.clock = clock;
    }

    public record Result(Status status, String email) {
    }

    /** The public form. Sends the confirmation e-mail unless the address is subscribed or one was just sent. */
    @Transactional
    public void subscribe(String rawEmail) {
        String email = rawEmail.strip().toLowerCase(Locale.ROOT);
        Instant now = clock.instant();
        NewsletterSubscription subscription = subscriptions.findByEmail(email).orElse(null);
        if (subscription != null && subscription.getStatus() == Status.SUBSCRIBED) {
            log.info("Newsletter: address already subscribed, nothing sent");
            return;
        }
        if (subscription != null && subscription.getStatus() == Status.PENDING
                && subscription.getConfirmExpiresAt() != null
                && subscription.getConfirmExpiresAt().minus(confirmValidity).plus(RESEND_PAUSE).isAfter(now)) {
            log.info("Newsletter: confirmation sent less than {} ago, not sent again", RESEND_PAUSE);
            return;
        }
        if (subscription == null) {
            subscription = NewsletterSubscription.create(email, now);
        }
        String token = randomToken();
        subscription.pending(sha256(token), now.plus(confirmValidity), now);
        subscriptions.saveAndFlush(subscription);
        sender.send(email, composer.newsletterConfirmation(emailProperties.appUrl("/newsletter/confirm?token=" + token)));
        log.info("Newsletter confirmation e-mail sent subscriptionId={}", subscription.getId());
    }

    @Transactional
    public Result confirm(String token) {
        Instant now = clock.instant();
        NewsletterSubscription subscription = subscriptions.findByConfirmTokenHash(sha256(token))
                .filter(found -> found.getStatus() == Status.PENDING && found.getConfirmExpiresAt().isAfter(now))
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "INVALID_OR_EXPIRED_TOKEN",
                        "This confirmation link is invalid or has expired. Please subscribe again."));
        subscription.subscribed("FORM", null, now);
        sender.send(subscription.getEmail(), composer.newsletterWelcome(unsubscribeUrl(subscription.getId())));
        log.info("Newsletter subscription confirmed subscriptionId={}", subscription.getId());
        return new Result(Status.SUBSCRIBED, mask(subscription.getEmail()));
    }

    @Transactional
    public Result unsubscribe(String token) {
        NewsletterSubscription subscription = verify(token).flatMap(subscriptions::findById)
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN",
                        "This unsubscribe link is not valid."));
        if (subscription.getStatus() != Status.UNSUBSCRIBED) {
            subscription.unsubscribed(clock.instant());
            log.info("Newsletter unsubscribed subscriptionId={}", subscription.getId());
        }
        return new Result(Status.UNSUBSCRIBED, mask(subscription.getEmail()));
    }

    /** A logged-in customer's own, verified address: no confirmation e-mail needed. */
    @Transactional
    public Status account(UUID userId, String rawEmail, boolean subscribe) {
        String email = rawEmail.strip().toLowerCase(Locale.ROOT);
        Instant now = clock.instant();
        NewsletterSubscription subscription = subscriptions.findByEmail(email)
                .orElseGet(() -> NewsletterSubscription.create(email, now));
        if (subscribe) {
            subscription.subscribed("ACCOUNT", userId, now);
        } else if (subscription.getStatus() != Status.UNSUBSCRIBED) {
            subscription.unsubscribed(now);
        }
        subscriptions.save(subscription);
        return subscription.getStatus();
    }

    /** NONE when the address never subscribed. */
    @Transactional(readOnly = true)
    public String status(String email) {
        return subscriptions.findByEmail(email.strip().toLowerCase(Locale.ROOT))
                .map(found -> found.getStatus().name()).orElse("NONE");
    }

    /** The link every newsletter e-mail carries. */
    public String unsubscribeUrl(UUID subscriptionId) {
        return emailProperties.appUrl("/newsletter/unsubscribe?token=" + unsubscribeToken(subscriptionId));
    }

    String unsubscribeToken(UUID subscriptionId) {
        byte[] id = ByteBuffer.allocate(16).putLong(subscriptionId.getMostSignificantBits())
                .putLong(subscriptionId.getLeastSignificantBits()).array();
        return BASE64.encodeToString(id) + "." + BASE64.encodeToString(signature(id));
    }

    private Optional<UUID> verify(String token) {
        if (token == null || token.length() > 200 || token.indexOf('.') < 0) {
            return Optional.empty();
        }
        try {
            byte[] id = Base64.getUrlDecoder().decode(token.substring(0, token.indexOf('.')));
            byte[] given = Base64.getUrlDecoder().decode(token.substring(token.indexOf('.') + 1));
            if (id.length != 16 || !MessageDigest.isEqual(signature(id), given)) {
                return Optional.empty();
            }
            ByteBuffer buffer = ByteBuffer.wrap(id);
            return Optional.of(new UUID(buffer.getLong(), buffer.getLong()));
        } catch (IllegalArgumentException malformed) {
            return Optional.empty();
        }
    }

    private byte[] signature(byte[] id) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            mac.update("newsletter-unsubscribe:".getBytes(StandardCharsets.UTF_8));
            return Arrays.copyOf(mac.doFinal(id), 16);
        } catch (NoSuchAlgorithmException | InvalidKeyException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return BASE64.encodeToString(bytes);
    }

    static String sha256(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** "asha@example.com" → "a***@example.com" */
    static String mask(String email) {
        int at = email.indexOf('@');
        return at <= 1 ? "***" + email.substring(Math.max(at, 0)) : email.charAt(0) + "***" + email.substring(at);
    }
}
