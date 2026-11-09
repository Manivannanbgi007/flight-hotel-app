package com.flighthotel.search;

import static com.flighthotel.search.SearchFixtures.AARAV;
import static com.flighthotel.search.SearchFixtures.ADMIN;
import static com.flighthotel.search.SearchFixtures.B1;
import static com.flighthotel.search.SearchFixtures.B2;
import static com.flighthotel.search.SearchFixtures.B3;
import static com.flighthotel.search.SearchFixtures.H1;
import static com.flighthotel.search.SearchFixtures.H3;
import static com.flighthotel.search.SearchFixtures.P1;
import static com.flighthotel.search.SearchFixtures.P2;
import static com.flighthotel.search.SearchFixtures.PRIYA;
import static com.flighthotel.search.SearchFixtures.R1;
import static com.flighthotel.search.SearchFixtures.R2;
import static com.flighthotel.search.SearchFixtures.REF_B1;
import static com.flighthotel.search.SearchFixtures.REF_B2;
import static com.flighthotel.search.SearchFixtures.REF_B3;
import static com.flighthotel.search.SearchFixtures.ROHAN;
import static com.flighthotel.search.SearchFixtures.RR2;
import static com.flighthotel.search.SearchFixtures.RV1;
import static com.flighthotel.search.SearchFixtures.RV3;
import static com.flighthotel.search.SearchFixtures.T0;
import static com.flighthotel.search.SearchFixtures.T1;
import static com.flighthotel.search.SearchFixtures.VIKRAM;
import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.DESTINATIONS;
import static com.flighthotel.search.index.SearchCategory.HOTELS;
import static com.flighthotel.search.index.SearchCategory.PAGES;
import static com.flighthotel.search.index.SearchCategory.PAYMENTS;
import static com.flighthotel.search.index.SearchCategory.REFUNDS;
import static com.flighthotel.search.index.SearchCategory.REVIEWS;
import static com.flighthotel.search.index.SearchCategory.TICKETS;
import static com.flighthotel.search.index.SearchCategory.USERS;
import static com.flighthotel.testsupport.RoleTokens.as;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.index.SearchCategory;
import com.flighthotel.search.query.ManagedHotelsClient;
import com.flighthotel.search.query.Viewer.ManagedHotel;
import com.flighthotel.search.sync.BookingEventsListener;
import com.flighthotel.search.sync.DestinationsIndexer;
import com.flighthotel.search.sync.HotelEventsListener;
import com.flighthotel.search.sync.IdentityEventsListener;
import com.flighthotel.search.sync.PagesIndexer;
import com.flighthotel.search.sync.PaymentEventsListener;
import com.flighthotel.search.sync.SupportEventsListener;
import com.flighthotel.search.web.SearchDtos.ResultGroup;
import com.flighthotel.search.web.SearchDtos.SearchResponse;
import com.flighthotel.search.web.SearchDtos.SearchResult;
import com.flighthotel.search.web.SearchDtos.SuggestResponse;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import tools.jackson.databind.json.JsonMapper;

/**
 * Global search end to end against a real Elasticsearch: events go through the real listeners, searches through the
 * real API with real tokens. Covers relevance (exact, fuzzy, prefix, partial, ranking), the understood words, paging,
 * validation, every role's data isolation, links, and the sync rules (duplicates, order, updates, deletes).
 */
class GlobalSearchIntegrationTest extends ElasticsearchTestBase {

    private static boolean seeded;

    @Autowired MockMvc mockMvc;
    @Autowired JsonMapper json;
    @Autowired ElasticsearchClient elasticsearch;
    @Autowired IndexWriter writer;
    @Autowired IdentityEventsListener identity;
    @Autowired BookingEventsListener bookings;
    @Autowired HotelEventsListener hotels;
    @Autowired PaymentEventsListener payments;
    @Autowired SupportEventsListener support;
    @Autowired PagesIndexer pages;
    @MockitoSpyBean DestinationsIndexer destinations;
    @MockitoBean ManagedHotelsClient managedHotels;

    /** The customer of the sync tests (their records never show up in the other tests). */
    private static final UUID SOMEONE = UUID.fromString("00000000-0000-4000-8000-0000000000e1");

