export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

export interface ParsedNode {
  subjectNum: string;
  subject: string;
  category: string;
  topic: string;
  tagPath: string;
  sectionNo: string;
  title: string;
  bodyMd: string;
  bodyText: string;
  tables: ParsedTable[];
  orderIndex: number;
}

const SUBJECT_RE = /^##\s*(\d)과목\s*[—–-]\s*(.+?)\s*$/;
const SECTION_RE = /^###\s*(\d+\.\d+)\s+(.+?)\s*$/;
const TAG_RE = /^`?\s*📌\s*(.+?)\s*`?$/;

function isTableRow(line: string): boolean {
  return /^\|.*\|$/.test(line.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function extractTables(lines: string[]): { tables: ParsedTable[]; textLines: string[] } {
  const tables: ParsedTable[] = [];
  const textLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const headers = splitRow(line);
      const rows: Record<string, string>[] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        const cells = splitRow(lines[j]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h || `col${idx}`] = cells[idx] ?? "";
        });
        rows.push(row);
        j++;
      }
      tables.push({ headers, rows });
      // render a flattened text form of the table into textLines too, for BM25/LLM context
      for (const row of rows) {
        const parts = headers.map((h) => `${h}=${row[h]}`).join(", ");
        textLines.push(parts);
      }
      i = j;
    } else {
      if (line.trim() !== "---") textLines.push(line);
      i++;
    }
  }
  return { tables, textLines };
}

export function parseReferenceDoc(raw: string): ParsedNode[] {
  const lines = raw.split("\n");
  const nodes: ParsedNode[] = [];

  let currentSubjectNum = "";
  let currentSubjectName = "";
  let orderIndex = 0;

  let pending: {
    sectionNo: string;
    title: string;
    tagLine: string | null;
    bodyLines: string[];
  } | null = null;

  function flush() {
    if (!pending) return;
    const { sectionNo, title, tagLine, bodyLines } = pending;
    let subject = currentSubjectName;
    let category = "";
    let topic = title;
    let tagPath = `${currentSubjectNum}과목_${currentSubjectName}`;
    if (tagLine) {
      const parts = tagLine.split(">").map((p) => p.trim());
      tagPath = tagLine;
      if (parts.length >= 1) subject = parts[0];
      if (parts.length >= 2) category = parts[1];
      if (parts.length >= 3) topic = parts.slice(2).join(" > ");
      else if (parts.length === 2) topic = parts[1];
    }
    // trim leading/trailing blank lines
    let start = 0;
    let end = bodyLines.length;
    while (start < end && bodyLines[start].trim() === "") start++;
    while (end > start && bodyLines[end - 1].trim() === "") end--;
    const trimmedBody = bodyLines.slice(start, end);
    const bodyMd = trimmedBody.join("\n");
    const { tables, textLines } = extractTables(trimmedBody);
    const bodyText = textLines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");

    nodes.push({
      subjectNum: currentSubjectNum,
      subject,
      category: category || "일반",
      topic,
      tagPath,
      sectionNo,
      title,
      bodyMd,
      bodyText,
      tables,
      orderIndex: orderIndex++,
    });
    pending = null;
  }

  for (const rawLine of lines) {
    const subjectMatch = rawLine.match(SUBJECT_RE);
    if (subjectMatch) {
      flush();
      currentSubjectNum = subjectMatch[1];
      currentSubjectName = subjectMatch[2].trim();
      if (currentSubjectName.includes("활용")) break; // reached trailing notes section, stop
      continue;
    }
    const sectionMatch = rawLine.match(SECTION_RE);
    if (sectionMatch) {
      flush();
      let title = sectionMatch[2].trim();
      // strip trailing backtick-wrapped caveat like `[중요: 원본 오류 정정]`
      title = title.replace(/\s*`\[[^\]]*\]`\s*$/, "").trim();
      pending = { sectionNo: sectionMatch[1], title, tagLine: null, bodyLines: [] };
      continue;
    }
    if (pending) {
      const tagMatch = rawLine.match(TAG_RE);
      if (tagMatch && pending.tagLine === null && pending.bodyLines.every((l) => l.trim() === "")) {
        pending.tagLine = tagMatch[1];
        continue;
      }
      pending.bodyLines.push(rawLine);
    }
  }
  flush();

  return nodes;
}
