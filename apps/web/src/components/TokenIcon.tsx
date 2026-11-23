const palette = ["#E9F5E1:#3D7A12", "#FDE8E9:#B42318", "#EEF0FF:#3B2BB0", "#E3F7F4:#0E8F84", "#FFF1DE:#A44B00", "#FBEAFB:#8A2C8F"];

/**
 * Official token logos live in public/tokens/<SYMBOL>.svg. Add the symbol here once its file is in place;
 * until then the token shows its initials.
 */
export const TOKEN_LOGOS = new Set<string>([]);

export function TokenIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const sym = symbol.toUpperCase();
  if (TOKEN_LOGOS.has(sym)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/tokens/${sym}.svg`} alt="" width={size} height={size} className="rounded-full" />;
  }
  const [bg, fg] = palette[[...sym].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length].split(":");
  return (
    <span aria-hidden="true" style={{ width: size, height: size, background: bg, color: fg }} className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold">
      {sym.slice(0, 2)}
    </span>
  );
}
