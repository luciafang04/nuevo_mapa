"use client";

import dynamic from "next/dynamic";

const SpainMap = dynamic(() => import("./SpainMap"), {
  ssr: false,
  loading: () => (
    <section className="mx-auto w-full max-w-6xl overflow-hidden rounded-[32px] border border-white/70 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
      <div className="h-1.5 w-24 rounded-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-sky-500" />
      <p className="mt-5 text-sm font-medium text-slate-600">
        Cargando el mapa y las capas de clima...
      </p>
    </section>
  ),
});

export default function SpainMapSection() {
  return <SpainMap />;
}
