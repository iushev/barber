/**
 * Placeholder за снимка. Ясно маркиран — заменете с реална снимка преди пускане.
 */
export function PhotoPlaceholder({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Място за снимка: ${label}`}
      className={`photo-placeholder border-bone/15 relative flex items-end overflow-hidden rounded-sm border border-dashed ${className}`}
    >
      <span className="bg-ink/80 text-brass m-3 rounded-sm px-2 py-1 font-mono text-[11px] tracking-wider uppercase">
        Снимка — замени: {label}
      </span>
    </div>
  );
}
