package com.flighthotel.common.security;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;

import com.flighthotel.common.error.ProblemDetails;

import tools.jackson.databind.json.JsonMapper;

/** Writes 401 and 403 responses in the same Problem Details format as all other errors. */
public class ProblemDetailsSecurityHandler implements AuthenticationEntryPoint, AccessDeniedHandler {

    private final JsonMapper jsonMapper;

    public ProblemDetailsSecurityHandler(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException authException) throws IOException {
        response.setHeader("WWW-Authenticate", "Bearer");
        write(response, ProblemDetails.of(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED",
                "Authentication is required or the access token is invalid/expired"));
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
            AccessDeniedException accessDeniedException) throws IOException {
        write(response, ProblemDetails.of(HttpStatus.FORBIDDEN, "FORBIDDEN",
                "You are not allowed to perform this action"));
    }

    private void write(HttpServletResponse response, ProblemDetail problem) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(problem.getStatus());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        jsonMapper.writeValue(response.getOutputStream(), problem);
    }
}
