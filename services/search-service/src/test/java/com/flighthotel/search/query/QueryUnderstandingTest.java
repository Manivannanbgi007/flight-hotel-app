package com.flighthotel.search.query;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.DESTINATIONS;
import static com.flighthotel.search.index.SearchCategory.HOTELS;
import static com.flighthotel.search.index.SearchCategory.PAYMENTS;
import static com.flighthotel.search.index.SearchCategory.REVIEWS;
import static com.flighthotel.search.index.SearchCategory.TICKETS;
import static com.flighthotel.search.index.SearchCategory.USERS;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class QueryUnderstandingTest {

    @Test
    void placesStayWordsToMatch() {
        ParsedQuery query = QueryUnderstanding.parse("Hotels in Chennai");
        assertThat(query.text()).isEqualTo("Chennai");
        assertThat(query.categories()).containsExactlyInAnyOrder(HOTELS, DESTINATIONS, BOOKINGS, REVIEWS);
        assertThat(query.bookingType()).isEqualTo("HOTEL");
        assertThat(query.browse()).isFalse();
    }

    @Test
    void flightsOpenTheFlightSearch() {
        ParsedQuery query = QueryUnderstanding.parse("Flights to Mumbai");
        assertThat(query.text()).isEqualTo("Mumbai");
        assertThat(query.flightIntent()).isTrue();
        assertThat(query.categories()).containsExactlyInAnyOrder(DESTINATIONS, BOOKINGS);
    }

    @Test
    void theKindOfRecordWinsOverHotelOrFlight() {
        ParsedQuery query = QueryUnderstanding.parse("my hotel reservations");
        assertThat(query.categories()).containsExactly(BOOKINGS);
        assertThat(query.bookingType()).isEqualTo("HOTEL");
        assertThat(query.browse()).isTrue();
    }

    @Test
    void statusWordsBecomeFilters() {
        ParsedQuery query = QueryUnderstanding.parse("My cancelled reservations");
        assertThat(query.status()).isEqualTo(StatusWord.CANCELLED);
        assertThat(query.categories()).containsExactly(BOOKINGS);
        assertThat(query.browse()).isTrue();

        ParsedQuery open = QueryUnderstanding.parse("open tickets");
        assertThat(open.status()).isEqualTo(StatusWord.OPEN);
        assertThat(open.categories()).containsExactly(TICKETS);
    }

    @Test
    void pendingPaymentsAreBookingsWaitingForPayment() {
        ParsedQuery query = QueryUnderstanding.parse("pending payments");
        assertThat(query.categories()).containsExactly(BOOKINGS);
        assertThat(query.waitingForPayment()).isTrue();
    }

    @Test
    void aTypoInAVocabularyWordIsForgiven() {
        assertThat(QueryUnderstanding.parse("Paymnt").categories()).containsExactly(PAYMENTS);
        assertThat(QueryUnderstanding.parse("Reservaton").categories()).containsExactly(BOOKINGS);
        assertThat(QueryUnderstanding.parse("Custmer").categories()).containsExactly(USERS);
        assertThat(QueryUnderstanding.parse("Custmer").role()).isEqualTo("CUSTOMER");
        assertThat(QueryUnderstanding.parse("Hotle").bookingType()).isEqualTo("HOTEL");
    }

    @Test
    void shortWordsMustBeExact() {
        // "star" is not "stay", "trim" is not "trip", "tour" is not "user": they stay words to search for.
        assertThat(QueryUnderstanding.parse("star").text()).isEqualTo("star");
        assertThat(QueryUnderstanding.parse("trim").categories()).isEmpty();
        assertThat(QueryUnderstanding.parse("tour").categories()).isEmpty();
    }

    @Test
    void twoWordNamesArePeople() {
        ParsedQuery managers = QueryUnderstanding.parse("hotel managers");
        assertThat(managers.categories()).containsExactly(USERS);
        assertThat(managers.role()).isEqualTo("HOTEL_MANAGER");
        assertThat(managers.bookingType()).isNull();

        ParsedQuery tickets = QueryUnderstanding.parse("Open a support ticket");
        assertThat(tickets.categories()).containsExactly(TICKETS);
        assertThat(tickets.pageText()).isEqualTo("Open support ticket");
    }

    @Test
    void referencesNamesAndEmailsAreKeptAsTyped() {
        assertThat(QueryUnderstanding.parse("  HT-7Q2X9KLM ").text()).isEqualTo("HT-7Q2X9KLM");
        assertThat(QueryUnderstanding.parse("John   Smith").text()).isEqualTo("John Smith");
        assertThat(QueryUnderstanding.parse("john@example.com").text()).isEqualTo("john@example.com");
    }

    @Test
    void onlySmallWordsAreSearchedAsTyped() {
        ParsedQuery query = QueryUnderstanding.parse("my");
        assertThat(query.text()).isEqualTo("my");
        assertThat(query.browse()).isFalse();
    }

    @Test
    void hotelOrFlightAloneListsHotelsOrFlightBookings() {
        assertThat(QueryUnderstanding.parse("my hotels").categories()).containsExactly(HOTELS);
        assertThat(QueryUnderstanding.parse("flights").categories()).containsExactly(BOOKINGS);
        assertThat(QueryUnderstanding.parse("flights").bookingType()).isEqualTo("FLIGHT");
        assertThat(QueryUnderstanding.parse("cancelled hotel").categories()).containsExactly(BOOKINGS);
    }

    @Test
    void citiesWithTwoNamesAreSearchedUnderBoth() {
        assertThat(PlaceNames.alternatives("Banglore")).containsExactly("bengaluru");
        assertThat(PlaceNames.alternatives("Bengaluru hotels")).containsExactly("bangalore hotels");
        assertThat(PlaceNames.alternatives("Madras")).containsExactly("chennai");
        assertThat(PlaceNames.alternatives("Goa")).isEmpty();
    }

    @Test
    void editDistanceCountsASwapAsOneTypo() {
        assertThat(QueryUnderstanding.distance("hotle", "hotel")).isEqualTo(1);
        assertThat(QueryUnderstanding.distance("paymnt", "payment")).isEqualTo(1);
        assertThat(QueryUnderstanding.distance("chennai", "mumbai")).isGreaterThan(2);
    }
}
