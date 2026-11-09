package com.flighthotel.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;

import com.flighthotel.testsupport.AccessMatrix;
import com.flighthotel.testsupport.Endpoints;

/**
 * Who may call what (SECURITY_GUIDE.md): every assistant endpoint needs a login, for every role (what a user can read
 * through the assistant is decided by the tools of the user's role and the user's own token). There are no
 * staff-only endpoints here, so the matrix has no refusals; the staff-only tools are checked in mcp-server-service's
 * EndpointSecurityTest.
 */
@SpringBootTest(properties = {
        "spring.data.redis.port=6399",
        "assistant.model.warm-up=false",
        "assistant.mcp.api-key=endpoint-security-test-key-0123456789abcdef",
        "spring.ai.mcp.client.streamable-http.connections.travel.url=http://127.0.0.1:9"
})
@AutoConfigureMockMvc
class EndpointSecurityTest {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointNeedsALogin() throws Exception {
        assertThat(Endpoints.of(context)).extracting(Endpoints.Endpoint::key).containsExactlyInAnyOrder(
                "GET /api/assistant/config",
                "POST /api/assistant/chat",
                "GET /api/assistant/conversations/{id}",
                "DELETE /api/assistant/conversations/{id}",
                "POST /api/assistant/voice/transcriptions",
                "POST /api/assistant/voice/speech");
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), Set.of());
    }
}
