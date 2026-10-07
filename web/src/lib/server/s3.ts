import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

// MinIO(s3.qoolla.com) 직접 조회. unlimited-ocr 와 같은 .env 값(S3_*)을 쓴다.
export const S3_BUCKET = process.env.S3_BUCKET || "qoollastorage";

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || "https://s3.qoolla.com",
  region: "us-east-1",
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY || "",
  },
});

async function listOnce(prefix: string) {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// 폴더명이 NFC/NFD 섞여 있으므로 NFC 로 찾고 없으면 NFD 로 다시 찾는다 (unlimited-ocr 와 같은 규칙)
export async function listKeys(prefix: string) {
  const nfc = prefix.normalize("NFC");
  const keys = await listOnce(nfc);
  const nfd = prefix.normalize("NFD");
  return keys.length || nfd === nfc ? keys : listOnce(nfd);
}

// 객체 본문(텍스트). NFC 키가 없으면 NFD 키로. 둘 다 없으면 null
export async function getText(key: string): Promise<string | null> {
  for (const k of new Set([key.normalize("NFC"), key.normalize("NFD")])) {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: k }));
      return (await res.Body?.transformToString("utf-8")) ?? null;
    } catch (e) {
      if ((e as { name?: string }).name !== "NoSuchKey") throw e;
    }
  }
  return null;
}
