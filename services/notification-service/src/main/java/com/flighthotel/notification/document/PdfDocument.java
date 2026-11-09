package com.flighthotel.notification.document;

import java.util.List;

/**
 * What a generated PDF shows, independent of its look: one layout ({@code templates/pdf/document.html}) renders every
 * document type from this model, so the content can be tested without parsing HTML.
 *
 * @param title     e.g. "Hotel booking confirmation"
 * @param reference the main number, e.g. the booking reference or the invoice number
 * @param issued    "Issued 5 Nov 2026, 21:50 IST"
 * @param demo      DEMO inventory or payment: a visible banner says it is not a real booking
 * @param pages     one or more pages (the e-ticket has one per traveller)
 */
public record PdfDocument(String title, String reference, String issued, boolean demo, List<Page> pages) {

    public record Page(String heading, List<Section> sections, List<String> notes) {
    }

    /** A titled block of label/value rows, optionally followed by a table. */
    public record Section(String heading, List<Row> rows, Table table) {

        public static Section rows(String heading, List<Row> rows) {
            return new Section(heading, rows, null);
        }

        public static Section table(String heading, Table table) {
            return new Section(heading, List.of(), table);
        }
    }

    public record Row(String label, String value, boolean strong) {

        public static Row of(String label, String value) {
            return new Row(label, value, false);
        }

        public static Row total(String label, String value) {
            return new Row(label, value, true);
        }
    }

    public record Table(List<String> columns, List<List<String>> rows) {
    }
}
