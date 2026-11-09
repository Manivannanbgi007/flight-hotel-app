package com.flighthotel.search;

import static com.flighthotel.testsupport.RoleTokens.ADMIN;
import static com.flighthotel.testsupport.RoleTokens.CUSTOMER;
import static com.flighthotel.testsupport.RoleTokens.HOTEL_MANAGER;
import static com.flighthotel.testsupport.RoleTokens.SUPPORT_AGENT;
import static com.flighthotel.testsupport.RoleTokens.as;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;

import com.flighthotel.testsupport.AccessMatrix;
import com.flighthotel.testsupport.Endpoints;

/**
 * Who may call what (SECURITY_GUIDE.md): searching needs no login (signed-out visitors get public results only, see
 * GlobalSearchIntegrationTest); the index maintenance endpoints are for admins only.
 */
class EndpointSecurityTest extends ElasticsearchTestBase {

    private static final Set<String> PUBLIC = Set.of("GET /api/search", "GET /api/search/suggest");
    private static final String[] NOT_ADMINS = {CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT};

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointExceptSearchNeedsALogin() throws Exception {
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), PUBLIC);
    }

    @Test
    void indexMaintenanceIsForAdmins() throws Exception {
        AccessMatrix matrix = new AccessMatrix()
                .refuse("GET /api/admin/search/status", () -> get("/api/admin/search/status"), NOT_ADMINS)
                .refuse("POST /api/admin/search/replay", () -> post("/api/admin/search/replay"), NOT_ADMINS);
        matrix.assertCovers(Endpoints.of(context), "/api/admin/");
        matrix.assertRefused(mockMvc);
    }

    @Test
    void adminsSeeTheIndexStatusAndCanReplay() throws Exception {
        mockMvc.perform(get("/api/admin/search/status").with(as(ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alias").value("global-search"))
                .andExpect(jsonPath("$.index").value("global-search-v2"));
        mockMvc.perform(post("/api/admin/search/replay").with(as(ADMIN)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.listeners").value(6));
    }

    @Test
    void signedOutVisitorsCanSearch() throws Exception {
        mockMvc.perform(get("/api/search").param("q", "chennai")).andExpect(status().isOk());
        mockMvc.perform(get("/api/search/suggest").param("q", "chennai")).andExpect(status().isOk());
    }
}
