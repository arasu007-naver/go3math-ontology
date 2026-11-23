import { BlockList, isIP } from "node:net";

// 브라우저에서 온 값을 파일 경로·저장소 키·원격 주소로 쓰기 전에 검사한다.

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

// 사내망·루프백·클라우드 메타데이터 등 공인 인터넷이 아닌 주소면 true. IP 가 아니면 막는다.
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

// 경로 구분자 없는 PDF 파일 이름만 통과시킨다
export function safeUploadName(name: string): string | null {
  if (!name || /[/\\\0]/.test(name) || name.startsWith(".")) return null;
  return /\.pdf$/i.test(name) ? name : null;
}

// 폴더 이름으로 쓰이는 도서 stem: 상위 폴더로 나갈 수 없어야 한다
export function isSafeBookStem(stem: unknown): stem is string {
  return typeof stem === "string" && stem.trim() !== "" && !/[/\\\0]/.test(stem) && stem !== "." && stem !== "..";
}

// OCR 페이지 JSON 키만 허용: main/<stem>/<n>.json, sub/, batch/main/, batch/subs/
export function isOcrPageJsonKey(key: string): boolean {
  const m = key.match(/^(?:main|sub|batch\/main|batch\/subs)\/(.+)\/\d+\.json$/);
  return !!m && !key.includes("\0") && !m[1].split("/").some((part) => part === "" || part === "." || part === "..");
}
