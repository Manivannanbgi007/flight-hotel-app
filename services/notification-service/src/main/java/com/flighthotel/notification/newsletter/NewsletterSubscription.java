package com.flighthotel.notification.newsletter;

import java.time.Instant;
import java.util.UUID;

import com.flighthotel.common.id.UuidV7;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One e-mail address and its newsletter consent. Double opt-in for the public form (PENDING until the link in the
 * confirmation e-mail is used); immediate for a logged-in customer's own, verified address.
 */
@Getter
@Entity
@Table(name = "newsletter_subscriptions")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class NewsletterSubscription {

    public enum Status { PENDING, SUBSCRIBED, UNSUBSCRIBED }

    @Id
    private UUID id;

    @Column(nullable = false, updatable = false, length = 254)
    private String email;

    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.VARCHAR)
    @Column(nullable = false, length = 15)
    private Status status;

    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false, length = 10)
    private String source;

    @Column(name = "confirm_token_hash", length = 64)
    private String confirmTokenHash;

    @Column(name = "confirm_expires_at")
    private Instant confirmExpiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "confirmed_at")
    private Instant confirmedAt;

    @Column(name = "unsubscribed_at")
    private Instant unsubscribedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private Long version;

    public static NewsletterSubscription create(String email, Instant now) {
        NewsletterSubscription subscription = new NewsletterSubscription();
        subscription.id = UuidV7.generate();
        subscription.email = email;
        subscription.status = Status.UNSUBSCRIBED;
        subscription.source = "FORM";
        subscription.createdAt = now;
        subscription.updatedAt = now;
        return subscription;
    }

    /** The public form: waits for the link in the confirmation e-mail. */
    public void pending(String tokenHash, Instant expiresAt, Instant now) {
        status = Status.PENDING;
        source = "FORM";
        confirmTokenHash = tokenHash;
        confirmExpiresAt = expiresAt;
        updatedAt = now;
    }

    public void subscribed(String by, UUID user, Instant now) {
        status = Status.SUBSCRIBED;
        source = by;
        if (user != null) {
            userId = user;
        }
        confirmTokenHash = null;
        confirmExpiresAt = null;
        confirmedAt = now;
        unsubscribedAt = null;
        updatedAt = now;
    }

    public void unsubscribed(Instant now) {
        status = Status.UNSUBSCRIBED;
        confirmTokenHash = null;
        confirmExpiresAt = null;
        unsubscribedAt = now;
        updatedAt = now;
    }
}
