export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-[380px] grid gap-6">
        <div className="grid gap-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-brand text-brand-ink grid place-items-center font-bold tracking-tight">K</div>
          <div className="text-[15px] font-semibold mt-2">Kenfri Cosmetics</div>
        </div>
        {children}
      </div>
    </main>
  );
}
