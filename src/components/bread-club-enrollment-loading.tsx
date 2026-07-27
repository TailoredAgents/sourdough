import { Loader2 } from "lucide-react";

export function BreadClubEnrollmentLoading() {
  return (
    <section
      id="bread-club-enrollment"
      className="scroll-mt-28 border-2 border-[#23443b] bg-white"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 bg-[#23443b] px-5 py-5 text-white sm:px-7">
        <Loader2 className="shrink-0 animate-spin" size={22} />
        <div>
          <p className="text-xs font-bold uppercase text-[#f5c28b]">
            Enrollment
          </p>
          <p className="mt-1 font-bold">Preparing available Bread Club plans...</p>
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-7">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-48 animate-pulse border border-stone-200 bg-stone-100"
            aria-hidden="true"
          />
        ))}
      </div>
    </section>
  );
}
