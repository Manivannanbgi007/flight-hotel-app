package com.flighthotel.reporting.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.reporting.audit.AuditLogStore;
import com.jayway.jsonpath.JsonPath;

/**
 * Background exports of the audit log end to end (API_DOCUMENTATION.md section 11): asked for by an admin, written by
 * the runner in parts (10 rows a part and 7 a batch here, so batches cross parts and equal times), told to the admin,
 * downloaded once through a short-lived link, and recorded in the audit log. Other admins never see the export.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://reporting-export-it",
        "reporting.exports.rows-per-part=10",
        "reporting.exports.batch-size=7",
        "reporting.exports.poll-interval=1h",
        "reporting.exports.sweep-interval=1h"
})
@AutoConfigureMockMvc
@Testcontainers
class AuditExportIntegrationTest {

    private static final Path STORAGE = tempDir("export-storage");
    private static final Path WORK = tempDir("export-work");

    @Container
    @ServiceConnection
    static MySQLContainer mysql = new MySQLContainer("mysql:8.4.13").withDatabaseName("reporting_db");

    @DynamicPropertySource
    static void folders(DynamicPropertyRegistry registry) {
        registry.add("travel.storage.local-root", STORAGE::toString);
        registry.add("reporting.exports.work-dir", WORK::toString);
    }

    @Autowired
    MockMvc mockMvc;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    AuditExportRunner runner;

    @Autowired
    ExportJobStore jobs;

    @Autowired
    AuditLogStore auditLogs;

    @MockitoBean
    RealtimePublisher realtime;

    private final UUID admin = UUID.randomUUID();
    private final String actor = UUID.randomUUID().toString();

    /** Each test starts with no exports (the poller would also pick up another test's waiting ones). */
    @BeforeEach
    void clean() {
        reset(realtime);
        jdbc.sql("DELETE FROM export_jobs").update();
    }

    @Test
    void anAdminExportsEveryMatchingEntryAsExcelPartsAndDownloadsThemOnce() throws Exception {
        List<String> expectedOrder = seed(actor, 25);
        // Recorded after the export was asked for: not in it.
        insert(actor, "late-1", Instant.now().minusSeconds(30), Instant.now().plus(1, ChronoUnit.HOURS));

        String id = request("{\"format\":\"XLSX\",\"actorId\":\"" + actor + "\",\"exportedBy\":\"Asha Rao (Admin)\"}");
        mockMvc.perform(get("/api/admin/audit-logs/exports").with(admin(admin)))
                .andExpect(jsonPath("$[0].id").value(id))
                .andExpect(jsonPath("$[0].status").value("QUEUED"))
                .andExpect(jsonPath("$[0].filters.actorId").value(actor));

        // The poller claims it and a worker thread writes it.
        runner.startQueued();
        waitFor(id, "READY");

        mockMvc.perform(get("/api/admin/audit-logs/exports/" + id).with(admin(admin)))
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.totalRows").value(25))
                .andExpect(jsonPath("$.rowsWritten").value(25))
                .andExpect(jsonPath("$.parts").value(3))
                .andExpect(jsonPath("$.fileName").value(org.hamcrest.Matchers.matchesPattern(
                        "audit-logs-\\d{4}-\\d{2}-\\d{2}\\.zip")))
                .andExpect(jsonPath("$.sizeBytes").isNumber())
                .andExpect(jsonPath("$.expiresAt").isString());
        ArgumentCaptor<RealtimeMessage> messages = ArgumentCaptor.forClass(RealtimeMessage.class);
        ArgumentCaptor<RealtimeAudience> audiences = ArgumentCaptor.forClass(RealtimeAudience.class);
        verify(realtime, atLeastOnce()).publish(messages.capture(), audiences.capture());
        RealtimeMessage last = messages.getValue();
        assertThat(last.type()).isEqualTo("export.status-changed");
        assertThat(last.resourceId()).isEqualTo(id);
        assertThat(last.data()).containsEntry("status", "READY").containsEntry("rowsWritten", 25L);
        assertThat(audiences.getAllValues()).allMatch(audience -> audience.userIds().equals(
                java.util.Set.of(admin.toString())) && audience.roles().isEmpty());
        // Nothing left behind in the work folder.
        try (Stream<Path> left = Files.list(WORK)) {
            assertThat(left).isEmpty();
        }

        // Somebody else's export does not exist for another admin.
        UUID other = UUID.randomUUID();
        mockMvc.perform(get("/api/admin/audit-logs/exports/" + id).with(admin(other))).andExpect(status().isNotFound());
        mockMvc.perform(post("/api/admin/audit-logs/exports/" + id + "/link").with(admin(other)))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/admin/audit-logs/exports/" + id).with(admin(other)))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/admin/audit-logs/exports").with(admin(other))).andExpect(jsonPath("$.length()").value(0));

        // A one-time link, opened without a login (the browser's download manager).
        String url = JsonPath.read(mockMvc.perform(post("/api/admin/audit-logs/exports/" + id + "/link")
                        .with(admin(admin))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(),
                "$.url");
        assertThat(url).startsWith("/api/public/export-files/" + id + "?token=");
        mockMvc.perform(get(url.substring(0, url.indexOf('?')))).andExpect(status().isNotFound());
        mockMvc.perform(get(url + "x")).andExpect(status().isNotFound());
        byte[] zip = mockMvc.perform(get(url))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/zip"))
                .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.startsWith(
                        "attachment; filename=\"audit-logs-")))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andReturn().getResponse().getContentAsByteArray();
        // Used up.
        mockMvc.perform(get(url)).andExpect(status().isNotFound());

        List<String> order = new ArrayList<>();
        List<Integer> partRows = new ArrayList<>();
        try (ZipInputStream parts = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry part;
            while ((part = parts.getNextEntry()) != null) {
                try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(parts.readAllBytes()))) {
                    XSSFSheet sheet = workbook.getSheetAt(0);
                    partRows.add(sheet.getLastRowNum());
                    for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                        order.add(sheet.getRow(r).getCell(10).getStringCellValue());
                    }
                }
            }
        }
        assertThat(partRows).containsExactly(10, 10, 5);
        // Every entry exactly once, newest first (equal times: by id), across batches and parts.
        assertThat(order).containsExactlyElementsOf(expectedOrder);

        // Asking and downloading are in the audit trail (through the outbox, actor = the admin).
        assertThat(jdbc.sql("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'audit' AND aggregate_id = :id")
                .param("id", id).query(Integer.class).single()).isEqualTo(2);

        // An expired link does not work either.
        String second = JsonPath.read(mockMvc.perform(post("/api/admin/audit-logs/exports/" + id + "/link")
                .with(admin(admin))).andReturn().getResponse().getContentAsString(), "$.url");
        jdbc.sql("UPDATE export_jobs SET link_expires_at = :past WHERE id = UUID_TO_BIN(:id)")
                .param("past", LocalDateTime.now(ZoneOffset.UTC).minusSeconds(1)).param("id", id).update();
        mockMvc.perform(get(second)).andExpect(status().isNotFound());

        // Removing it deletes the file.
        String key = jdbc.sql("SELECT storage_key FROM export_jobs WHERE id = UUID_TO_BIN(:id)").param("id", id)
                .query(String.class).single();
        assertThat(STORAGE.resolve(key)).exists();
        mockMvc.perform(delete("/api/admin/audit-logs/exports/" + id).with(admin(admin)))
                .andExpect(status().isNoContent());
        assertThat(STORAGE.resolve(key)).doesNotExist();
        mockMvc.perform(get("/api/admin/audit-logs/exports/" + id).with(admin(admin))).andExpect(status().isNotFound());
    }

    @Test
    void csvIsOneFileAndAnExportCanBeCancelledWhileItRuns() throws Exception {
        seed(actor, 5);
        String id = request("{\"format\":\"CSV\",\"actorId\":\"" + actor + "\"}");
        jobs.claim(UUID.fromString(id), Instant.now());
        runner.run(UUID.fromString(id));
        mockMvc.perform(get("/api/admin/audit-logs/exports/" + id).with(admin(admin)))
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.parts").value(1))
                .andExpect(jsonPath("$.fileName").value(org.hamcrest.Matchers.endsWith(".csv")));
        String url = JsonPath.read(mockMvc.perform(post("/api/admin/audit-logs/exports/" + id + "/link")
                .with(admin(admin))).andReturn().getResponse().getContentAsString(), "$.url");
        String csv = mockMvc.perform(get(url)).andExpect(header().string("Content-Type", "text/csv;charset=UTF-8"))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(csv.split("\r\n")).hasSize(6);

        // The admin cancels as soon as it starts: it stops at its next batch, and nothing is stored.
        seed(actor, 20);
        String cancelled = request("{\"format\":\"XLSX\",\"actorId\":\"" + actor + "\"}");
        doAnswer(invocation -> {
            RealtimeMessage message = invocation.getArgument(0);
            if (message.resourceId().equals(cancelled) && "RUNNING".equals(message.data().get("status"))) {
                mockMvc.perform(delete("/api/admin/audit-logs/exports/" + cancelled).with(admin(admin)))
                        .andExpect(status().isNoContent());
            }
            return null;
        }).when(realtime).publish(any(), any());
        long storedBefore = countStored();
        jobs.claim(UUID.fromString(cancelled), Instant.now());
        runner.run(UUID.fromString(cancelled));
        assertThat(jobs.find(UUID.fromString(cancelled))).isEmpty();
        assertThat(countStored()).isEqualTo(storedBefore);
        try (Stream<Path> left = Files.list(WORK)) {
            assertThat(left).isEmpty();
        }
    }

    @Test
    void anAdminHasAtMostTwoUnfinishedExportsAndAnEmptyExportIsRefused() throws Exception {
        seed(actor, 3);
        String body = "{\"format\":\"XLSX\",\"actorId\":\"" + actor + "\"}";
        mockMvc.perform(post("/api/admin/audit-logs/exports").with(admin(admin)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"format\":\"XLSX\",\"actorId\":\"" + UUID.randomUUID() + "\"}"))
                .andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("EXPORT_EMPTY"));
        mockMvc.perform(post("/api/admin/audit-logs/exports").with(admin(admin)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"format\":\"PDF\"}"))
                .andExpect(status().isBadRequest());

        String first = request(body);
        request(body);
        mockMvc.perform(post("/api/admin/audit-logs/exports").with(admin(admin)).contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EXPORT_LIMIT_REACHED"));
        // Cancelling one makes room; and a waiting export cannot be downloaded yet.
        mockMvc.perform(post("/api/admin/audit-logs/exports/" + first + "/link").with(admin(admin)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EXPORT_NOT_READY"));
        mockMvc.perform(delete("/api/admin/audit-logs/exports/" + first).with(admin(admin)))
                .andExpect(status().isNoContent());
        request(body);
        // Two instances: only one gets to run a job.
        String id = JsonPath.read(mockMvc.perform(get("/api/admin/audit-logs/exports").with(admin(admin)))
                .andReturn().getResponse().getContentAsString(), "$[0].id");
        assertThat(jobs.claim(UUID.fromString(id), Instant.now())).isTrue();
        assertThat(jobs.claim(UUID.fromString(id), Instant.now())).isFalse();
    }

    @Test
    void finishedFilesAreDeletedWhenTheirTimeIsOverAndInterruptedExportsFail() throws Exception {
        seed(actor, 3);
        String ready = request("{\"format\":\"XLSX\",\"actorId\":\"" + actor + "\"}");
        jobs.claim(UUID.fromString(ready), Instant.now());
        runner.run(UUID.fromString(ready));
        String key = jdbc.sql("SELECT storage_key FROM export_jobs WHERE id = UUID_TO_BIN(:id)").param("id", ready)
                .query(String.class).single();
        String stuck = request("{\"format\":\"CSV\",\"actorId\":\"" + actor + "\"}");
        jobs.claim(UUID.fromString(stuck), Instant.now());
        LocalDateTime past = LocalDateTime.now(ZoneOffset.UTC).minusMinutes(10);
        jdbc.sql("UPDATE export_jobs SET expires_at = :past WHERE id = UUID_TO_BIN(:id)").param("past", past)
                .param("id", ready).update();
        jdbc.sql("UPDATE export_jobs SET heartbeat_at = :past WHERE id = UUID_TO_BIN(:id)").param("past", past)
                .param("id", stuck).update();

        runner.sweep();

        assertThat(STORAGE.resolve(key)).doesNotExist();
        mockMvc.perform(get("/api/admin/audit-logs/exports/" + ready).with(admin(admin)))
                .andExpect(jsonPath("$.status").value("EXPIRED"));
        mockMvc.perform(post("/api/admin/audit-logs/exports/" + ready + "/link").with(admin(admin)))
                .andExpect(status().isConflict());
        mockMvc.perform(get("/api/admin/audit-logs/exports/" + stuck).with(admin(admin)))
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.error").value(AuditExportRunner.INTERRUPTED));
    }

    @Test
    void everyFilterShapeReadsAllItsEntriesNewestFirstThroughItsIndex() {
        seed(actor, 12);
        String entityId = jdbc.sql("SELECT entity_id FROM audit_logs WHERE actor_id = :actor LIMIT 1")
                .param("actor", actor).query(String.class).single();
        Instant asOf = Instant.now();
        List<AuditLogStore.Filter> shapes = List.of(
                new AuditLogStore.Filter(null, null, null, null, null, null),
                new AuditLogStore.Filter("BOOKING_CANCELLED", null, null, null, null, null),
                new AuditLogStore.Filter(null, "BOOKING", entityId, null, null, null),
                new AuditLogStore.Filter(null, "BOOKING", null, actor, Instant.now().minus(3, ChronoUnit.HOURS),
                        Instant.now()),
                new AuditLogStore.Filter("BOOKING_CANCELLED", null, null, actor, null, null));
        for (AuditLogStore.Filter filter : shapes) {
            List<AuditLogStore.AuditLogEntry> read = new ArrayList<>();
            long count = auditLogs.forEachBatch(filter, asOf, 5, batch -> read.addAll(batch));
            assertThat(count).as("%s", filter).isEqualTo(auditLogs.count(filter, asOf)).isEqualTo(read.size());
            assertThat(read).extracting(AuditLogStore.AuditLogEntry::id).doesNotHaveDuplicates();
            for (int i = 1; i < read.size(); i++) {
                assertThat(read.get(i).occurredAt()).isBeforeOrEqualTo(read.get(i - 1).occurredAt());
            }
        }
    }

    // ------------------------------------------------------------------ helpers

    private String request(String body) throws Exception {
        return JsonPath.read(mockMvc.perform(post("/api/admin/audit-logs/exports").with(admin(admin))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andReturn().getResponse().getContentAsString(), "$.id");
    }

    /**
     * {@code count} entries of one actor, three at each time (so batches end inside equal times), recorded an hour
     * ago. @return their correlation ids in export order: newest first, then by id
     */
    private List<String> seed(String actorId, int count) {
        Instant base = Instant.now().minus(2, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS);
        record Seeded(Instant at, String id, String correlation) {
        }
        List<Seeded> seeded = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            Instant at = base.minusSeconds(60L * (i / 3));
            String correlation = "corr-" + UUID.randomUUID();
            seeded.add(new Seeded(at, insert(actorId, correlation, at, Instant.now().minus(1, ChronoUnit.HOURS)),
                    correlation));
        }
        return seeded.stream().sorted(Comparator.comparing(Seeded::at).thenComparing(Seeded::id).reversed())
                .map(Seeded::correlation).toList();
    }

    private String insert(String actorId, String correlation, Instant occurredAt, Instant receivedAt) {
        String id = UuidV7.generate().toString();
        jdbc.sql("INSERT INTO audit_logs (id, source_event_id, service, actor_id, actor_roles, action, entity_type, "
                        + "entity_id, details, ip_address, correlation_id, occurred_at, received_at) VALUES "
                        + "(UUID_TO_BIN(:id), :eventId, 'booking-service', :actor, 'SUPPORT_AGENT', "
                        + "'BOOKING_CANCELLED', 'BOOKING', :entityId, '{\"refundAmount\":\"3150.00\"}', '203.0.113.7', "
                        + ":correlation, :occurredAt, :receivedAt)")
                .param("id", id).param("eventId", UUID.randomUUID().toString()).param("actor", actorId)
                .param("entityId", UUID.randomUUID().toString()).param("correlation", correlation)
                .param("occurredAt", LocalDateTime.ofInstant(occurredAt, ZoneOffset.UTC))
                .param("receivedAt", LocalDateTime.ofInstant(receivedAt, ZoneOffset.UTC))
                .update();
        return id;
    }

    private void waitFor(String id, String status) throws InterruptedException {
        for (int i = 0; i < 200; i++) {
            String current = jdbc.sql("SELECT status FROM export_jobs WHERE id = UUID_TO_BIN(:id)").param("id", id)
                    .query(String.class).single();
            if (status.equals(current)) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Export " + id + " did not reach " + status);
    }

    private static long countStored() throws IOException {
        Path folder = STORAGE.resolve("exports");
        if (!Files.exists(folder)) {
            return 0;
        }
        try (Stream<Path> files = Files.list(folder)) {
            return files.count();
        }
    }

    private static JwtRequestPostProcessor admin(UUID id) {
        return jwt().jwt(token -> token.subject(id.toString()).claim("roles", List.of("ADMIN")))
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }

    private static Path tempDir(String prefix) {
        try {
            return Files.createTempDirectory(prefix);
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
    }
}
