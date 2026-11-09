package com.flighthotel.search.query;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.kafka.listener.ListenerExecutionFailedException;
import org.springframework.util.backoff.BackOffExecution;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.search.config.SearchKafkaConfigAccess;
import com.flighthotel.search.config.SearchProperties;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.index.SearchCategory;
import com.flighthotel.search.index.SearchIndex;
import com.flighthotel.search.index.SearchIndexUnavailableException;
import com.flighthotel.search.web.SearchDtos.TextSegment;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import tools.jackson.databind.json.JsonMapper;

/** What happens when Elasticsearch is down, and how highlights are turned into safe text. */
class SearchFailuresTest {

    private final SearchProperties properties = new SearchProperties("global-search", "hotels", Duration.ofSeconds(2),
            "http://hotels", Duration.ofSeconds(60), "http://flights", Duration.ofMinutes(10));

    @Test
    @SuppressWarnings("unchecked")
    void searchesAnswerServiceUnavailableWhenElasticsearchIsDown() throws Exception {
        ElasticsearchClient elasticsearch = mock(ElasticsearchClient.class);
        when(elasticsearch.search(any(Function.class), eq(Map.class))).thenThrow(new IOException("Connection refused"));
        SearchService service = new SearchService(elasticsearch, mock(SearchIndex.class), properties,
                JsonMapper.builder().build());

        assertThatThrownBy(() -> service.search("chennai", null, 0, 10, Viewer.anonymous()))
                .isInstanceOfSatisfying(ApiException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                    assertThat(ex.getCode()).isEqualTo("SEARCH_UNAVAILABLE");
                    // Elasticsearch's own error text never reaches the user.
                    assertThat(ex.getMessage()).doesNotContain("Connection refused");
                });
        assertThatThrownBy(() -> service.suggest("chennai", Viewer.anonymous())).isInstanceOf(ApiException.class);
    }

    @Test
    @SuppressWarnings("unchecked")
    void indexWritesWaitForElasticsearchInsteadOfLosingTheEvent() throws Exception {
        ElasticsearchClient elasticsearch = mock(ElasticsearchClient.class);
        when(elasticsearch.update(any(Function.class), eq(Map.class))).thenThrow(new IOException("Connection refused"));
        IndexWriter writer = new IndexWriter(elasticsearch, mock(SearchIndex.class), JsonMapper.builder().build());

        assertThatThrownBy(() -> writer.merge(SearchCategory.BOOKINGS, "b-1",
                IndexWriter.Merge.of(Fields.partial().put("names", List.of("Aarav Mehta")))))
                .isInstanceOf(SearchIndexUnavailableException.class);

        // The Kafka error handler recognises it and keeps retrying, at most 30 seconds apart, without giving up.
        SearchIndexUnavailableException down = new SearchIndexUnavailableException("down", new IOException());
        assertThat(SearchKafkaConfigAccess.causedByUnavailableIndex(
                new ListenerExecutionFailedException("listener failed", down))).isTrue();
        assertThat(SearchKafkaConfigAccess.causedByUnavailableIndex(new IllegalArgumentException("bad document")))
                .isFalse();
        BackOffExecution backOff = SearchKafkaConfigAccess.untilElasticsearchIsBack().start();
        long last = 0;
        for (int i = 0; i < 50; i++) {
            last = backOff.nextBackOff();
        }
        assertThat(last).isEqualTo(30_000);
    }

    @Test
    void highlightsBecomePlainTextSegments() {
        List<TextSegment> segments = Highlights.segments("\u0001Chen\u0002nai <b>Grand</b>");
        assertThat(segments).containsExactly(new TextSegment("Chen", true), new TextSegment("nai <b>Grand</b>", false));
        assertThat(Highlights.plain(segments)).isEqualTo("Chennai <b>Grand</b>");
        assertThat(Highlights.segments("no match")).containsExactly(new TextSegment("no match", false));
    }
}
