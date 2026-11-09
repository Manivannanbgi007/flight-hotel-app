package com.flighthotel.notification.ticket;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

public interface SupportTicketRepository extends JpaRepository<SupportTicket, UUID>,
        JpaSpecificationExecutor<SupportTicket> {

    long countByStatus(SupportTicket.Status status);

    @Query("select count(t) from SupportTicket t where t.assignedAgentId is null and t.status not in "
            + "(com.flighthotel.notification.ticket.SupportTicket.Status.RESOLVED, "
            + "com.flighthotel.notification.ticket.SupportTicket.Status.CLOSED)")
    long countUnassignedOpen();

    @Query("select count(t) from SupportTicket t where t.assignedAgentId = :agentId and t.status not in "
            + "(com.flighthotel.notification.ticket.SupportTicket.Status.RESOLVED, "
            + "com.flighthotel.notification.ticket.SupportTicket.Status.CLOSED)")
    long countOpenAssignedTo(@Param("agentId") UUID agentId);

    @Query("select count(t) from SupportTicket t where t.priority = 'HIGH' and t.status not in "
            + "(com.flighthotel.notification.ticket.SupportTicket.Status.RESOLVED, "
            + "com.flighthotel.notification.ticket.SupportTicket.Status.CLOSED)")
    long countOpenHighPriority();

    /** The customer's ticket counts per status, in one query. */
    @Query("select t.status, count(t) from SupportTicket t where t.userId = :userId group by t.status")
    java.util.List<Object[]> countsByStatus(@Param("userId") UUID userId);

    Page<SupportTicket> findByUserId(UUID userId, Pageable page);

    Page<SupportTicket> findByUserIdAndStatus(UUID userId, SupportTicket.Status status, Pageable page);

    boolean existsByTicketNumber(String ticketNumber);

    Optional<SupportTicket> findBySourceEventId(String sourceEventId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from SupportTicket t where t.id = :id")
    Optional<SupportTicket> lockById(@Param("id") UUID id);

    /** Keyset pages over all tickets (the snapshot backfill). */
    @Query("select t.id from SupportTicket t order by t.id")
    java.util.List<UUID> findIdsOrderById(Pageable page);

    @Query("select t.id from SupportTicket t where t.id > :after order by t.id")
    java.util.List<UUID> findIdsAfter(@Param("after") UUID after, Pageable page);
}
