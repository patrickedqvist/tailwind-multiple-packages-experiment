import type { ReactNode } from "react";

export function FeatureABanner({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-purple-1000 bg-neutral-900 p-6 shadow-lg">
      <h3 className="mb-2 text-xl font-bold text-purple-1000">{title}</h3>
      <p className="text-sm text-neutral-300">{children}</p>
    </div>
  );
}
