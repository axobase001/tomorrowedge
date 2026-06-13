import iconv from "iconv-lite";

export type TextNormalizationResult = {
  text: string;
  repaired: boolean;
  reason?: string;
};

export function normalizeUserSuppliedText(text: string): TextNormalizationResult {
  const trimmed = text.trim();
  if (!looksLikeGbkDecodedUtf8(trimmed)) return { text: trimmed, repaired: false };

  const recovered = recoverGbkDecodedUtf8(trimmed);
  if (!recovered || recovered === trimmed) return { text: trimmed, repaired: false };

  const before = mojibakeScore(trimmed);
  const after = mojibakeScore(recovered);
  if (after + 4 >= before || replacementCount(recovered) > replacementCount(trimmed)) {
    return { text: trimmed, repaired: false };
  }

  return {
    text: recovered.trim(),
    repaired: true,
    reason: "recovered probable UTF-8 text decoded through GBK/CP936"
  };
}

export function looksLikeGbkDecodedUtf8(text: string): boolean {
  if (!text) return false;
  const markers = [
    "璇", "峰", "垱", "寤", "轰", "竴", "涓", "暟", "瀛", "︿", "綔", "氶",
    "鐩", "鈥", "鈭", "銆", "锛", "骞", "跺", "乻", "乧", "丷", "俢", "俿", "俁"
  ];
  const markerHits = markers.reduce((sum, marker) => sum + countOccurrences(text, marker), 0);
  const cjkCount = [...text].filter((char) => /[\u3400-\u9fff]/u.test(char)).length;
  const suspiciousPunctuation = (text.match(/[鈥鈭銆锛]/gu) ?? []).length;
  const privateUse = (text.match(/[\ue000-\uf8ff]/gu) ?? []).length;
  return markerHits >= 4 || suspiciousPunctuation >= 2 || (privateUse > 0 && cjkCount >= 4);
}

function recoverGbkDecodedUtf8(text: string): string | undefined {
  try {
    return iconv.encode(text, "gbk").toString("utf8");
  } catch {
    return undefined;
  }
}

function mojibakeScore(text: string): number {
  const markerPattern = /[璇峰垱寤轰竴涓暟瀛綔氶鐩鈥鈭銆锛骞跺乻乧丷俢俿俁]/gu;
  const markers = (text.match(markerPattern) ?? []).length;
  const privateUse = (text.match(/[\ue000-\uf8ff]/gu) ?? []).length;
  const replacements = replacementCount(text);
  return markers + privateUse * 3 + replacements * 6;
}

function replacementCount(text: string): number {
  return (text.match(/\uFFFD|\?/gu) ?? []).length;
}

function countOccurrences(text: string, marker: string): number {
  let count = 0;
  let index = text.indexOf(marker);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(marker, index + marker.length);
  }
  return count;
}
