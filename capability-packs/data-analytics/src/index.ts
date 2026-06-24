type Row = Record<string, unknown>;

function rowsArg(args: Record<string, unknown>): Row[] {
  return Array.isArray(args.rows) ? args.rows.filter((row): row is Row => typeof row === "object" && row !== null && !Array.isArray(row)) : [];
}

function numericValues(rows: Row[], field: string): number[] {
  return rows.map((row) => row[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export async function profile_rows(args: Record<string, unknown>): Promise<{ rows: number; columns: Array<{ name: string; nonNull: number; type: string }> }> {
  const rows = rowsArg(args);
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    rows: rows.length,
    columns: names.map((name) => {
      const values = rows.map((row) => row[name]).filter((value) => value !== undefined && value !== null);
      const typeCounts = new Map<string, number>();
      for (const value of values) typeCounts.set(Array.isArray(value) ? "array" : typeof value, (typeCounts.get(Array.isArray(value) ? "array" : typeof value) ?? 0) + 1);
      const type = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "empty";
      return { name, nonNull: values.length, type };
    }),
  };
}

export async function numeric_summary(args: Record<string, unknown>): Promise<{ summaries: Array<{ field: string; count: number; min: number; max: number; mean: number }> }> {
  const rows = rowsArg(args);
  const fields = Array.isArray(args.fields) && args.fields.every((field) => typeof field === "string")
    ? args.fields as string[]
    : [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => typeof row[key] === "number")))];
  return {
    summaries: fields.map((field) => {
      const values = numericValues(rows, field);
      const sum = values.reduce((total, value) => total + value, 0);
      return {
        field,
        count: values.length,
        min: values.length ? Math.min(...values) : 0,
        max: values.length ? Math.max(...values) : 0,
        mean: values.length ? sum / values.length : 0,
      };
    }),
  };
}

export const tools = {
  profile_rows,
  numeric_summary,
};
