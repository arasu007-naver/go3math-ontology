import assert from "node:assert/strict";
import { test } from "node:test";
import { isBlockedAddress, isOcrPageJsonKey, isSafeBookStem, safeUploadName } from "./requestGuards.ts";

test("사내·루프백·메타데이터 주소를 막는다", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "not-an-ip"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test("공인 주소는 통과시킨다", () => {
  for (const ip of ["104.21.14.230", "20.60.200.161", "8.8.8.8", "2606:4700::1111"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("업로드 파일 이름", () => {
  assert.equal(safeUploadName("이론 수학 대전.pdf"), "이론 수학 대전.pdf");
  assert.equal(safeUploadName("A.PDF"), "A.PDF");
  for (const bad of ["../evil.pdf", "..\\evil.pdf", "a/b.pdf", ".hidden.pdf", "a.txt", "", "a\0.pdf"]) {
    assert.equal(safeUploadName(bad), null, bad);
  }
});

test("도서 stem", () => {
  assert.equal(isSafeBookStem("이론 수학 대전"), true);
  for (const bad of ["..", ".", "../x", "a/b", "a\\b", "", "  ", 3, null]) {
    assert.equal(isSafeBookStem(bad), false, String(bad));
  }
});

test("OCR JSON 키", () => {
  for (const ok of ["main/책/1.json", "sub/책/12.json", "batch/main/책/3.json", "batch/subs/책/4.json"]) {
    assert.equal(isOcrPageJsonKey(ok), true, ok);
  }
  for (const bad of ["secrets/app.json", "main/책/config.json", "main/../secrets/1.json", "main//1.json", "origin/책/1.json", "main/1.json"]) {
    assert.equal(isOcrPageJsonKey(bad), false, bad);
  }
});
