export function parseOctets(ip: string): number[] {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) throw new Error(`IP 주소 형식이 아닙니다: ${ip}`);
  const octets = parts.map((p) => {
    if (!/^\d{1,3}$/.test(p)) throw new Error(`잘못된 옥텟: ${p}`);
    const n = Number(p);
    if (n < 0 || n > 255) throw new Error(`옥텟 범위 초과(0~255): ${p}`);
    return n;
  });
  return octets;
}

export function ipToInt(ip: string): number {
  const [a, b, c, d] = parseOctets(ip);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function toBinaryOctets(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
    .map((o) => o.toString(2).padStart(8, "0"))
    .join(".");
}

export function prefixToMaskInt(prefix: number): number {
  if (prefix < 0 || prefix > 32) throw new Error(`서브넷 프리픽스는 0~32여야 합니다: /${prefix}`);
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function maskToPrefix(mask: string): number {
  const n = ipToInt(mask);
  let bits = 0;
  let seenZero = false;
  for (let i = 31; i >= 0; i--) {
    const bit = (n >>> i) & 1;
    if (bit === 1) {
      if (seenZero) throw new Error(`연속되지 않은 서브넷 마스크입니다: ${mask}`);
      bits++;
    } else {
      seenZero = true;
    }
  }
  return bits;
}
