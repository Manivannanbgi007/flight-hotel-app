package com.flighthotel.notification.document;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Locale;

import org.springframework.stereotype.Component;
import org.thymeleaf.ITemplateEngine;
import org.thymeleaf.context.Context;

import com.flighthotel.common.settings.SystemSettings;
import com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;

/**
 * Renders a {@link PdfDocument} to PDF: Thymeleaf fills the one XHTML layout, OpenHTMLtoPDF lays it out on A4. Inter,
 * the web app's font, is embedded (regular and bold; it has the rupee sign, which the PDF standard fonts do not), so
 * the file looks like the app and the same everywhere. Fonts: SIL Open Font License, {@code resources/fonts/OFL.txt}.
 */
@Component
public class PdfRenderer {

    static final String TEMPLATE = "pdf/document";
    private static final String FONT = "Inter";

    private final ITemplateEngine templates;
    private final SystemSettings settings;

    public PdfRenderer(ITemplateEngine templates, SystemSettings settings) {
        this.templates = templates;
        this.settings = settings;
    }

    public byte[] render(PdfDocument document) {
        Context context = new Context(Locale.ENGLISH);
        context.setVariable("doc", document);
        context.setVariable("siteName", settings.getString("site.name", "FlightHotel"));
        context.setVariable("supportEmail", settings.getString("support.email", "support@flighthotel.local"));
        String html = templates.process(TEMPLATE, context);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFont(() -> font("Inter-Regular.ttf"), FONT, 400, FontStyle.NORMAL, true);
            builder.useFont(() -> font("Inter-Bold.ttf"), FONT, 700, FontStyle.NORMAL, true);
            builder.withHtmlContent(html, null);
            builder.withProducer(settings.getString("site.name", "FlightHotel"));
            builder.toStream(out);
            builder.run();
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not render the PDF " + document.title(), ex);
        }
        return out.toByteArray();
    }

    private static java.io.InputStream font(String file) {
        java.io.InputStream stream = PdfRenderer.class.getResourceAsStream("/fonts/" + file);
        if (stream == null) {
            throw new IllegalStateException("Font missing from the classpath: " + file);
        }
        return stream;
    }
}
