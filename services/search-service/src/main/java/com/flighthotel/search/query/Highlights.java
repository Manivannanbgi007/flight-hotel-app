package com.flighthotel.search.query;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.flighthotel.search.web.SearchDtos.TextSegment;

/**
 * Turns Elasticsearch highlights ("\u0001Chen\u0002nai Grand") into text segments ([Chen ✓][nai Grand]). The browser
 * renders the matched segments in {@code <mark>}; no HTML ever travels, so record text cannot inject markup.
 */
final class Highlights {

    private Highlights() {
    }

    static List<TextSegment> segments(String highlighted) {
        if (highlighted == null) {
            return null;
        }
        List<TextSegment> segments = new ArrayList<>();
        StringBuilder text = new StringBuilder();
        boolean inMatch = false;
        for (char c : highlighted.toCharArray()) {
            if (c == SearchQueries.MARK_START.charAt(0) || c == SearchQueries.MARK_END.charAt(0)) {
                add(segments, text.toString(), inMatch);
                text.setLength(0);
                inMatch = c == SearchQueries.MARK_START.charAt(0);
            } else {
                text.append(c);
            }
        }
        add(segments, text.toString(), inMatch);
        return segments;
    }

    /** The first highlight of the first field that has one, as segments. */
    static List<TextSegment> first(Map<String, List<String>> highlight, String... fields) {
        if (highlight == null) {
            return null;
        }
        for (String field : fields) {
            List<String> fragments = highlight.get(field);
            if (fragments != null && !fragments.isEmpty()) {
                return segments(fragments.getFirst());
            }
        }
        return null;
    }

    /** All highlighted values of the first field that has any, joined with ", " (e.g. the matching guest names). */
    static String joined(Map<String, List<String>> highlight, String... fields) {
        if (highlight == null) {
            return null;
        }
        for (String field : fields) {
            List<String> fragments = highlight.get(field);
            if (fragments != null && !fragments.isEmpty()) {
                return String.join(", ", fragments);
            }
        }
        return null;
    }

    /** The plain text of segments. */
    static String plain(List<TextSegment> segments) {
        if (segments == null) {
            return null;
        }
        StringBuilder text = new StringBuilder();
        segments.forEach(segment -> text.append(segment.text()));
        return text.toString();
    }

    private static void add(List<TextSegment> segments, String text, boolean match) {
        if (text.isEmpty()) {
            return;
        }
        if (!segments.isEmpty() && segments.getLast().match() == match) {
            TextSegment last = segments.removeLast();
            segments.add(new TextSegment(last.text() + text, match));
        } else {
            segments.add(new TextSegment(text, match));
        }
    }
}
