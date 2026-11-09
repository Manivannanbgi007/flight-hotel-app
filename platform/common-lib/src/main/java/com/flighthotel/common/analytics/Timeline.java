package com.flighthotel.common.analytics;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

import com.flighthotel.common.analytics.Interval.Bucket;

/**
 * The buckets of a range at an interval, with a quick "which bucket is this day in". Figures are summed per day in SQL
 * and folded into the buckets here, so every service cuts weeks, months and years the same way.
 */
public final class Timeline {

    private final DayRange range;
    private final Interval interval;
    private final List<Bucket> buckets;
    private final NavigableMap<LocalDate, Integer> byStart = new TreeMap<>();

    private Timeline(DayRange range, Interval interval) {
        this.range = range;
        this.interval = interval;
        this.buckets = List.copyOf(interval.buckets(range));
        for (int i = 0; i < buckets.size(); i++) {
            byStart.put(buckets.get(i).start(), i);
        }
    }

    public static Timeline of(DayRange range, Interval interval) {
        return new Timeline(range, interval);
    }

    public DayRange range() {
        return range;
    }

    public Interval interval() {
        return interval;
    }

    public List<Bucket> buckets() {
        return buckets;
    }

    public int size() {
        return buckets.size();
    }

    /** The index of the bucket the day is in, or -1 outside the range. */
    public int indexOf(LocalDate day) {
        if (!range.contains(day)) {
            return -1;
        }
        Map.Entry<LocalDate, Integer> entry = byStart.floorEntry(day);
        return entry == null ? -1 : entry.getValue();
    }
}
