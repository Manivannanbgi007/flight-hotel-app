package com.flighthotel.reporting.export;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.reporting.audit.AuditLogStore;
import com.flighthotel.reporting.export.ExportFileWriter.ExportFailedException;
import com.flighthotel.reporting.export.ExportFileWriter.Plan;
import com.flighthotel.reporting.export.ExportFileWriter.Result;
import com.flighthotel.reporting.export.ExportJob.Filters;
import com.flighthotel.reporting.export.ExportJob.Status;

import jakarta.annotation.PreDestroy;

/**
 * Writes queued exports. Every instance looks for waiting jobs every few seconds and claims one with a conditional
 * UPDATE, so each job runs once however many instances there are, and queued jobs survive a restart. A job counts its
 * entries, reads them in batches straight into the file ({@link ExportFileWriter}) on local disk, stores the file
 * ({@link FileStorage}: S3 in production) and tells its admin through the realtime channel: progress at most every
 * {@code progress-interval}, then "ready" or "failed".
 * <p>
 * A stopping instance hands its running jobs back to the queue (another one starts them again); a job whose instance
 * died fails once its heartbeat is older than {@code stale-after}. Files are deleted after {@code retention}.
 */
@Component
public class AuditExportRunner {

    static final String MESSAGE_TYPE = "export.status-changed";
    static final String WRITE_FAILED = "The export could not be written. Please try again.";
    static final String INTERRUPTED = "The export was interrupted (the service restarted). Please start it again.";

    private static final Logger log = LoggerFactory.getLogger(AuditExportRunner.class);

    private final ExportJobStore jobs;
    private final AuditLogStore auditLogs;
    private final FileStorage storage;
    private final RealtimePublisher realtime;
    private final ExportProperties properties;
    private final Clock clock;
    private final ExecutorService executor;
    private final AtomicInteger running = new AtomicInteger();
    private final Set<UUID> active = ConcurrentHashMap.newKeySet();
    private volatile boolean stopping;

    public AuditExportRunner(ExportJobStore jobs, AuditLogStore auditLogs, FileStorage storage,
            RealtimePublisher realtime, ExportProperties properties, Clock clock) {
        this.jobs = jobs;
        this.auditLogs = auditLogs;
        this.storage = storage;
        this.realtime = realtime;
        this.properties = properties;
        this.clock = clock;
        AtomicInteger threads = new AtomicInteger();
        this.executor = Executors.newFixedThreadPool(properties.concurrency(),
                task -> Thread.ofPlatform().name("audit-export-" + threads.incrementAndGet()).unstarted(task));
    }

    /** Claims waiting jobs while this instance has a free slot. */
    @Scheduled(fixedDelayString = "${reporting.exports.poll-interval:2s}",
            initialDelayString = "${reporting.exports.poll-interval:2s}")
    public void startQueued() {
        if (stopping) {
            return;
        }
        int free = properties.concurrency() - running.get();
        if (free <= 0) {
            return;
        }
        List<UUID> waiting;
        try {
            waiting = jobs.queued(free);
        } catch (DataAccessException ex) {
            // The database is away (restart, failover): one line per poll, not a stack trace every 2 seconds.
            log.warn("Export poller cannot read the queue: {}", ex.getMessage());
            return;
        }
        for (UUID id : waiting) {
            if (!jobs.claim(id, clock.instant())) {
                continue; // another instance was quicker
            }
            running.incrementAndGet();
            try {
                executor.execute(() -> {
                    try {
                        run(id);
                    } finally {
                        running.decrementAndGet();
                    }
                });
            } catch (RejectedExecutionException ex) {
                running.decrementAndGet();
                jobs.requeue(id);
            }
        }
    }

    /** Deletes files whose time is over, fails jobs of stopped instances, forgets old jobs. */
    @Scheduled(fixedDelayString = "${reporting.exports.sweep-interval:5m}", initialDelayString = "PT1M")
    public void sweep() {
        Instant now = clock.instant();
        for (ExportJob job : jobs.expired(now)) {
            if (job.storageKey() != null) {
                try {
                    storage.delete(job.storageKey());
                } catch (RuntimeException ex) {
                    log.warn("Could not delete expired export exportId={}", job.id(), ex);
                    continue;
                }
            }
            jobs.markExpired(job.id());
            log.info("Audit log export expired exportId={}", job.id());
        }
        for (UUID id : jobs.stale(now.minus(properties.staleAfter()))) {
            if (!active.contains(id)) {
                jobs.find(id).ifPresent(job -> {
                    if (jobs.fail(id, INTERRUPTED, now)) {
                        log.warn("Audit log export interrupted exportId={}", id);
                        publish(job, Status.FAILED, job.rowsWritten(), job.totalRows());
                    }
                });
            }
        }
        int forgotten = jobs.deleteFinishedBefore(now.minus(properties.listFor()));
        if (forgotten > 0) {
            log.info("Forgot {} old audit log exports", forgotten);
        }
    }

    /** Running jobs go back to the queue: another instance (or this one after the restart) starts them again. */
    @PreDestroy
    void stop() throws InterruptedException {
        stopping = true;
        executor.shutdown();
        if (!executor.awaitTermination(15, TimeUnit.SECONDS)) {
            log.warn("Audit log exports still running at shutdown: {}", active);
        }
    }

