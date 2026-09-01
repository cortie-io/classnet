/** 최소 RFC4180 지원 CSV 파서: 따옴표로 감싼 필드 안의 콤마·줄바꿈을 처리한다. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/^﻿/, ""); // BOM 제거(엑셀 저장 CSV 대응)

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const HEADER_ALIASES: Record<string, string> = {
  학번: "studentId",
  studentid: "studentId",
  student_id: "studentId",
  이름: "name",
  name: "name",
  생년월일: "birthdate",
  birthdate: "birthdate",
  학과: "department",
  department: "department",
  메일: "email",
  이메일: "email",
  email: "email",
  비밀번호: "password",
  password: "password",
};

export interface StudentCsvRow {
  studentId: string;
  name: string;
  birthdate: string;
  department: string;
  email: string;
  password: string;
  rowNumber: number;
}

export function parseStudentCsv(text: string): { rows: StudentCsvRow[]; errors: { rowNumber: number; message: string }[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [{ rowNumber: 0, message: "빈 CSV 파일입니다." }] };

  const header = table[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim());
  const required = ["studentId", "name", "email", "password"];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length > 0) {
    return { rows: [], errors: [{ rowNumber: 0, message: `필수 컬럼 누락: ${missing.join(", ")}` }] };
  }

  const rows: StudentCsvRow[] = [];
  const errors: { rowNumber: number; message: string }[] = [];
  for (let i = 1; i < table.length; i++) {
    const rowNumber = i + 1; // 1-based, 헤더 포함
    const record: Record<string, string> = {};
    header.forEach((h, idx) => (record[h] = (table[i][idx] ?? "").trim()));
    if (!record.studentId || !record.name || !record.email || !record.password) {
      errors.push({ rowNumber, message: "필수 값(학번/이름/메일/비밀번호) 중 비어있는 항목이 있습니다." });
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
      errors.push({ rowNumber, message: `이메일 형식 오류: ${record.email}` });
      continue;
    }
    if (record.password.length < 8) {
      errors.push({ rowNumber, message: "비밀번호는 8자 이상이어야 합니다." });
      continue;
    }
    rows.push({
      studentId: record.studentId,
      name: record.name,
      birthdate: record.birthdate || "",
      department: record.department || "",
      email: record.email.toLowerCase(),
      password: record.password,
      rowNumber,
    });
  }
  return { rows, errors };
}
