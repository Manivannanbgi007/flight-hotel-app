package com.flighthotel.notification.controller;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.notification.realtime.RealtimeHub;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RestController
@RequestMapping("/api/realtime")
@Tag(name = "Realtime", description = "Auto-refresh signals over Server-Sent Events")
public class RealtimeStreamController {

    private final RealtimeHub hub;

    public RealtimeStreamController(RealtimeHub hub) {
        this.hub = hub;
    }

    @GetMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Open the realtime stream for the logged-in user",
            description = "Events: connected, message, token-expired, reconnect, closed. Comments (: ping) are heartbeats.")
    public SseEmitter stream(@AuthenticationPrincipal Jwt jwt, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-cache, no-transform");
        // Tells nginx-style proxies not to buffer the stream.
        response.setHeader("X-Accel-Buffering", "no");
        return hub.open(CurrentUser.fromJwt(jwt));
    }
}
