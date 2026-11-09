package com.flighthotel.common.logging;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Logs every public method call on {@code @Service} beans: operation name, duration and outcome.
 * <p>
 * Method arguments and return values are deliberately <b>not</b> logged, because they can contain personal
 * data (names, passport numbers, emails) or secrets.
 */
@Aspect
public class ServiceLoggingAspect {

    private final long slowThresholdMillis;

    public ServiceLoggingAspect(long slowThresholdMillis) {
        this.slowThresholdMillis = slowThresholdMillis;
    }

    @Around("within(@org.springframework.stereotype.Service *) && execution(public * com.flighthotel..*(..))")
    public Object logServiceCall(ProceedingJoinPoint joinPoint) throws Throwable {
        Logger log = LoggerFactory.getLogger(joinPoint.getSignature().getDeclaringType());
        String operation = joinPoint.getSignature().getDeclaringType().getSimpleName() + "."
                + joinPoint.getSignature().getName();
        long start = System.nanoTime();
        try {
            Object result = joinPoint.proceed();
            long durationMs = (System.nanoTime() - start) / 1_000_000;
            if (durationMs >= slowThresholdMillis) {
                log.warn("operation={} outcome=success durationMs={} slow=true", operation, durationMs);
            } else if (log.isDebugEnabled()) {
                log.debug("operation={} outcome=success durationMs={}", operation, durationMs);
            }
            return result;
        } catch (Throwable ex) {
            long durationMs = (System.nanoTime() - start) / 1_000_000;
            log.info("operation={} outcome=error error={} durationMs={}", operation,
                    ex.getClass().getSimpleName(), durationMs);
            throw ex;
        }
    }
}
