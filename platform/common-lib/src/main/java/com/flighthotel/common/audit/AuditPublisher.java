package com.flighthotel.common.audit;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.correlation.CorrelationId;
import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.web.ClientRequestInfo;
import com.flighthotel.events.audit.AuditEventRecorded;

/**
 * Records critical actions (role changes, deactivations, password resets, refunds, ...) as audit events.
 * <p>
 * Written through the outbox in the caller's transaction, so an audit entry exists exactly when the action
 * really happened. reporting-service stores them for the admin "Audit logs" page.
 * <b>Never put personal data or secrets into {@code details}.</b>
 */
public class AuditPublisher {

    static final String AGGREGATE_TYPE = "audit";

    private final OutboxEventPublisher outbox;
    private final String serviceName;

    public AuditPublisher(OutboxEventPublisher outbox, String serviceName) {
        this.outbox = outbox;
        this.serviceName = serviceName;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(String action, String entityType, String entityId, Map<String, String> details) {
        AuthenticatedUser actor = CurrentUser.get().orElse(null);
        AuditEventRecorded event = AuditEventRecorded.newBuilder()
                .setService(serviceName)
                .setAction(action)
                .setEntityType(entityType)
                .setEntityId(entityId)
                .setActorId(actor == null ? SecurityAuditorAware.SYSTEM : actor.id().toString())
                .setActorRoles(actor == null ? List.of() : List.copyOf(actor.roles()))
                .setDetails(details == null ? Map.of() : Map.copyOf(details))
                .setIpAddress(ClientRequestInfo.ipAddress())
                .setCorrelationId(CorrelationId.current())
                .setOccurredAt(Instant.now())
                .build();
        outbox.publish(AGGREGATE_TYPE, entityId, event);
    }
}
