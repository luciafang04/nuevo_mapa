import SpainMapSection from "./components/SpainMapSection";

export default function Home() {
  return (
    <main className="relative flex min-h-[100dvh] w-screen items-stretch overflow-y-auto bg-[#fff1f7] px-4 py-4 sm:px-6 sm:py-6 lg:h-[100dvh] lg:overflow-hidden lg:px-8">
      <SpainMapSection />
    </main>
  );
}
