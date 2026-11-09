package com.flighthotel.notification.realtime;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.realtime.RealtimeAudience;

/**
 * All realtime streams open on <b>this</b> instance, indexed by user and by role so a message only touches the
 * connections in its audience.
 */
public class RealtimeConnectionRegistry {

    private final int maxPerUser;
    private final int maxPerInstance;
    private final Map<String, RealtimeConnection> byId = new ConcurrentHashMap<>();
    private final Map<String, Deque<RealtimeConnection>> byUser = new ConcurrentHashMap<>();
    private final Map<String, Set<RealtimeConnection>> byRole = new ConcurrentHashMap<>();
    private final AtomicInteger size = new AtomicInteger();

    public RealtimeConnectionRegistry(int maxPerUser, int maxPerInstance) {
        this.maxPerUser = maxPerUser;
        this.maxPerInstance = maxPerInstance;
    }

    public void register(RealtimeConnection connection) {
        if (size.get() >= maxPerInstance) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "REALTIME_CAPACITY_REACHED",
                    "Live updates are temporarily unavailable. Retrying shortly.");
        }
        RealtimeConnection evicted = null;
        Deque<RealtimeConnection> userConnections = byUser.computeIfAbsent(connection.userId(), id -> new ArrayDeque<>());
        synchronized (userConnections) {
            if (userConnections.size() >= maxPerUser) {
                evicted = userConnections.pollFirst();
            }
            userConnections.addLast(connection);
        }
        byId.put(connection.id(), connection);
        connection.roles().forEach(role -> byRole.computeIfAbsent(role, r -> ConcurrentHashMap.newKeySet()).add(connection));
        size.incrementAndGet();
        connection.onClosed(this::remove);

        if (evicted != null) {
            evicted.close(SseEmitter.event().name("closed").data("{\"reason\":\"TOO_MANY_STREAMS\"}"));
        }
    }

    void remove(RealtimeConnection connection) {
        if (byId.remove(connection.id()) == null) {
            return;
        }
        size.decrementAndGet();
        Deque<RealtimeConnection> userConnections = byUser.get(connection.userId());
        if (userConnections != null) {
            synchronized (userConnections) {
                userConnections.remove(connection);
                if (userConnections.isEmpty()) {
                    byUser.remove(connection.userId(), userConnections);
                }
            }
        }
        connection.roles().forEach(role -> {
            Set<RealtimeConnection> set = byRole.get(role);
            if (set != null) {
                set.remove(connection);
            }
        });
    }

    /** The open connections that belong to the audience (each connection at most once). */
    public Collection<RealtimeConnection> connectionsFor(RealtimeAudience audience) {
        Set<RealtimeConnection> result = new LinkedHashSet<>();
        for (String userId : audience.userIds()) {
            Deque<RealtimeConnection> userConnections = byUser.get(userId);
            if (userConnections != null) {
                synchronized (userConnections) {
                    result.addAll(userConnections);
                }
            }
        }
        for (String role : audience.roles()) {
            Set<RealtimeConnection> roleConnections = byRole.get(role);
            if (roleConnections != null) {
                result.addAll(roleConnections);
            }
        }
        return result;
    }

    public List<RealtimeConnection> all() {
        return List.copyOf(byId.values());
    }

    public int size() {
        return size.get();
    }
}
