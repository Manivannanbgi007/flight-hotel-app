package com.flighthotel.search.index;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import com.flighthotel.search.config.SearchProperties;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.ElasticsearchException;

/**
 * The search service's own index, reached through an alias.
 * <ul>
 *   <li>Every read and write uses the alias ({@code global-search}). It points to a versioned index
 *       ({@code global-search-v1}) created with {@code search/index-mapping.json}.</li>
 *   <li>When the mapping changes, bump {@link #MAPPING_VERSION}: on the next start a new index
 *       ({@code global-search-v2}) is created, the documents are copied into it with Elasticsearch's {@code _reindex},
 *       and the alias moves over in one atomic step. The old index is kept (delete it by hand once happy).</li>
 * </ul>
 */
@Component
public class SearchIndex {

    /** Bump together with {@code _meta.mappingVersion} in index-mapping.json whenever the mapping changes. */
    public static final int MAPPING_VERSION = 2;
    private static final Logger log = LoggerFactory.getLogger(SearchIndex.class);

    private final ElasticsearchClient elasticsearch;
    private final SearchProperties properties;
    private volatile boolean ready;

    public SearchIndex(ElasticsearchClient elasticsearch, SearchProperties properties) {
        this.elasticsearch = elasticsearch;
        this.properties = properties;
    }

    /** The alias to search and write. */
    public String alias() {
        return properties.indexAlias();
    }

    /** The index the alias should point to with the current mapping. */
    public String currentIndexName() {
        return alias() + "-v" + MAPPING_VERSION;
    }

    /**
     * Makes sure the alias points to an index with the current mapping, creating or migrating it if needed. Cheap after
     * the first success; safe to call before every write.
     */
    public void ensureReady() {
        if (ready) {
            return;
        }
        synchronized (this) {
            if (ready) {
                return;
            }
            try {
                prepare();
                ready = true;
            } catch (IOException ex) {
                throw new SearchIndexUnavailableException("Elasticsearch is not reachable", ex);
            } catch (ElasticsearchException ex) {
                if (ex.status() >= 500 || ex.status() == 429) {
                    throw new SearchIndexUnavailableException("Elasticsearch could not prepare the index", ex);
                }
                throw ex;
            }
        }
    }

    private void prepare() throws IOException {
        String target = currentIndexName();
        Set<String> current = elasticsearch.indices().existsAlias(e -> e.name(alias())).value()
                ? elasticsearch.indices().getAlias(g -> g.name(alias())).aliases().keySet()
                : Set.of();
        if (current.contains(target)) {
            return;
        }
        create(target);
        if (current.isEmpty()) {
            elasticsearch.indices().updateAliases(u -> u.actions(a -> a.add(add -> add.index(target).alias(alias()))));
            log.info("Created search index {} behind alias {}", target, alias());
            return;
        }
        // An older mapping version: copy everything over, then switch the alias in one atomic step.
        String old = current.iterator().next();
        log.warn("Search index {} has an older mapping; copying it into {}", old, target);
        elasticsearch.reindex(r -> r.source(s -> s.index(old)).dest(d -> d.index(target)).refresh(true)
                .waitForCompletion(true));
        elasticsearch.indices().updateAliases(u -> u
                .actions(a -> a.remove(remove -> remove.index(old).alias(alias())))
                .actions(a -> a.add(add -> add.index(target).alias(alias()))));
        log.info("Alias {} now points to {} ({} kept; delete it once the new index is fine)", alias(), target, old);
    }

    private void create(String name) throws IOException {
        if (elasticsearch.indices().exists(e -> e.index(name)).value()) {
            return;
        }
        try {
            elasticsearch.indices().create(c -> c.index(name).withJson(new StringReader(mapping())));
        } catch (ElasticsearchException ex) {
            // Another instance created it at the same moment: fine.
            if (!"resource_already_exists_exception".equals(ex.error().type())) {
                throw ex;
            }
        }
    }

    private static String mapping() {
        try (InputStream in = new ClassPathResource("search/index-mapping.json").getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException ex) {
            throw new UncheckedIOException("search/index-mapping.json is missing", ex);
        }
    }
}
