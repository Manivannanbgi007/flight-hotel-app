package com.flighthotel.hotel.review;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

import com.flighthotel.hotel.dto.ReviewDtos.ManagerReview;
import com.flighthotel.hotel.dto.ReviewDtos.MyReview;
import com.flighthotel.hotel.dto.ReviewDtos.PublicReview;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.Review;

/** Review → API mapping and the display rules for names and dates. Entities never leave the service layer. */
final class ReviewViews {

    private static final DateTimeFormatter STAYED_IN = DateTimeFormatter.ofPattern("MMM yyyy", Locale.ENGLISH);
    private static final int MAX_NAME = 80;

    private ReviewViews() {
    }

    /**
     * How the author is shown publicly: first name and the initial of the last name ("Asha R."), so a review never
     * carries a guest's full name.
     */
    static String authorName(String firstName, String lastName) {
        String first = firstName == null ? "" : firstName.strip();
        String last = lastName == null ? "" : lastName.strip();
        String name;
        if (first.isEmpty()) {
            name = last.isEmpty() ? "Guest" : initial(last);
        } else {
            name = last.isEmpty() ? first : first + " " + initial(last);
        }
        return name.length() > MAX_NAME ? name.substring(0, MAX_NAME) : name;
    }

    private static String initial(String name) {
        return name.substring(0, Character.charCount(name.codePointAt(0))).toUpperCase(Locale.ROOT) + ".";
    }

    /** "Nov 2026": the month of the stay, never the exact dates. */
    static String stayedIn(LocalDate stayedOn) {
        return STAYED_IN.format(stayedOn);
    }

    static MyReview mine(Review review, Hotel hotel) {
        return new MyReview(review.getId(), review.getHotelId(), hotel == null ? null : hotel.getName(),
                hotel == null ? null : hotel.getSlug(), review.getBookingId(), review.getBookingReference(),
                review.getRating(), review.getTitle(), review.getText(), review.getAuthorName(),
                stayedIn(review.getStayedOn()), review.getStatus(), review.getRejectionReason(),
                review.getCreatedAt(), review.getModeratedAt());
    }

    static PublicReview publicReview(Review review) {
        return new PublicReview(review.getId(), review.getRating(), review.getTitle(), review.getText(),
                review.getAuthorName(), stayedIn(review.getStayedOn()), review.getCreatedAt());
    }

    static ManagerReview managerReview(Review review) {
        return new ManagerReview(review.getId(), review.getRating(), review.getTitle(), review.getText(),
                review.getAuthorName(), stayedIn(review.getStayedOn()), review.getBookingReference(),
                review.getStatus(), review.getCreatedAt(), review.getModeratedAt());
    }
}