    private final RequestPostProcessor anonymous = request -> request;
    private final RequestPostProcessor aarav = as(AARAV, "CUSTOMER");
    private final RequestPostProcessor priya = as(PRIYA, "CUSTOMER");
    private final RequestPostProcessor rohan = as(ROHAN, "HOTEL_MANAGER");
    private final RequestPostProcessor vikram = as(VIKRAM, "SUPPORT_AGENT");
    private final RequestPostProcessor admin = as(ADMIN, "ADMIN");

    @BeforeEach
    void seed() throws Exception {
        when(managedHotels.hotelsOf(eq(ROHAN.toString()), any())).thenReturn(
                List.of(new ManagedHotel(H1, "Chennai Grand Hotel", "Chennai")));
        doReturn(List.of(Map.of("iataCode", "MAA", "name", "Chennai International Airport", "city", "Chennai",
                "countryCode", "IN"))).when(destinations).airports();
        if (seeded) {
            return;
        }
        SearchFixtures.createHotelsIndex(elasticsearch);
        identity.handle(SearchFixtures.user(AARAV, "aarav@example.com", "Aarav", "Mehta", "CUSTOMER"));
        identity.handle(SearchFixtures.user(PRIYA, "priya@example.com", "Priya", "Nair", "CUSTOMER"));
        identity.handle(SearchFixtures.user(ROHAN, "rohan@example.com", "Rohan", "Iyer", "HOTEL_MANAGER"));
        LocalDate in30 = LocalDate.now().plusDays(30);
        bookings.handle(SearchFixtures.booking(B1, REF_B1, AARAV, "HOTEL", "CONFIRMED", "Chennai Grand Hotel",
                "Chennai", H1, in30, in30.plusDays(2), T0.plusSeconds(60)));
        bookings.handle(SearchFixtures.booking(B2, REF_B2, PRIYA, "HOTEL", "CANCELLED", "Bangalore Palace Inn",
                "Bangalore", H3, in30, in30.plusDays(1), T0.plusSeconds(60)));
        bookings.handle(SearchFixtures.booking(B3, REF_B3, AARAV, "FLIGHT", "CONFIRMED", "Chennai to Mumbai",
                "Mumbai", null, LocalDate.now().plusDays(10), null, T0.plusSeconds(60)));
        hotels.handle(SearchFixtures.held(B1, R1, H1, "Chennai Grand Hotel", "Chennai"));
        hotels.handle(SearchFixtures.held(B2, R2, H3, "Bangalore Palace Inn", "Bangalore"));
        bookings.handle(SearchFixtures.confirmed(B1, REF_B1, AARAV, "Aarav Mehta"));
        payments.handle(SearchFixtures.paid(P1, B1, AARAV));
        payments.handle(SearchFixtures.failed(P2, B2, PRIYA));
        bookings.handle(SearchFixtures.refundRequested(RR2, B2, REF_B2, PRIYA));
        support.handle(SearchFixtures.ticket(T1, "TKT-1001", AARAV, "Refund not received for my Chennai stay", "OPEN"));
        hotels.handle(SearchFixtures.review(RV1, H1, "Chennai Grand Hotel", B1, REF_B1, AARAV, "Aarav M",
                "Wonderful seaside stay", "APPROVED"));
        hotels.handle(SearchFixtures.review(RV3, H3, "Bangalore Palace Inn", B2, REF_B2, PRIYA, "Priya N",
                "Average breakfast", "PENDING"));
        pages.rebuild();
        destinations.rebuild();
        writer.refresh();
        seeded = true;
    }

    // ----- relevance -----

    @Test
    void anExactBookingReferenceFindsTheBookingAndItsPaymentFirst() throws Exception {
        SearchResponse response = search(REF_B1, admin);

        assertThat(items(response, BOOKINGS)).first().satisfies(result -> {
            assertThat(result.id()).isEqualTo("BOOKINGS:" + B1);
            assertThat(result.url()).isEqualTo("/admin/bookings/" + B1);
            assertThat(result.status().label()).isEqualTo("Confirmed");
        });
        // The payment carries the reference copied from its booking.
        assertThat(items(response, PAYMENTS)).extracting(SearchResult::url).containsExactly("/admin/payments/" + P1);
    }

