import SpainMapSection from "./components/SpainMapSection";

export default function Home() {
  return (
    <main className="relative flex min-h-screen items-center overflow-hidden px-4 py-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(16,185,129,0.12),transparent_32%),radial-gradient(circle_at_82%_16%,rgba(59,130,246,0.12),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(245,158,11,0.08),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.85),transparent)]" />
      <SpainMapSection />
    </main>
  );
}
