package com.flighthotel.assistant.grounding;

import java.math.BigDecimal;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The "no invented data" check (IMPLEMENTATION_PLAN.md §11.4): an answer may only name a booking reference, ticket
 * number, PNR, confirmation number or amount that appeared in this conversation's tool results. Anything else is
 * treated as made up, and the answer is replaced by {@link #SAFE_ANSWER}.
 * <p>
 * What counts:
 * <ul>
 * <li><b>references</b>: two capital letters, a dash, eight letters/digits ({@code HT-7K3M9Q2X}, {@code TK-…});</li>
 * <li><b>codes</b>: 6–12 capital letters and digits with at least one of each (PNRs such as {@code K7QX2M},
 * hotel confirmation numbers {@code H7K3M9Q2XA}); a 6-character code right after "PNR" also without digits;</li>
 * <li><b>e-ticket numbers</b>: 13 digits, optionally {@code 098-1234567890};</li>
 * <li><b>amounts</b>: a number with ₹, Rs, INR or "rupees" before or after it, compared by value
 * ({@code ₹6,300} = {@code 6300.00}).</li>
 * </ul>
 * Plain numbers (counts, nights, dates, percentages) are not checked.
 */
public final class GroundingGuard {

    public static final String SAFE_ANSWER = "I can only give you booking references, ticket numbers and amounts "
            + "that I found in your data, and I could not confirm every detail of my answer. Please check the "
            + "details on the relevant page of the app, or ask me again in a different way.";

    private static final Pattern REFERENCE = Pattern.compile("(?<![A-Za-z0-9-])[A-Z]{2}-[A-Z0-9]{8}(?![A-Za-z0-9-])");
    private static final Pattern CODE = Pattern.compile(
            "(?<![A-Za-z0-9-])(?=[A-Z0-9]*\\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,12}(?![A-Za-z0-9-])");
    private static final Pattern LABELLED_PNR = Pattern.compile("PNR\\W{0,15}([A-Z0-9]{6})(?![A-Za-z0-9])");
    private static final Pattern E_TICKET = Pattern.compile("(?<![0-9-])(\\d{3})-?(\\d{10})(?![0-9])");
    private static final Pattern AMOUNT_PREFIX = Pattern.compile(
            "(?:₹|\\bRs\\.?|\\bINR)\\s?(\\d[\\d,]*(?:\\.\\d+)?)");
    private static final Pattern AMOUNT_SUFFIX = Pattern.compile(
            "(?<![\\d.,])(\\d[\\d,]*(?:\\.\\d+)?)\\s?(?:INR|rupees|Rs\\b)", Pattern.CASE_INSENSITIVE);
    private static final Pattern ANY_NUMBER = Pattern.compile("(?<![\\d.])\\d[\\d,]*(?:\\.\\d+)?");
    private static final Pattern UPPER_TOKEN = Pattern.compile("[A-Z0-9]+");

    private GroundingGuard() {
    }

    /** Something the answer named that no tool result contained. */
    public record Violation(String kind, String value) {
        @Override
        public String toString() {
            // The value itself is never logged; only its kind.
            return "Violation[" + kind + "]";
        }
    }

    /**
     * Typographic variants that models like to write are read as the plain characters, so they cannot hide a value
     * from the check: "HT‑7K3M9Q2X" with a non-breaking hyphen (U+2011) is the reference HT-7K3M9Q2X, "₹ 6,300" with
     * a narrow no-break space is ₹6,300, full-width digits are digits.
     */
    static String normalise(String text) {
        if (text == null) {
            return "";
        }
        return java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFKC)
                .replaceAll("[\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]", "-")
                .replaceAll("[\\u00A0\\u2007\\u202F\\u2009\\u200A]", " ")
                .replaceAll("[\\u200B-\\u200D\\u2060\\uFEFF]", "");
    }

    /** The first value in {@code answer} that is not in {@code facts}, if any. */
    public static Optional<Violation> check(String rawAnswer, Facts facts) {
        String answer = normalise(rawAnswer);
        for (String identifier : identifiersInAnswer(answer)) {
            if (!facts.hasIdentifier(identifier)) {
                return Optional.of(new Violation("identifier", identifier));
            }
        }
        for (String amount : amountsInAnswer(answer)) {
            if (!facts.hasAmount(amount)) {
                return Optional.of(new Violation("amount", amount));
            }
        }
        return Optional.empty();
    }

    /** Identifiers an answer names (normalised: upper case, e-tickets without dash). */
    static Set<String> identifiersInAnswer(String text) {
        Set<String> found = new LinkedHashSet<>();
        addAll(found, REFERENCE.matcher(text), 0);
        addAll(found, CODE.matcher(text), 0);
        addAll(found, LABELLED_PNR.matcher(text), 1);
        Matcher ticket = E_TICKET.matcher(text);
        while (ticket.find()) {
            found.add(ticket.group(1) + ticket.group(2));
        }
        return found;
    }

    /** Amounts with a currency marker, canonical ({@code "6300"}, {@code "1234.5"}). */
    static Set<String> amountsInAnswer(String text) {
        Set<String> found = new LinkedHashSet<>();
        for (Pattern pattern : List.of(AMOUNT_PREFIX, AMOUNT_SUFFIX)) {
            Matcher matcher = pattern.matcher(text);
            while (matcher.find()) {
                canonical(matcher.group(1)).ifPresent(found::add);
            }
        }
        return found;
    }

    /**
     * Identifiers in a tool result: every capital-letter/digit token (and two adjacent ones joined, so "6E 2134"
     * also allows "6E2134"), references, and e-ticket numbers without their dash.
     */
    static Set<String> identifiersInSource(String text) {
        Set<String> found = new LinkedHashSet<>();
        addAll(found, REFERENCE.matcher(text), 0);
        Matcher tokens = UPPER_TOKEN.matcher(text);
        String previous = null;
        int previousEnd = -10;
        while (tokens.find()) {
            String token = tokens.group();
            found.add(token);
            if (previous != null && tokens.start() - previousEnd <= 1) {
                found.add(previous + token);
            }
            previous = token;
            previousEnd = tokens.end();
        }
        Matcher ticket = E_TICKET.matcher(text);
        while (ticket.find()) {
            found.add(ticket.group(1) + ticket.group(2));
        }
        return found;
    }

    /** Every number in a tool result, canonical. Tool results carry amounts as "₹6,300" or as plain JSON numbers. */
    static Set<String> numbersInSource(String text) {
        Set<String> found = new LinkedHashSet<>();
        Matcher matcher = ANY_NUMBER.matcher(text);
        while (matcher.find()) {
            canonical(matcher.group()).ifPresent(found::add);
        }
        return found;
    }

    static Optional<String> canonical(String number) {
        String digits = number.replace(",", "");
        if (digits.endsWith(".")) {
            digits = digits.substring(0, digits.length() - 1);
        }
        try {
            return Optional.of(new BigDecimal(digits).stripTrailingZeros().toPlainString());
        } catch (NumberFormatException ex) {
            return Optional.empty();
        }
    }

    private static void addAll(Set<String> found, Matcher matcher, int group) {
        while (matcher.find()) {
            found.add(matcher.group(group).toUpperCase());
        }
    }
}
