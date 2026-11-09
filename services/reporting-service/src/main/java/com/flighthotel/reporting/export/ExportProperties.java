package com.flighthotel.reporting.export;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Background exports ({@code reporting.exports.*}).
 *
 * @param rowsPerPart       Excel data rows per file; more rows give a .zip of parts (Excel holds 1,048,576 rows a sheet)
 * @param batchSize         entries read per database query
 * @param concurrency       exports written at the same time by one instance
 * @param maxActivePerAdmin unfinished exports one admin may have
 * @param retention         how long a finished file can be downloaded
 * @param listFor           how far back "your exports" goes
 * @param linkLifetime      how long a one-time download link works
 * @param staleAfter        a running export with no heartbeat for this long was interrupted (instance stopped)
 * @param progressInterval  progress messages to the browser at most this often
 * @param maxFileBytes      larger files fail (one S3 upload holds at most 5 GB)
 * @param workDir           where files are written before they are stored; empty = the system temp folder
 */
@ConfigurationProperties("reporting.exports")
public record ExportProperties(
        @DefaultValue("1000000") int rowsPerPart,
        @DefaultValue("5000") int batchSize,
        @DefaultValue("2") int concurrency,
        @DefaultValue("2") int maxActivePerAdmin,
        @DefaultValue("24h") Duration retention,
        @DefaultValue("7d") Duration listFor,
        @DefaultValue("60s") Duration linkLifetime,
        @DefaultValue("2m") Duration staleAfter,
        @DefaultValue("5s") Duration progressInterval,
        @DefaultValue("4500000000") long maxFileBytes,
        @DefaultValue("") String workDir) {

    /** Excel's last row is 1,048,576; one is the header. */
    public static final int EXCEL_MAX_DATA_ROWS = 1_048_575;

    public ExportProperties {
        if (rowsPerPart < 1 || rowsPerPart > EXCEL_MAX_DATA_ROWS) {
            throw new IllegalArgumentException("reporting.exports.rows-per-part must be 1.." + EXCEL_MAX_DATA_ROWS);
        }
        if (batchSize < 1 || concurrency < 1 || maxActivePerAdmin < 1) {
            throw new IllegalArgumentException("reporting.exports batch-size, concurrency and max-active-per-admin "
                    + "must be positive");
        }
    }
}
