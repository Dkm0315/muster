type Row = Record<string, unknown>;

type ArtifactResult = {
  filename: string;
  mimeType: string;
  format: "docx" | "xlsx" | "pptx" | "pdf";
  bytes: number;
  base64: string;
};

type Section = {
  heading: string;
  content: string;
};

type Slide = {
  title: string;
  bullets: string[];
  notes?: string;
};

type WorkflowStep = {
  id: string;
  action: string;
  tool?: string;
  risk: "safe" | "review" | "approval";
  inputFrom?: string;
  gate?: string;
  output: string;
};

type VerificationCheck = {
  id: string;
  status: "passed" | "failed";
  summary: string;
};

const textEncoder = new TextEncoder();
let crcTable: Uint32Array | undefined;

function stringArg(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function rowsArg(args: Record<string, unknown>): Row[] {
  return Array.isArray(args.rows) ? args.rows.filter((row): row is Row => typeof row === "object" && row !== null && !Array.isArray(row)) : [];
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pdfEscape(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function fileNameArg(args: Record<string, unknown>, fallback: string, ext: string): string {
  const raw = stringArg(args, "filename", fallback).trim() || fallback;
  const safe = raw.replace(/[\\/:"*?<>|]+/g, "-").replace(/\s+/g, " ").trim() || fallback;
  return safe.toLowerCase().endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
}

function sectionsArg(args: Record<string, unknown>): Section[] {
  const raw = Array.isArray(args.sections) ? args.sections : [];
  return raw.flatMap((section): Section[] => {
    if (typeof section === "string") return [{ heading: "Section", content: section }];
    if (typeof section === "object" && section !== null) {
      const record = section as Record<string, unknown>;
      return [{
        heading: typeof record.heading === "string" && record.heading.trim() ? record.heading.trim() : "Section",
        content: typeof record.content === "string" ? record.content : "",
      }];
    }
    return [];
  });
}

function slidesArg(args: Record<string, unknown>): Slide[] {
  const raw = Array.isArray(args.slides) ? args.slides : [];
  return raw.flatMap((slide, index): Slide[] => {
    if (typeof slide === "string") return [{ title: `Slide ${index + 1}`, bullets: [slide] }];
    if (typeof slide === "object" && slide !== null) {
      const record = slide as Record<string, unknown>;
      const bullets = Array.isArray(record.bullets)
        ? record.bullets.map((item) => String(item)).filter(Boolean)
        : typeof record.content === "string"
          ? record.content.split(/\n+/).map((item) => item.trim()).filter(Boolean)
          : [];
      return [{
        title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : `Slide ${index + 1}`,
        bullets,
        notes: typeof record.notes === "string" ? record.notes : undefined,
      }];
    }
    return [];
  });
}

function artifactResult(filename: string, mimeType: string, format: ArtifactResult["format"], bytes: Uint8Array): ArtifactResult {
  return { filename, mimeType, format, bytes: bytes.length, base64: Buffer.from(bytes).toString("base64") };
}

function artifactBytesArg(args: Record<string, unknown>): Uint8Array {
  if (typeof args.base64 === "string" && args.base64.trim()) return Buffer.from(args.base64, "base64");
  if (typeof args.text === "string") return encode(args.text);
  return new Uint8Array();
}

function artifactFormatArg(args: Record<string, unknown>): ArtifactResult["format"] | undefined {
  const value = stringArg(args, "format").toLowerCase();
  return value === "docx" || value === "xlsx" || value === "pptx" || value === "pdf" ? value : undefined;
}

function hasZipHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function bytesText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function formatRequiredParts(format: ArtifactResult["format"]): readonly string[] {
  if (format === "docx") return ["[Content_Types].xml", "word/document.xml"];
  if (format === "xlsx") return ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"];
  if (format === "pptx") return ["[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide1.xml"];
  return [];
}

function formatMime(format: ArtifactResult["format"]): string {
  if (format === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (format === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (format === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/pdf";
}

function verifyArtifactBytes(format: ArtifactResult["format"], bytes: Uint8Array, options: { readonly requiredText?: readonly string[] } = {}): VerificationCheck[] {
  const text = bytesText(bytes);
  const checks: VerificationCheck[] = [];
  checks.push({
    id: "non_empty",
    status: bytes.length > 0 ? "passed" : "failed",
    summary: bytes.length > 0 ? `${bytes.length} bytes present` : "artifact payload is empty",
  });
  if (format === "pdf") {
    checks.push({
      id: "pdf_header",
      status: text.startsWith("%PDF-") ? "passed" : "failed",
      summary: text.startsWith("%PDF-") ? "PDF header detected" : "missing %PDF header",
    });
    checks.push({
      id: "pdf_trailer",
      status: /%%EOF\s*$/.test(text) ? "passed" : "failed",
      summary: /%%EOF\s*$/.test(text) ? "PDF EOF trailer detected" : "missing PDF EOF trailer",
    });
  } else {
    checks.push({
      id: "zip_header",
      status: hasZipHeader(bytes) ? "passed" : "failed",
      summary: hasZipHeader(bytes) ? "OOXML ZIP header detected" : "missing OOXML ZIP header",
    });
    for (const part of formatRequiredParts(format)) {
      checks.push({
        id: `part:${part}`,
        status: text.includes(part) ? "passed" : "failed",
        summary: text.includes(part) ? `required package part ${part} is present` : `required package part ${part} is missing`,
      });
    }
  }
  for (const needle of options.requiredText ?? []) {
    checks.push({
      id: `content:${needle.slice(0, 32).replace(/\s+/g, "_")}`,
      status: text.includes(needle) ? "passed" : "failed",
      summary: text.includes(needle) ? `required content appears: ${needle}` : `required content missing: ${needle}`,
    });
  }
  return checks;
}

function verificationStatus(checks: readonly VerificationCheck[]): "passed" | "failed" {
  return checks.every((check) => check.status === "passed") ? "passed" : "failed";
}

function encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries: Array<{ name: string; data: string | Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encode(entry.name);
    const data = typeof entry.data === "string" ? encode(entry.data) : entry.data;
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc),
      u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    locals.push(local);
    central.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc),
      u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const centralDir = concatBytes(central);
  return concatBytes([
    ...locals,
    centralDir,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralDir.length), u32(offset), u16(0),
  ]);
}

function docxParagraph(text: string, style?: string): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

export async function rows_to_csv(args: Record<string, unknown>): Promise<{ csv: string; rows: number; columns: string[] }> {
  const rows = rowsArg(args);
  const columns = Array.isArray(args.columns) && args.columns.every((column) => typeof column === "string")
    ? args.columns as string[]
    : [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  return { csv, rows: rows.length, columns };
}

export async function markdown_report(args: Record<string, unknown>): Promise<{ markdown: string }> {
  const title = stringArg(args, "title", "Report").trim() || "Report";
  const summary = stringArg(args, "summary").trim();
  const sections = sectionsArg(args);
  const body = [`# ${title}`];
  if (summary) body.push("", summary);
  for (const section of sections) body.push("", `## ${section.heading}`, "", section.content);
  return { markdown: `${body.join("\n").trim()}\n` };
}

export async function dashboard_manifest(args: Record<string, unknown>): Promise<{ manifest: Record<string, unknown> }> {
  const title = stringArg(args, "title", "Dashboard").trim() || "Dashboard";
  const rows = rowsArg(args);
  const datasetId = stringArg(args, "datasetId", "dataset").replace(/[^a-zA-Z0-9_-]/g, "_") || "dataset";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    manifest: {
      title,
      blocks: [
        { type: "markdown", body: `# ${title}` },
        { type: "table", title: datasetId, dataset: datasetId, columns },
      ],
      snapshot: { datasets: { [datasetId]: rows.slice(0, 2000) } },
    },
  };
}

export async function docx_document(args: Record<string, unknown>): Promise<ArtifactResult> {
  const title = stringArg(args, "title", "Document").trim() || "Document";
  const summary = stringArg(args, "summary").trim();
  const sections = sectionsArg(args);
  const filename = fileNameArg(args, "muster-document", "docx");
  const body = [
    docxParagraph(title, "Title"),
    summary ? docxParagraph(summary) : "",
    ...sections.flatMap((section) => [docxParagraph(section.heading, "Heading1"), docxParagraph(section.content)]),
  ].join("");
  const bytes = zipStored([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>` },
    { name: "word/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>` },
  ]);
  return artifactResult(filename, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", bytes);
}

function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export async function xlsx_workbook(args: Record<string, unknown>): Promise<ArtifactResult> {
  const rows = rowsArg(args);
  const columns = Array.isArray(args.columns) && args.columns.every((column) => typeof column === "string")
    ? args.columns as string[]
    : [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const sheetName = stringArg(args, "sheetName", "Sheet1").replace(/[\[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Sheet1";
  const filename = fileNameArg(args, "muster-workbook", "xlsx");
  const allRows = [columns, ...rows.map((row) => columns.map((column) => row[column]))];
  const sheetData = allRows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${columnName(c)}${r + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  const bytes = zipStored([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>` },
  ]);
  return artifactResult(filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", bytes);
}

function slideXml(slide: Slide): string {
  const bullets = slide.bullets.length ? slide.bullets : [""];
  const bodyRuns = bullets.map((bullet) => `<a:p><a:r><a:t>${xmlEscape(bullet)}</a:t></a:r></a:p>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="3600" b="1"/><a:t>${xmlEscape(slide.title)}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1600200"/><a:ext cx="7315200" cy="4114800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${bodyRuns}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export async function pptx_presentation(args: Record<string, unknown>): Promise<ArtifactResult> {
  const title = stringArg(args, "title", "Presentation").trim() || "Presentation";
  const slides = slidesArg(args);
  const deckSlides = slides.length ? slides : [{ title, bullets: [stringArg(args, "summary", "Generated by Muster Artifact Studio.")] }];
  const filename = fileNameArg(args, "muster-presentation", "pptx");
  const slideOverrides = deckSlides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  const slideIds = deckSlides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("");
  const rels = deckSlides.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("");
  const entries = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slideOverrides}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: "ppt/presentation.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:sldIdLst>${slideIds}</p:sldIdLst></p:presentation>` },
    { name: "ppt/_rels/presentation.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>` },
    ...deckSlides.map((slide, index) => ({ name: `ppt/slides/slide${index + 1}.xml`, data: slideXml(slide) })),
  ];
  return artifactResult(filename, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", zipStored(entries));
}

export async function pdf_document(args: Record<string, unknown>): Promise<ArtifactResult> {
  const title = stringArg(args, "title", "Document").trim() || "Document";
  const summary = stringArg(args, "summary").trim();
  const sections = sectionsArg(args);
  const filename = fileNameArg(args, "muster-document", "pdf");
  const lines = [title, "", summary, ...sections.flatMap((section) => ["", section.heading, section.content])].join("\n").split(/\n/);
  const safeLines = lines.slice(0, 38).map((line, index) => {
    const prefix = index === 0 ? "/F1 18 Tf" : "/F1 11 Tf";
    return `${index === 0 ? prefix : ""} 0 -18 Td (${pdfEscape(line.slice(0, 96))}) Tj`;
  }).join("\n");
  const stream = `BT /F1 18 Tf 72 760 Td (${pdfEscape(title)}) Tj\n${safeLines}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return artifactResult(filename, "application/pdf", "pdf", encode(pdf));
}

export async function artifact_structural_verify(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const format = artifactFormatArg(args);
  if (!format) {
    return {
      status: "failed",
      reason: "format must be one of docx, xlsx, pptx, pdf",
      checks: [{ id: "format", status: "failed", summary: "missing or unsupported format" }],
    };
  }
  const bytes = artifactBytesArg(args);
  const requiredText = Array.isArray(args.requiredText) ? args.requiredText.map(String).filter(Boolean).slice(0, 20) : [];
  const checks = verifyArtifactBytes(format, bytes, { requiredText });
  const status = verificationStatus(checks);
  return {
    status,
    format,
    mimeType: formatMime(format),
    bytes: bytes.length,
    checks,
    failureBehavior: status === "passed"
      ? "safe to hand to the next workflow gate"
      : "block publish/share; return the failed checks and keep raw artifact out of broad memory",
  };
}

export async function office_artifact_contract(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const requested = Array.isArray(args.formats) ? args.formats.map((item) => String(item).toLowerCase()) : ["docx", "xlsx", "pptx", "pdf"];
  const formats = ["docx", "xlsx", "pptx", "pdf"].filter((format) => requested.includes(format));
  return {
    pillar: "office_artifacts",
    promise: "Create editable Office/PDF drafts locally, verify package structure, then route to app-server skills or authenticated suites only when available.",
    formats: formats.map((format) => ({
      format,
      localBuilder: { docx: "docx_document", xlsx: "xlsx_workbook", pptx: "pptx_presentation", pdf: "pdf_document" }[format],
      verifier: "artifact_structural_verify",
      appServerSkill: { docx: "documents", xlsx: "spreadsheets", pptx: "presentations", pdf: "pdf" }[format],
      qualityGate: format === "xlsx"
        ? "formula/range/content checks locally; app-server spreadsheet skill for charts, recalculation, and render QA"
        : format === "pptx"
          ? "slide/package/content checks locally; app-server presentation skill for layout previews and overlap QA"
          : format === "docx"
            ? "document package/content checks locally; app-server document skill for render QA, comments, redlines, and Google Docs import"
            : "PDF header/trailer/content checks locally; app-server PDF skill for rendering, extraction, and visual QA",
    })),
    workflow: ["intake", "capabilities", "draft", "verify", "polish_or_setup_blocker", "approval_gated_publish", "receipt_and_eval"],
    userControls: [
      "choose local draft or polished app-server handoff",
      "choose destination: local, Google Drive, Microsoft 365, or channel attachment",
      "verify before publish",
      "store artifact receipt in memory, not raw file body by default",
    ],
    noFalseClaims: [
      "local builders are deterministic but intentionally basic",
      "visual QA requires a renderer or host artifact skill",
      "Google/Microsoft uploads require authenticated connectors and explicit approval",
    ],
  };
}

export async function artifact_capability_plan(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supportedLocal = ["markdown", "csv", "dashboard", "docx", "xlsx", "pptx", "pdf"];
  const requested = Array.isArray(args.formats) ? args.formats.map((item) => String(item).toLowerCase()) : supportedLocal;
  const host = typeof args.hostCapabilities === "object" && args.hostCapabilities !== null ? args.hostCapabilities as Record<string, unknown> : {};
  const hostSkills = Array.isArray(host.skills) ? host.skills.map(String) : [];
  const local = supportedLocal.filter((format) => requested.includes(format));
  const appServerSkills = [
    { id: "documents", formats: ["docx"], quality: "high-fidelity DOCX/Google Docs creation with render QA" },
    { id: "spreadsheets", formats: ["xlsx", "csv"], quality: "formula-aware Excel/Google Sheets workbooks with visual QA" },
    { id: "presentations", formats: ["pptx"], quality: "PowerPoint/Google Slides decks with layout QA" },
    { id: "pdf", formats: ["pdf"], quality: "PDF creation, extraction, and render verification" },
  ].map((skill) => ({
    ...skill,
    available: hostSkills.includes(skill.id),
    setup: hostSkills.includes(skill.id) ? "route through the active app-server session" : "enable the corresponding Codex/Claude app-server plugin or skill before handoff",
  }));
  return {
    intent: stringArg(args, "intent", "artifact_generation"),
    local,
    localBuilders: {
      markdown: "markdown_report",
      csv: "rows_to_csv",
      dashboard: "dashboard_manifest",
      docx: "docx_document",
      xlsx: "xlsx_workbook",
      pptx: "pptx_presentation",
      pdf: "pdf_document",
    },
    appServerHandoffs: appServerSkills,
    policy: [
      "Use local builders for deterministic, dependency-light artifacts and tests.",
      "Use app-server document/spreadsheet/presentation/PDF skills for polished files that need render/visual QA.",
      "Never claim app-server generation is available unless the host explicitly reports that skill or plugin.",
    ],
  };
}

export async function office_tool_integrations(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const host = typeof args.hostCapabilities === "object" && args.hostCapabilities !== null ? args.hostCapabilities as Record<string, unknown> : {};
  const hostSkills = Array.isArray(host.skills) ? host.skills.map(String) : [];
  const mcpServers = Array.isArray(host.mcpServers) ? host.mcpServers.map(String) : [];
  return {
    purpose: "office_artifact_generation",
    local: [
      { id: "docx_document", formats: ["docx"], depth: "verified-editable-draft", available: true, verifier: "artifact_structural_verify", notes: "Dependency-light OOXML document package for deterministic CI and lightweight deliverables." },
      { id: "xlsx_workbook", formats: ["xlsx"], depth: "verified-editable-draft", available: true, verifier: "artifact_structural_verify", notes: "Inline-string workbook for tabular outputs; formulas/charts/recalculation should use an app-server spreadsheet skill." },
      { id: "pptx_presentation", formats: ["pptx"], depth: "verified-editable-draft", available: true, verifier: "artifact_structural_verify", notes: "Simple editable deck package; polished layouts should route to a presentation skill." },
      { id: "pdf_document", formats: ["pdf"], depth: "verified-static-draft", available: true, verifier: "artifact_structural_verify", notes: "Simple PDF payload; visual QA and complex layout should route to a PDF/document skill." },
    ],
    appServerSkills: [
      { id: "documents", formats: ["docx", "google-docs"], available: hostSkills.includes("documents"), setup: "Enable the document plugin/skill in the active Codex or Claude app-server session." },
      { id: "spreadsheets", formats: ["xlsx", "csv", "google-sheets"], available: hostSkills.includes("spreadsheets"), setup: "Enable the spreadsheet plugin/skill for formulas, charts, recalculation, and render QA." },
      { id: "presentations", formats: ["pptx", "google-slides"], available: hostSkills.includes("presentations"), setup: "Enable the presentation plugin/skill for layout libraries, slide previews, and overlap checks." },
      { id: "pdf", formats: ["pdf"], available: hostSkills.includes("pdf"), setup: "Enable the PDF plugin/skill for extraction, rendering, and visual verification." },
    ],
    officeSuites: [
      { id: "google-drive", available: mcpServers.includes("google-drive"), useFor: "Import DOCX/PPTX/XLSX into native Google Docs, Slides, or Sheets after local/app-server creation." },
      { id: "microsoft-365", available: mcpServers.includes("microsoft-365") || mcpServers.includes("onedrive") || mcpServers.includes("sharepoint"), useFor: "Future OneDrive/SharePoint/Office Graph import and sharing workflows." },
      { id: "libreoffice", available: false, useFor: "Optional local render/convert gate when installed; do not assume it exists in the core binary." },
      { id: "pandoc", available: false, useFor: "Optional Markdown/document conversion path when installed; keep it as an explicit external dependency." },
      { id: "poppler", available: false, useFor: "Optional PDF render/info validation path when installed." },
    ],
    policy: {
      noFalseClaims: "A tool is available only when local=true or the host explicitly lists the skill/MCP.",
      mutationApproval: "Publishing, sharing, sending, uploading, or overwriting artifacts requires an approval gate.",
      verification: "Editable Office packages must pass artifact_structural_verify; polished artifacts need render/visual QA.",
      sizeCaps: "Keep previews bounded and persist large outputs as artifacts instead of dumping base64 into model context.",
    },
  };
}

export async function office_artifact_workflow(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const format = stringArg(args, "format", "docx").toLowerCase();
  const destination = stringArg(args, "destination", "local").toLowerCase();
  const polished = args.polished === true || destination.includes("google") || destination.includes("office") || destination.includes("share");
  const builderByFormat: Record<string, string> = {
    markdown: "markdown_report",
    csv: "rows_to_csv",
    dashboard: "dashboard_manifest",
    docx: "docx_document",
    xlsx: "xlsx_workbook",
    pptx: "pptx_presentation",
    pdf: "pdf_document",
  };
  const builder = builderByFormat[format] ?? "artifact_capability_plan";
  const steps: WorkflowStep[] = [
    {
      id: "intake",
      action: "Normalize request into artifact spec: audience, source data, format, destination, privacy class, and success checks.",
      risk: "safe",
      output: "artifact_spec",
    },
    {
      id: "capabilities",
      action: "Inspect local builders, app-server skills, MCP servers, and optional Office import routes.",
      tool: "office_tool_integrations",
      risk: "safe",
      inputFrom: "artifact_spec",
      output: "capability_matrix",
    },
    {
      id: "draft",
      action: polished ? "Create a deterministic draft locally, then prepare a handoff spec for the app-server artifact skill." : "Create the artifact with the local deterministic builder.",
      tool: builder,
      risk: "safe",
      inputFrom: "artifact_spec",
      output: "draft_artifact",
    },
    {
      id: "verify",
      action: "Run structural checks: package opens as expected, required parts exist, content includes requested title/sections, output size is bounded.",
      risk: "review",
      inputFrom: "draft_artifact",
      output: "verification_report",
    },
    {
      id: "polish",
      action: polished ? "Route to app-server document/spreadsheet/presentation/PDF skill for visual QA, formulas, charts, slide layout, or conversion." : "Skip app-server polish unless the user asks for layout-grade output.",
      risk: polished ? "review" : "safe",
      inputFrom: "verification_report",
      gate: polished ? "Host must expose the matching app-server skill; otherwise return setup guidance, not a fake artifact." : undefined,
      output: polished ? "polished_artifact_or_setup_blocker" : "verified_artifact",
    },
    {
      id: "publish",
      action: destination === "local" ? "Return the local artifact reference and verification report." : "Upload/share/import only after explicit approval and configured credentials.",
      risk: destination === "local" ? "safe" : "approval",
      inputFrom: polished ? "polished_artifact_or_setup_blocker" : "verified_artifact",
      gate: destination === "local" ? undefined : "approval_required",
      output: "delivery_receipt",
    },
  ];
  return {
    format,
    destination,
    mode: polished ? "local-draft-plus-app-server-polish" : "local-deterministic",
    sourceEvidence: [
      "OpenClaw Lobster uses one deterministic workflow call, explicit approvals, resumable envelopes, output caps, and sandbox-aware execution.",
      "Muster flow/goal loops add durable run records, replay/diff, token ledger attribution, and eval-gated learning around the workflow.",
    ],
    steps,
    envelope: {
      statuses: ["ok", "needs_approval", "blocked", "failed"],
      resumeToken: destination === "local" ? "not_required" : "required_for_approval_resume",
      artifacts: ["artifact_spec", "draft_artifact", "verification_report", "delivery_receipt"],
    },
    recommendedFlow: {
      toolAgentGate: ["tool:intake", "tool:capabilities", "tool:draft", "gate:verify", polished ? "agent/app-server:polish" : "tool:verify", destination === "local" ? "tool:deliver" : "gate:publish"],
      cronSafe: false,
      tokenLedger: true,
      memoryPolicy: "store artifact summary and receipt only; do not store raw document bodies unless user opts in.",
    },
  };
}

export async function artifact_goal_passes(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const goal = stringArg(args, "goal", "create artifact");
  const strictness = stringArg(args, "strictness", "release");
  return {
    goal,
    strictness,
    passes: [
      { id: "design", owner: "artifact-architect", checks: ["format fit", "audience", "privacy", "source availability", "success rubric"] },
      { id: "build", owner: "artifact-builder", checks: ["local deterministic artifact", "bounded payload", "no secrets in output", "editable container when applicable"] },
      { id: "verify", owner: "qa-reviewer", checks: ["structural package validation", "content inclusion", "format recognition", "size cap", "visual QA when renderer exists"] },
      { id: "polish", owner: "app-server-specialist", checks: ["use document/spreadsheet/presentation/PDF skill when host exposes it", "do not fake missing plugins", "capture setup blocker"] },
      { id: "deliver", owner: "release-captain", checks: ["approval for uploads/sends", "token ledger entry", "artifact receipt", "changelog/release note if product surface changed"] },
      { id: "learn", owner: "evaluator", checks: ["record user feedback", "promote only with eval evidence", "keep raw file content out of broad memory by default"] },
    ],
    breakTests: [
      "missing host skill should return setup blocker, not success",
      "large table should stay bounded and persist as artifact",
      "destination upload without credentials should require setup",
      "mutating publish/share should pause for approval",
      "failed verification should not write memory as success",
    ],
  };
}

export const tools = {
  markdown_report,
  rows_to_csv,
  dashboard_manifest,
  docx_document,
  xlsx_workbook,
  pptx_presentation,
  pdf_document,
  artifact_structural_verify,
  artifact_capability_plan,
  office_artifact_contract,
  office_tool_integrations,
  office_artifact_workflow,
  artifact_goal_passes,
};
