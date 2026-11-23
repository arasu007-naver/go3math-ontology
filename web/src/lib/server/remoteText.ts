import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isBlockedAddress } from "./requestGuards";

// 사용자가 입력한 공개 주소의 텍스트를 서버가 대신 가져온다.
// 사내 주소로 가지 않도록 연결 시점의 DNS 결과를 검사하고, 리다이렉트도 매번 다시 검사한다.

const MAX_REDIRECTS = 3;
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export class RemoteTextError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const notAllowed = () => new RemoteTextError("허용되지 않은 주소입니다.", 400);

const publicLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(notAllowed() as NodeJS.ErrnoException, "", 0);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteTextError("유효하지 않은 URL입니다.", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new RemoteTextError("유효하지 않은 URL 프로토콜입니다.", 400);
  if (url.username || url.password) throw notAllowed();
  if (url.port && url.port !== "80" && url.port !== "443") throw notAllowed();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // IP 를 직접 적으면 DNS 조회를 거치지 않으므로 여기서 검사한다
  if (isIP(host) && isBlockedAddress(host)) throw notAllowed();
  return url;
}

type Hop = { redirect: string } | { text: string };

function fetchOnce(url: URL): Promise<Hop> {
  const get = url.protocol === "https:" ? https.get : http.get;
  return new Promise((resolve, reject) => {
    const req = get(
      url,
      {
        lookup: publicLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "User-Agent": "Go3Math-MDViewer/1.0",
          Accept: "text/markdown, text/plain, application/json, text/html, */*",
        },
      },
      (res) => {
        const status = res.statusCode ?? 502;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url).toString() });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new RemoteTextError(`원격 파일 로드 실패 (HTTP ${status})`, status >= 400 && status < 600 ? status : 502));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new RemoteTextError("파일이 너무 큽니다.", 413));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf-8") }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new RemoteTextError("원격 서버 응답이 없습니다.", 504)));
    req.on("error", reject);
  });
}

export async function fetchRemoteText(rawUrl: string): Promise<string> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await fetchOnce(checkUrl(current));
    if ("text" in result) return result.text;
    current = result.redirect;
  }
  throw new RemoteTextError("리다이렉트가 너무 많습니다.", 502);
}
