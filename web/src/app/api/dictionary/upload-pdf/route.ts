import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("pdfFile") as File | null;
    const customTitle = formData.get("bookTitle") as string | null;

    if (!file) {
      return NextResponse.json({ error: "PDF 파일이 전송되지 않았습니다." }, { status: 400 });
    }

    const fileName = file.name;
    const stem = fileName.replace(/\.[^/.]+$/, "");
    const bookTitle = customTitle || stem;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 저장 디렉토리 (mvps/unlimited-ocr/temp_uploads 또는 로컬 임시 폴더)
    const uploadDir = path.join(process.cwd(), "..", "mvps", "unlimited-ocr", "temp_uploads");
    await fs.mkdir(uploadDir, { recursive: true });
    const targetPath = path.join(uploadDir, fileName);
    await fs.writeFile(targetPath, buffer);

    console.log(`[PDF Uploaded] Saved ${fileName} (${buffer.length} bytes) to ${targetPath}`);

    return NextResponse.json({
      success: true,
      fileName,
      stem,
      bookTitle,
      sizeBytes: buffer.length,
      message: `PDF '${fileName}' 업로드가 완료되었습니다.`
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error("[API /api/dictionary/upload-pdf Error]", err);
    return NextResponse.json({ error: err.message || "PDF upload failed" }, { status: 500 });
  }
}
