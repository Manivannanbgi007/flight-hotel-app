-- Phase 11: support metrics (tickets opened vs resolved over time, resolution time). resolved_at = when the ticket was
-- resolved or closed (resolving and then closing keeps the first moment); a customer reply that reopens the ticket
-- clears it. Tickets resolved before this migration: closed_at for closed ones, otherwise the last change
-- (updated_at), the best record there is.
ALTER TABLE support_tickets
    ADD COLUMN resolved_at DATETIME(6) NULL COMMENT 'resolved or closed; NULL while open' AFTER closed_at,
    ADD KEY idx_support_tickets_resolved (resolved_at),
    ADD KEY idx_support_tickets_created (created_at);

UPDATE support_tickets SET resolved_at = COALESCE(closed_at, updated_at)
WHERE status IN ('RESOLVED', 'CLOSED') AND resolved_at IS NULL;
