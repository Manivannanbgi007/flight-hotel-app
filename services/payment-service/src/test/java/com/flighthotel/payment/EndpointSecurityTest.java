package com.flighthotel.payment;

import static com.flighthotel.testsupport.RoleTokens.CUSTOMER;
import static com.flighthotel.testsupport.RoleTokens.HOTEL_MANAGER;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;

import com.flighthotel.testsupport.AccessMatrix;
import com.flighthotel.testsupport.Endpoints;

/**
 * Who may call what (SECURITY_GUIDE.md): only the provider's webhook is public (it is protected by its signature,
 * see {@link RazorpayPaymentFlowTest}); payments and invoices need a login, and the payment and refund lists refuse
 * customers and hotel managers (PAYMENT_READ_ANY). Who may see one payment is tested in
 * {@link AdminPaymentIntegrationTest}.
 */
class EndpointSecurityTest extends PaymentIntegrationTest {

    private static final Set<String> PUBLIC = Set.of("POST /api/payments/webhook");

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointExceptTheWebhookNeedsALogin() throws Exception {
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), PUBLIC);
    }

    @Test
    void paymentListsRefuseRolesWithoutThePermission() throws Exception {
        AccessMatrix matrix = new AccessMatrix()
                .refuse("GET /api/admin/payments", () -> get("/api/admin/payments"), CUSTOMER, HOTEL_MANAGER)
                .refuse("GET /api/admin/payments/summary", () -> get("/api/admin/payments/summary"), CUSTOMER,
                        HOTEL_MANAGER)
                .refuse("GET /api/admin/refunds", () -> get("/api/admin/refunds"), CUSTOMER, HOTEL_MANAGER);

        matrix.assertCovers(Endpoints.of(context), "/api/admin/");
        matrix.assertRefused(mockMvc);
    }
}
