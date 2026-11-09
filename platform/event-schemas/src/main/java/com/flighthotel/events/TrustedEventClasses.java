package com.flighthotel.events;

import java.util.concurrent.atomic.AtomicBoolean;

import org.apache.avro.util.ClassSecurityValidator;

/**
 * Avro 1.12 only (de)serializes classes it trusts, to block deserialization attacks. This adds exactly our
 * generated event classes ({@code com.flighthotel.events.*}) to Avro's trusted list; everything else stays blocked.
 * <p>
 * common-lib calls {@link #register()} at application startup.
 */
public final class TrustedEventClasses {

    public static final String EVENTS_PACKAGE = "com.flighthotel.events.";
    private static final AtomicBoolean REGISTERED = new AtomicBoolean();

    private TrustedEventClasses() {
    }

    public static void register() {
        if (REGISTERED.compareAndSet(false, true)) {
            ClassSecurityValidator.ClassSecurityPredicate ourEvents =
                    clazz -> clazz.getName().startsWith(EVENTS_PACKAGE);
            ClassSecurityValidator.setGlobal(
                    ClassSecurityValidator.composite(ClassSecurityValidator.getGlobal(), ourEvents));
        }
    }
}