    @Test
    void aTypoStillFindsTheCityItsHotelsAndTheDestination() throws Exception {
        SearchResponse response = search("Chenai", anonymous);

        assertThat(items(response, HOTELS)).extracting(SearchResult::title)
                .contains("Chennai Grand Hotel", "Chennai Business Suites").doesNotContain("Bangalore Palace Inn");
        assertThat(items(response, DESTINATIONS)).extracting(SearchResult::title).contains("Chennai");
        assertThat(search("Banglore", anonymous).groups()).anySatisfy(group -> assertThat(group.items())
                .extracting(SearchResult::title).contains("Bangalore Palace Inn"));
        // The city's other name finds it too.
        assertThat(items(search("Bengaluru", anonymous), HOTELS)).extracting(SearchResult::title)
                .containsExactly("Bangalore Palace Inn");
    }

    @Test
    void suggestionsAppearWhileTypingWithTheMatchHighlighted() throws Exception {
        SuggestResponse response = suggest("Che", anonymous);

        ResultGroup hotelGroup = response.groups().stream().filter(group -> group.category() == HOTELS).findFirst()
                .orElseThrow();
        assertThat(hotelGroup.items()).extracting(SearchResult::title).allMatch(title -> title.startsWith("Chennai"));
        assertThat(hotelGroup.items().getFirst().highlight().title()).anySatisfy(segment -> {
            assertThat(segment.match()).isTrue();
            assertThat(segment.text()).startsWith("Chennai");
        });
        assertThat(hotelGroup.items()).hasSizeLessThanOrEqualTo(4);
    }

    @Test
    void aPartOfTheNameFindsTheHotelAndTheExactNameRanksFirst() throws Exception {
        assertThat(items(search("Grand", aarav), HOTELS)).first().extracting(SearchResult::title)
                .isEqualTo("Chennai Grand Hotel");
        assertThat(items(search("Chennai Business Suites", aarav), HOTELS)).first().extracting(SearchResult::title)
                .isEqualTo("Chennai Business Suites");
        // Unrelated records do not show up because they share a few letters.
        assertThat(items(search("Chennai Business Suites", aarav), HOTELS)).extracting(SearchResult::title)
                .doesNotContain("Mumbai Sea View Hotel", "Bangalore Palace Inn");
    }

    @Test
    void wordsAreUnderstoodAsFilters() throws Exception {
        SearchResponse cancelled = search("cancelled bookings", admin);
        assertThat(cancelled.interpretation()).isEqualTo("Cancelled bookings");
        assertThat(items(cancelled, BOOKINGS)).extracting(SearchResult::id).containsExactly("BOOKINGS:" + B2);

        SearchResponse upcoming = search("my upcoming trips", aarav);
        assertThat(items(upcoming, BOOKINGS)).extracting(SearchResult::id)
                .containsExactly("BOOKINGS:" + B3, "BOOKINGS:" + B1); // soonest first

        SearchResponse flights = search("Flights to Chennai", aarav);
        assertThat(items(flights, DESTINATIONS)).first().satisfies(destination -> {
            assertThat(destination.url()).isEqualTo("/flights/search?destination=MAA");
            assertThat(destination.actions()).extracting(a -> a.label())
                    .containsExactly("Hotels in Chennai", "Flights to Chennai");
        });
        assertThat(items(search("Hotels in Chennai", aarav), DESTINATIONS)).first().extracting(SearchResult::url)
                .isEqualTo("/hotels/search?destination=Chennai");
    }

    // ----- results page: categories, paging, empty, invalid -----

