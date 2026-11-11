import Decimal from "break_infinity.js";

export function fmt(s: string | number): string {
  const d = new Decimal(s);
  if (d.lt(1e6)) {
    const n = d.toNumber();
    return n < 100 && !Number.isInteger(n) ? n.toFixed(1) : Math.floor(n).toLocaleString("ja-JP");
  }
  return `${d.mantissa.toFixed(2)}e${d.exponent}`;
}

export function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} 時間 ${m} 分` : `${m} 分`;
}
