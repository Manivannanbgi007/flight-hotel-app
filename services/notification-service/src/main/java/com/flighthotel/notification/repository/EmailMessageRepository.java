package com.flighthotel.notification.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.notification.entity.EmailMessage;

public interface EmailMessageRepository extends JpaRepository<EmailMessage, UUID> {

    List<EmailMessage> findByToEmailOrderByCreatedAtAsc(String toEmail);
}
