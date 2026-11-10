import { unzipSync, strFromU8 } from "fflate";
import { requireSession } from "@/lib/server/auth";
import { groupChapterFiles, indexKey, KINDS } from "@/lib/bookIndices";
import { saveBookIndexChapters, type BookIndexChapter } from "@/lib/dictionaryDb";

// 색인 zip 업로드. zip 안의 제n장-indices/dictonary/flashcards/quizzes.json 한 벌을 확인하고 kg 스키마에 저장한다.
// 도서는 zip 파일명(확장자 제외)을 book_stem 으로 쓴다.
export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  // Authorization: Bearer 가 오면 로그인 토큰과 같아야 한다 (화면은 토큰을 갖지 않으므로 세션 쿠키로 호출한다)
  const auth = req.headers.get("authorization");
  if (auth && auth !== `Bearer ${s.token}`) return Response.json({ error: "토큰이 올바르지 않습니다." }, { status: 401 });

  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return Response.json({ error: "zip 파일이 전송되지 않았습니다." }, { status: 400 });
  const bookStem = file.name.replace(/\.zip$/i, "").normalize("NFC").trim();
  if (!bookStem) return Response.json({ error: "zip 파일명이 비어 있습니다." }, { status: 400 });

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return Response.json({ error: "zip 파일을 열 수 없습니다." }, { status: 400 });
  }

  const { chapters, missing } = groupChapterFiles(Object.keys(entries));
  if (missing.length) return Response.json({ error: `한 벌에서 빠진 파일: ${missing.join(", ")}` }, { status: 400 });
  if (!chapters.size) return Response.json({ error: "zip 안에 '제n장-indices.json' 형식의 파일이 없습니다." }, { status: 400 });

  const parsed: BookIndexChapter[] = [];
  for (const [n, files] of chapters) {
    const ch = { n } as BookIndexChapter;
    for (const kind of KINDS) {
      let data: unknown;
      try {
        data = JSON.parse(strFromU8(entries[files[kind]]).replace(/^﻿/, ""));
      } catch {
        return Response.json({ error: `제${n}장 ${kind} 파일이 올바른 JSON 이 아닙니다.` }, { status: 400 });
      }
      if (!Array.isArray(data)) return Response.json({ error: `제${n}장 ${kind} 파일이 JSON 배열이 아닙니다.` }, { status: 400 });
      ch[kind] = data;
    }
    if (ch.indices.some((it) => !indexKey(it.term ?? it.index))) {
      return Response.json({ error: `제${n}장 indices 에 색인명(term)이 없는 항목이 있습니다.` }, { status: 400 });
    }
    if (ch.dictionary.some((it) => !indexKey(it.term ?? it.index))) {
      return Response.json({ error: `제${n}장 dictonary 에 term·index 가 모두 없는 항목이 있습니다.` }, { status: 400 });
    }
    parsed.push(ch);
  }

  try {
    const counts = await saveBookIndexChapters(bookStem, parsed);
    console.info(`[book-indices] ${bookStem} 장 ${parsed.map((c) => c.n).join(",")} 저장: ${JSON.stringify(counts)}`);
    return Response.json({ success: true, bookStem, chapters: parsed.map((c) => c.n), counts });
  } catch (e) {
    console.error("[book-indices]", e);
    return Response.json({ error: (e as Error).message || "DB 저장에 실패했습니다." }, { status: 500 });
  }
}