    @Test
    void oneCategoryIsPaged() throws Exception {
        SearchResponse first = page("Chennai", "BOOKINGS", 0, 1, admin);
        assertThat(first.results().totalElements()).isEqualTo(2);
        assertThat(first.results().totalPages()).isEqualTo(2);
        assertThat(first.results().content()).hasSize(1);
        assertThat(first.groups()).isEmpty();
        assertThat(first.categories()).extracting(count -> count.category()).containsExactly(USERS, HOTELS,
                DESTINATIONS, BOOKINGS, PAYMENTS, REFUNDS, TICKETS, REVIEWS, PAGES);

        SearchResponse second = page("Chennai", "BOOKINGS", 1, 1, admin);
        assertThat(second.results().content()).hasSize(1);
        assertThat(second.results().content().getFirst().id()).isNotEqualTo(first.results().content().getFirst().id());
        assertThat(page("Chennai", "HOTELS", 0, 10, admin).results().content()).extracting(SearchResult::url)
                .allMatch(url -> url.startsWith("/admin/hotels?q="));
    }

    @Test
    void nothingFoundIsAnEmptyAnswer() throws Exception {
        SearchResponse response = search("zzqxwvk", admin);
        assertThat(response.total()).isZero();
        assertThat(response.groups()).isEmpty();
        assertThat(suggest("zzqxwvk", admin).groups()).isEmpty();
    }

