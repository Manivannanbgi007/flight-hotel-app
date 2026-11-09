package com.flighthotel.mcpserver.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import com.flighthotel.mcpserver.config.McpServerProperties;

/**
 * Only mcp-client-service may talk to the MCP endpoint: every request must carry the shared key
 * ({@code MCP_SERVER_API_KEY}). It runs before the token check, so a caller without the key learns nothing else.
 * The key proves the caller is our client; the user's own JWT (checked separately) decides what the tools may read.
 */
public class ApiKeyFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(ApiKeyFilter.class);

    private final byte[] expected;
    private final String protectedPath;

    public ApiKeyFilter(String apiKey, String protectedPath) {
        this.expected = apiKey.getBytes(StandardCharsets.UTF_8);
        this.protectedPath = protectedPath;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(protectedPath);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String presented = request.getHeader(McpServerProperties.API_KEY_HEADER);
        // Constant-time comparison: the time taken does not tell how many characters were right.
        if (presented == null
                || !MessageDigest.isEqual(expected, presented.getBytes(StandardCharsets.UTF_8))) {
            log.warn("MCP request refused: missing or wrong API key");
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            response.getWriter().write("{\"type\":\"about:blank\",\"title\":\"Unauthorized\",\"status\":401,"
                    + "\"detail\":\"A valid API key is required\",\"code\":\"INVALID_API_KEY\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
