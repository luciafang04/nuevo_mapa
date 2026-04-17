"use client";

import dynamic from "next/dynamic";

const SpainMap = dynamic(() => import("./SpainMap"), {
  ssr: false,
  loading: () => (
    <section className="mx-auto w-full max-w-6xl rounded-[28px] border border-black/10 bg-white/90 p-8 shadow-lg shadow-black/5">
      <p className="text-sm text-slate-600">Cargando mapa...</p>
    </section>
  ),
});

export default function SpainMapSection() {
  return <SpainMap />;
}