    @Test
    void invalidRequestsAreRefusedWithAReason() throws Exception {
        mockMvc.perform(get("/api/search").param("q", "a").with(admin))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("QUERY_TOO_SHORT"));
        mockMvc.perform(get("/api/search/suggest").param("q", "x".repeat(101)).with(admin))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("QUERY_TOO_LONG"));
        mockMvc.perform(get("/api/search").param("q", "chennai").param("category", "PLANETS").with(admin))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_CATEGORY"));
        mockMvc.perform(get("/api/search").param("q", "chennai").param("size", "51").with(admin))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(get("/api/search").param("q", "aarav").param("category", "USERS").with(aarav))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        // Wildcards and operators are ordinary characters, never an expensive query.
        assertThat(search("**", admin).total()).isZero();
    }

    // ----- who sees what -----

    @Test
    void customersOnlyFindTheirOwnRecords() throws Exception {
        SearchResponse own = search(REF_B1, aarav);
        assertThat(items(own, BOOKINGS)).extracting(SearchResult::url).containsExactly("/my-trips/" + B1);
        assertThat(items(own, PAYMENTS)).extracting(SearchResult::url)
                .containsExactly("/account/payments?q=" + REF_B1);
        assertThat(own.categories()).extracting(count -> count.label()).contains("My trips", "My payments");

        SearchResponse someoneElses = search(REF_B1, priya);
        assertThat(items(someoneElses, BOOKINGS)).isEmpty();
        assertThat(items(someoneElses, PAYMENTS)).isEmpty();
        assertThat(items(someoneElses, TICKETS)).isEmpty();
        assertThat(items(someoneElses, REVIEWS)).isEmpty();
        assertThat(search("Aarav", priya).categories()).extracting(count -> count.category()).doesNotContain(USERS);

        assertThat(items(search("Refund not received", aarav), TICKETS)).extracting(SearchResult::url)
                .containsExactly("/account/support/" + T1);
        assertThat(items(search("seaside", aarav), REVIEWS)).extracting(SearchResult::url)
                .containsExactly("/account/reviews");
    }

    @Test
    void hotelManagersOnlyFindTheirHotelsReservationsAndReviews() throws Exception {
        assertThat(items(search(REF_B1, rohan), BOOKINGS)).extracting(SearchResult::url)
                .containsExactly("/hotel-manager/hotels/" + H1 + "/reservations/" + R1);
        assertThat(items(search(REF_B2, rohan), BOOKINGS)).isEmpty();
        assertThat(items(search("Bangalore", rohan), HOTELS)).isEmpty();
        assertThat(items(search("Chennai", rohan), HOTELS)).extracting(SearchResult::url)
                .containsExactly("/hotel-manager/hotels/" + H1 + "/dashboard");
        assertThat(items(search("reviews", rohan), REVIEWS)).extracting(SearchResult::id)
                .containsExactly("REVIEWS:" + RV1);
        assertThat(items(search("Room inventory", rohan), PAGES)).first().extracting(SearchResult::url)
                .isEqualTo("/hotel-manager/hotels/" + H1 + "/inventory");
        assertThat(search("payments", rohan).categories()).extracting(count -> count.category())
                .containsExactly(HOTELS, BOOKINGS, REVIEWS, PAGES);
    }

    @Test
    void supportAgentsFindCustomersButNotStaff() throws Exception {
        assertThat(items(search("Aarav", vikram), USERS)).extracting(SearchResult::url).singleElement()
                .satisfies(url -> assertThat(url).matches("/support/bookings\\?q=aarav(@|%40)example\\.com"));
        assertThat(items(search("Rohan", vikram), USERS)).isEmpty();
        assertThat(items(search(REF_B2, vikram), REFUNDS)).extracting(SearchResult::url)
                .containsExactly("/support/bookings/" + B2);
        assertThat(items(search("Refund not received", vikram), TICKETS)).extracting(SearchResult::url)
                .containsExactly("/support/tickets/" + T1);
    }

    @Test
    void adminsFindEveryRecordWithTheAdminLinks() throws Exception {
        assertThat(items(search("Rohan", admin), USERS)).extracting(SearchResult::url)
                .containsExactly("/admin/users/" + ROHAN);
        SearchResponse managers = search("hotel managers", admin);
        assertThat(managers.interpretation()).isEqualTo("Hotel managers");
        assertThat(items(managers, USERS)).extracting(SearchResult::title).containsExactly("Rohan Iyer");
        assertThat(items(search("Custmer", admin), USERS)).extracting(SearchResult::title)
                .containsExactlyInAnyOrder("Aarav Mehta", "Priya Nair");
        assertThat(items(search(REF_B2, admin), REFUNDS)).extracting(SearchResult::url)
                .containsExactly("/admin/refunds?q=" + REF_B2);
        assertThat(items(search("Average breakfast", admin), REVIEWS)).extracting(SearchResult::url)
                .containsExactly("/admin/reviews?q=" + REF_B2);
        assertThat(items(search("Paymnt", admin), PAGES)).extracting(SearchResult::url).contains("/admin/payments");
    }

    @Test
    void signedOutVisitorsOnlySeePublicResults() throws Exception {
        SearchResponse response = search(REF_B1, anonymous);
        assertThat(response.groups()).isEmpty();
        assertThat(response.categories()).extracting(count -> count.category())
                .containsExactly(HOTELS, DESTINATIONS, PAGES);
        assertThat(items(search("Paymnt", anonymous), PAGES)).isEmpty();
        assertThat(items(search("Paymnt", aarav), PAGES)).extracting(SearchResult::url).contains("/account/payments");
    }

    // ----- keeping the index in sync -----

    @Test
    void theSameEventTwiceChangesNothing() throws Exception {
        String bookingId = UUID.randomUUID().toString();
        var snapshot = SearchFixtures.booking(bookingId, "HT-DUPL0001", SOMEONE, "HOTEL", "CONFIRMED", "Duplicate Test",
                "Pune", null, LocalDate.now().plusDays(3), LocalDate.now().plusDays(4), T0.plusSeconds(500));
        bookings.handle(snapshot);
        bookings.handle(snapshot);
        writer.refresh();

        Map<String, Object> stored = writer.find(BOOKINGS, bookingId).orElseThrow();
        assertThat(stored).containsEntry("status", "CONFIRMED").containsEntry("reference", "HT-DUPL0001");
        assertThat(page("HT-DUPL0001", "BOOKINGS", 0, 10, admin).results().totalElements()).isEqualTo(1);
    }

    @Test
    void anOlderStateArrivingLateNeverUndoesANewerOne() throws Exception {
        String bookingId = UUID.randomUUID().toString();
        LocalDate start = LocalDate.now().plusDays(5);
        bookings.handle(SearchFixtures.booking(bookingId, "HT-ORDR0001", SOMEONE, "HOTEL", "CANCELLED", "Order Test",
                "Pune", null, start, start.plusDays(1), T0.plusSeconds(900)));
        bookings.handle(SearchFixtures.booking(bookingId, "HT-ORDR0001", SOMEONE, "HOTEL", "CONFIRMED", "Order Test",
                "Pune", null, start, start.plusDays(1), T0.plusSeconds(800)));

        assertThat(writer.find(BOOKINGS, bookingId).orElseThrow()).containsEntry("status", "CANCELLED");

        // A newer state does update it.
        bookings.handle(SearchFixtures.booking(bookingId, "HT-ORDR0001", SOMEONE, "HOTEL", "COMPLETED", "Order Test",
                "Pune", null, start, start.plusDays(1), T0.plusSeconds(1000)));
        assertThat(writer.find(BOOKINGS, bookingId).orElseThrow()).containsEntry("status", "COMPLETED");
    }

    @Test
    void aPaymentIndexedBeforeItsBookingGetsTheReferenceLater() throws Exception {
        String bookingId = UUID.randomUUID().toString();
        String paymentId = UUID.randomUUID().toString();
        payments.handle(SearchFixtures.paid(paymentId, bookingId, SOMEONE));
        assertThat(writer.find(PAYMENTS, paymentId).orElseThrow()).doesNotContainKey("reference");

        bookings.handle(SearchFixtures.booking(bookingId, "HT-LATE0001", SOMEONE, "HOTEL", "CONFIRMED", "Late Booking",
                "Pune", null, LocalDate.now().plusDays(3), LocalDate.now().plusDays(4), T0.plusSeconds(600)));
        writer.refresh();

        assertThat(writer.find(PAYMENTS, paymentId).orElseThrow()).containsEntry("reference", "HT-LATE0001")
                .containsEntry("title", "Payment for HT-LATE0001");
        assertThat(items(search("HT-LATE0001", admin), PAYMENTS)).hasSize(1);
    }

    @Test
    void aLateFailureNeverHidesASuccessfulPayment() throws Exception {
        String paymentId = UUID.randomUUID().toString();
        String bookingId = UUID.randomUUID().toString();
        payments.handle(SearchFixtures.paid(paymentId, bookingId, SOMEONE));
        payments.handle(SearchFixtures.failed(paymentId, bookingId, SOMEONE));
        assertThat(writer.find(PAYMENTS, paymentId).orElseThrow()).containsEntry("status", "SUCCEEDED");
    }

    @Test
    void removedHotelsAndPagesDisappearFromTheIndex() throws Exception {
        String goa = "10000000-0000-4000-8000-000000000009";
        SearchFixtures.hotel(elasticsearch, goa, "goa-beach-resort", "Goa Beach Resort", "Goa", "Goa", 4, 4.0);
        destinations.rebuild();
        writer.refresh();
        assertThat(items(search("Goa", anonymous), DESTINATIONS)).extracting(SearchResult::title).contains("Goa");

        elasticsearch.delete(d -> d.index("hotels").id(goa).refresh(co.elastic.clients.elasticsearch._types.Refresh.True));
        destinations.rebuild();
        writer.refresh();
        assertThat(items(search("Goa", anonymous), DESTINATIONS)).isEmpty();
        assertThat(items(search("Goa", anonymous), HOTELS)).isEmpty();

        // The pages come from search/pages.json: rebuilding keeps exactly that list.
        assertThat(pages.rebuild()).isEqualTo(pages.load().size());
    }

    // ----- helpers -----

    private SearchResponse search(String query, RequestPostProcessor who) throws Exception {
        String body = mockMvc.perform(get("/api/search").param("q", query).with(who))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readValue(body, SearchResponse.class);
    }

    private SearchResponse page(String query, String category, int page, int size, RequestPostProcessor who)
            throws Exception {
        String body = mockMvc.perform(get("/api/search").param("q", query).param("category", category)
                        .param("page", String.valueOf(page)).param("size", String.valueOf(size)).with(who))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readValue(body, SearchResponse.class);
    }

    private SuggestResponse suggest(String query, RequestPostProcessor who) throws Exception {
        String body = mockMvc.perform(get("/api/search/suggest").param("q", query).with(who))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readValue(body, SuggestResponse.class);
    }

    private static List<SearchResult> items(SearchResponse response, SearchCategory category) {
        return response.groups().stream().filter(group -> group.category() == category).findFirst()
                .map(ResultGroup::items).orElse(List.of());
    }
}
