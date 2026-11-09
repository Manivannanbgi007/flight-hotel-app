package com.flighthotel.search.sync;

import static com.flighthotel.search.index.SearchCategory.PAGES;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.support.Format;

import tools.jackson.databind.json.JsonMapper;

/**
 * The application's pages (search/pages.json) → PAGES documents, so "payments", "Paymnt" or "change password" find the
 * right screen. Rebuilt at start-up; a page removed from the file is removed from the index.
 */
@Component
public class PagesIndexer {

    private static final Logger log = LoggerFactory.getLogger(PagesIndexer.class);

    private final IndexWriter writer;
    private final JsonMapper json;
    private volatile boolean built;

    public PagesIndexer(IndexWriter writer, JsonMapper json) {
        this.writer = writer;
        this.json = json;
    }

    /** One page: who may see it ({@code audience}, optional {@code permission}) and where it is ({@code url}). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Page(String id, String title, String description, List<String> keywords, String url,
            List<String> audience, String permission, boolean perHotel) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Catalogue(List<Page> pages) {
    }

    /** Builds the pages once (retried by the reference data job until it worked). */
    public void rebuildIfNeeded() {
        if (!built) {
            rebuild();
        }
    }

    public int rebuild() {
        List<Page> pages = load();
        List<Fields> documents = pages.stream().map(page -> Fields.of(PAGES, page.id())
                .put("title", page.title())
                .put("subtitle", page.description())
                .put("keywords", page.keywords())
                .put("audience", page.audience())
                .put("permission", page.permission())
                .put("perHotel", page.perHotel())
                .put("display", Format.map("url", page.url())))
                .toList();
        writer.indexAll(PAGES, documents);
        writer.deleteAllExcept(PAGES, pages.stream().map(Page::id).toList());
        built = true;
        log.info("Search pages indexed: {}", pages.size());
        return pages.size();
    }

    public List<Page> load() {
        try (InputStream in = new ClassPathResource("search/pages.json").getInputStream()) {
            return json.readValue(in, Catalogue.class).pages();
        } catch (IOException ex) {
            throw new UncheckedIOException("search/pages.json cannot be read", ex);
        }
    }
}
