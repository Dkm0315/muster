/**
 * MEDIA: tag convention — the agent's output channel stays plain text;
 * adapters render attachments natively (Telegram documents, Slack uploads,
 * web links). A line of the form `MEDIA:<path-or-url>` marks an attachment
 * and is stripped from the visible text.
 */

export interface ExtractedMedia {
  readonly text: string;
  readonly media: Array<{ readonly ref: string; readonly name: string }>;
}

const MEDIA_LINE = /^\s*MEDIA:\s*(\S.*?)\s*$/;

export function extractMediaTags(raw: string): ExtractedMedia {
  const media: ExtractedMedia["media"] = [];
  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    const match = line.match(MEDIA_LINE);
    if (match) {
      const ref = match[1];
      media.push({ ref, name: ref.split("/").pop() ?? ref });
    } else {
      kept.push(line);
    }
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), media };
}