    void run(UUID id) {
        ExportJob job = jobs.find(id).orElse(null);
        if (job == null) {
            return;
        }
        active.add(id);
        Path work = null;
        long started = System.nanoTime();
        try {
            long total = auditLogs.count(job.filters().toFilter(), job.asOf());
            Plan plan = new Plan("audit-logs-" + ExportTime.fileDate(job.asOf()), job.format(), total,
                    properties.rowsPerPart(), clock.instant(), job.requestedByName(), job.asOf(),
                    aboutFilters(job.filters()));
            if (!jobs.counted(id, total, plan.parts(), clock.instant())) {
                return; // removed while counting
            }
            publish(job, Status.RUNNING, 0, total);
            work = Files.createTempFile(workDir(), "export-", ".tmp");
            Result result = write(job, plan, work);
            if (result == null) {
                log.info("Audit log export stopped (removed) exportId={}", id);
                return;
            }
            long size = Files.size(work);
            if (size > properties.maxFileBytes()) {
                throw new ExportFailedException("The file would be larger than "
                        + properties.maxFileBytes() / 1_000_000_000 + " GB. Narrow the filters (for example a "
                        + "shorter date range) and export again.");
            }
            if (!jobs.progress(id, result.rows(), clock.instant())) {
                return;
            }
            String key = FileStorage.key("exports", id, extension(result.fileName()));
            storage.putFile(key, work);
            Instant done = clock.instant();
            if (jobs.ready(id, key, result.fileName(), size, result.rows(), result.parts(), done,
                    done.plus(properties.retention()))) {
                log.info("Audit log export ready exportId={} rows={} files={} bytes={} seconds={}", id, result.rows(),
                        result.parts(), size, (System.nanoTime() - started) / 1_000_000_000);
                publish(job, Status.READY, result.rows(), result.rows());
            } else {
                storage.delete(key); // removed during the upload
            }
        } catch (Stopping ex) {
            jobs.requeue(id);
            log.info("Audit log export handed back to the queue (instance stopping) exportId={}", id);
        } catch (ExportFailedException ex) {
            fail(job, ex.getMessage());
        } catch (IOException | RuntimeException ex) {
            log.error("Audit log export failed exportId={}", id, ex);
            fail(job, WRITE_FAILED);
        } finally {
            active.remove(id);
            if (work != null) {
                try {
                    Files.deleteIfExists(work);
                } catch (IOException ex) {
                    log.warn("Could not delete export work file {}", work, ex);
                }
            }
        }
    }

    /** @return null when the job was removed while it was written */
    private Result write(ExportJob job, Plan plan, Path work) throws IOException {
        AtomicBoolean removed = new AtomicBoolean();
        long[] lastMessage = {System.nanoTime()};
        long interval = properties.progressInterval().toNanos();
        try (ExportFileWriter writer = new ExportFileWriter(work, plan, AuditExportColumns.COLUMNS)) {
            auditLogs.forEachBatch(job.filters().toFilter(), job.asOf(), properties.batchSize(), batch -> {
                if (stopping) {
                    throw new Stopping();
                }
                try {
                    writer.accept(batch);
                } catch (IOException ex) {
                    throw new UncheckedIOException(ex);
                }
                if (!jobs.progress(job.id(), writer.rowsWritten(), clock.instant())) {
                    removed.set(true);
                    return false;
                }
                if (System.nanoTime() - lastMessage[0] >= interval) {
                    lastMessage[0] = System.nanoTime();
                    publish(job, Status.RUNNING, writer.rowsWritten(), plan.totalRows());
                }
                return true;
            });
            return removed.get() ? null : writer.finish();
        }
    }

    private void fail(ExportJob job, String message) {
        if (jobs.fail(job.id(), message, clock.instant())) {
            publish(job, Status.FAILED, job.rowsWritten(), job.totalRows());
        }
    }

    /** Only the admin who asked hears about an export; the browser then reloads the list (normal permissions). */
    private void publish(ExportJob job, Status status, long rowsWritten, Long totalRows) {
        Map<String, Object> data = new HashMap<>();
        data.put("status", status.name());
        data.put("rowsWritten", rowsWritten);
        data.put("totalRows", totalRows);
        try {
            realtime.publish(RealtimeMessage.of(MESSAGE_TYPE, "EXPORT", job.id().toString(), data),
                    RealtimeAudience.user(UUID.fromString(job.requestedBy())));
        } catch (RuntimeException ex) {
            log.warn("Could not send export progress exportId={}", job.id(), ex);
        }
    }

    /** What the file's "About this export" sheet lists, the same labels as the web export. */
    static List<String[]> aboutFilters(Filters filters) {
        List<String[]> about = new ArrayList<>();
        add(about, "Action", filters.action());
        add(about, "Entity type", filters.entityType());
        add(about, "Entity id", filters.entityId());
        add(about, "Actor id", filters.actorId());
        if (filters.from() != null) {
            about.add(new String[] {"From", ExportTime.shownDate(filters.from())});
        }
        if (filters.to() != null) {
            // The list's "to" is exclusive (the next India midnight): the last day it covers is the day before.
            about.add(new String[] {"To", ExportTime.shownDate(filters.to().minusNanos(1))});
        }
        about.add(new String[] {"Order", "Newest first"});
        return about;
    }

    private static void add(List<String[]> about, String label, String value) {
        if (value != null) {
            about.add(new String[] {label, value});
        }
    }

    private Path workDir() throws IOException {
        Path dir = properties.workDir().isBlank()
                ? Path.of(System.getProperty("java.io.tmpdir"), "flighthotel-exports")
                : Path.of(properties.workDir());
        return Files.createDirectories(dir);
    }

    private static String extension(String fileName) {
        return fileName.substring(fileName.lastIndexOf('.') + 1);
    }

    /** Thrown inside the batch loop when the instance stops. */
    private static final class Stopping extends RuntimeException {

        Stopping() {
            super(null, null, false, false);
        }
    }
}
