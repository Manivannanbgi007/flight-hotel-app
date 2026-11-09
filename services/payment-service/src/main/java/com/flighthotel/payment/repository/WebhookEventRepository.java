package com.flighthotel.payment.repository;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.payment.entity.WebhookEvent;

public interface WebhookEventRepository extends JpaRepository<WebhookEvent, UUID> {

    boolean existsByProviderAndProviderEventId(String provider, String providerEventId);
}
