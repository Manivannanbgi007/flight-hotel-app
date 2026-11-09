-- Phase 9: the support agents' ticket queue. The customer's e-mail address is kept on the ticket (shown in the queue,
-- searchable, and where an agent's answer is sent); tickets opened before are filled from the booking's contact.
ALTER TABLE support_tickets
    ADD COLUMN customer_email VARCHAR(254) NULL AFTER user_id,
    ADD COLUMN assigned_at    DATETIME(6)  NULL AFTER assigned_agent_id,
    ADD KEY idx_support_tickets_assigned (assigned_agent_id, status);

UPDATE support_tickets t
    JOIN booking_contacts c ON c.booking_id = t.booking_id
SET t.customer_email = c.contact_email
WHERE t.customer_email IS NULL;
