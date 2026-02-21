import type { SplitResult } from "./types";

export function splitIfNeeded(markdown: string, maxMessages: number = 300): SplitResult[] {
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatterMatch) {
    return [{ markdown, partNumber: 1, totalParts: 1 }];
  }

  const frontmatter = frontmatterMatch[1];
  const body = markdown.slice(frontmatterMatch[0].length);

  const messageSections = body.split(/(?=^### (?:User|Assistant) \()/m);
  const headerSection = messageSections.shift() || "";

  if (messageSections.length <= maxMessages) {
    return [{ markdown, partNumber: 1, totalParts: 1 }];
  }

  const totalParts = Math.ceil(messageSections.length / maxMessages);
  const results: SplitResult[] = [];

  for (let i = 0; i < totalParts; i++) {
    const start = i * maxMessages;
    const end = Math.min(start + maxMessages, messageSections.length);
    const chunk = messageSections.slice(start, end);

    const partFrontmatter = `${frontmatter}\npart: ${i + 1}\ntotal_parts: ${totalParts}`;
    const partBody = i === 0 ? headerSection + chunk.join("") : chunk.join("");

    const partMarkdown = `---\n${partFrontmatter}\n---\n${partBody}`;
    results.push({
      markdown: partMarkdown,
      partNumber: i + 1,
      totalParts,
    });
  }

  return results;
}
