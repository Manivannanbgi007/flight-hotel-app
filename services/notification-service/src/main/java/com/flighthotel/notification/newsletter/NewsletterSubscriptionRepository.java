package com.flighthotel.notification.newsletter;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface NewsletterSubscriptionRepository extends JpaRepository<NewsletterSubscription, UUID> {

    Optional<NewsletterSubscription> findByEmail(String email);

    Optional<NewsletterSubscription> findByConfirmTokenHash(String confirmTokenHash);
}
