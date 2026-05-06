import puppeteer from "puppeteer";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ExportPdfRequest = {
  description?: unknown;
  infrastructure?: unknown;
  risks?: unknown;
  urbanUses?: unknown;
  recommendation?: unknown;
  limitations?: unknown;
  locationLabel?: unknown;
};

type GeospatialReport = {
  description: string;
  infrastructure: string;
  risks: string;
  urbanUses: string;
  recommendation: string;
  limitations: string;
  locationLabel: string;
};

const REQUIRED_FIELDS = [
  "description",
  "infrastructure",
  "risks",
  "urbanUses",
  "recommendation",
  "limitations",
  "locationLabel",
] as const;

function isGeospatialReport(body: ExportPdfRequest): body is GeospatialReport {
  return REQUIRED_FIELDS.every((field) => typeof body[field] === "string");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderParagraph(value: string) {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function renderSection(title: string, content: string) {
  return `
    <section class="section">
      <h2>${escapeHtml(title)}</h2>
      <p>${renderParagraph(content)}</p>
    </section>
  `;
}

function buildReportHtml(report: GeospatialReport) {
  const generatedAt = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Informe geoespacial - ${escapeHtml(report.locationLabel)}</title>
    <style>
      @page {
        size: A4;
        margin: 22mm 18mm;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: #18202f;
        background: #ffffff;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
        line-height: 1.55;
      }

      .report-header {
        border-bottom: 2px solid #23324a;
        padding-bottom: 18px;
        margin-bottom: 22px;
      }

      .kicker {
        margin: 0 0 8px;
        color: #64748b;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        color: #111827;
        font-size: 26px;
        line-height: 1.18;
        font-weight: 800;
      }

      .meta {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-top: 14px;
        color: #475569;
        font-size: 11px;
      }

      .meta strong {
        color: #1f2937;
      }

      .section {
        break-inside: avoid;
        border: 1px solid #d7dde7;
        border-left: 4px solid #2563eb;
        border-radius: 6px;
        padding: 14px 16px;
        margin-bottom: 12px;
        background: #fbfcfe;
      }

      .section h2 {
        margin: 0 0 8px;
        color: #1e293b;
        font-size: 14px;
        line-height: 1.3;
      }

      .section p {
        margin: 0;
        color: #334155;
        white-space: normal;
      }

      .footer {
        margin-top: 22px;
        padding-top: 10px;
        border-top: 1px solid #d7dde7;
        color: #64748b;
        font-size: 10px;
      }
    </style>
  </head>
  <body>
    <header class="report-header">
      <p class="kicker">Informe geoespacial</p>
      <h1>${escapeHtml(report.locationLabel)}</h1>
      <div class="meta">
        <span><strong>Generado:</strong> ${escapeHtml(generatedAt)}</span>
        <span><strong>Formato:</strong> Reporte técnico</span>
      </div>
    </header>

    <main>
      ${renderSection("Descripción del área", report.description)}
      ${renderSection("Infraestructura", report.infrastructure)}
      ${renderSection("Riesgos", report.risks)}
      ${renderSection("Usos urbanos", report.urbanUses)}
      ${renderSection("Recomendación", report.recommendation)}
      ${renderSection("Limitaciones", report.limitations)}
    </main>

    <footer class="footer">
      Este documento se ha generado automáticamente a partir del informe geoespacial recibido por la API.
    </footer>
  </body>
</html>`;
}

export async function POST(request: Request) {
  let body: ExportPdfRequest;

  try {
    body = (await request.json()) as ExportPdfRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (!isGeospatialReport(body)) {
    return NextResponse.json(
      { error: "Missing or invalid report fields." },
      { status: 400 },
    );
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setContent(buildReportHtml(body), {
      waitUntil: "networkidle0",
    });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    const pdfBody = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(pdfBody).set(pdf);

    return new Response(pdfBody, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="informe.pdf"',
        "Content-Length": String(pdf.byteLength),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected PDF export error.",
      },
      { status: 500 },
    );
  } finally {
    await browser?.close();
  }
}
