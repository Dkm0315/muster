type Row = Record<string, unknown>;

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
  const sections = Array.isArray(args.sections) ? args.sections : [];
  const body = [`# ${title}`];
  if (summary) body.push("", summary);
  for (const section of sections) {
    if (typeof section === "string") {
      body.push("", section);
    } else if (typeof section === "object" && section !== null) {
      const record = section as Record<string, unknown>;
      const heading = typeof record.heading === "string" ? record.heading : "Section";
      const content = typeof record.content === "string" ? record.content : "";
      body.push("", `## ${heading}`, "", content);
    }
  }
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

export const tools = {
  markdown_report,
  rows_to_csv,
  dashboard_manifest,
};
