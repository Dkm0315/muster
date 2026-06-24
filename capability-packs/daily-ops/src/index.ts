interface Task {
  readonly title: string;
  readonly priority: "high" | "medium" | "low";
  readonly reason: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function taskPriority(text: string): Task["priority"] {
  const lower = text.toLowerCase();
  if (/(urgent|today|blocked|prod|customer|deadline|p0|p1)/.test(lower)) return "high";
  if (/(soon|this week|review|follow.?up|p2)/.test(lower)) return "medium";
  return "low";
}

export async function prioritize_tasks(args: Record<string, unknown>): Promise<{ tasks: Task[] }> {
  const tasks = strings(args.tasks).map((title) => {
    const priority = taskPriority(title);
    return {
      title,
      priority,
      reason: priority === "high" ? "Time-sensitive or externally blocking language detected." : priority === "medium" ? "Actionable but not clearly urgent." : "Useful backlog item.",
    };
  });
  const order = { high: 0, medium: 1, low: 2 };
  return { tasks: tasks.sort((a, b) => order[a.priority] - order[b.priority] || a.title.localeCompare(b.title)) };
}

export async function daily_brief(args: Record<string, unknown>): Promise<{ markdown: string }> {
  const notes = strings(args.notes);
  const taskResult = await prioritize_tasks({ tasks: strings(args.tasks) });
  const risks = strings(args.risks);
  const lines = ["# Daily Brief", "", "## Priorities"];
  for (const task of taskResult.tasks.slice(0, 8)) lines.push(`- ${task.priority.toUpperCase()}: ${task.title}`);
  if (!taskResult.tasks.length) lines.push("- No tasks provided.");
  lines.push("", "## Notes");
  for (const note of notes.slice(0, 8)) lines.push(`- ${note}`);
  if (!notes.length) lines.push("- No notes provided.");
  lines.push("", "## Risks");
  for (const risk of risks.slice(0, 8)) lines.push(`- ${risk}`);
  if (!risks.length) lines.push("- No risks provided.");
  return { markdown: `${lines.join("\n")}\n` };
}

export const tools = {
  daily_brief,
  prioritize_tasks,
};
