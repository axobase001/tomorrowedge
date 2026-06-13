import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { looksLikeGbkDecodedUtf8, normalizeUserSuppliedText } from "../../src/utils/textEncoding.js";

describe("text encoding normalization", () => {
  it("leaves normal UTF-8 user text unchanged", () => {
    const input = "\u8bf7\u521b\u5efa\u4e00\u4e2a\u6570\u5b66\u4f5c\u4e1a\u9898";
    const result = normalizeUserSuppliedText(input);

    expect(result).toEqual({ text: input, repaired: false });
  });

  it("repairs probable UTF-8 text decoded as GBK when recovery is lossless enough", () => {
    const original = "\u8bf7\u521b\u5efa\u4e00\u4e2a\u6570\u5b66\u4f5c\u4e1a\u9898";
    const mojibake = iconv.decode(Buffer.from(original, "utf8"), "gbk");
    const result = normalizeUserSuppliedText(mojibake);

    expect(looksLikeGbkDecodedUtf8(mojibake)).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.text).toBe(original);
  });
});
