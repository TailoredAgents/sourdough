export function ProductUnavailableOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/55 p-4">
      <span className="rounded-sm bg-white px-3 py-2 text-center text-xs font-black uppercase tracking-[0.16em] text-[#a94334] shadow-sm">
        Currently unavailable
      </span>
    </div>
  );
}
