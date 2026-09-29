import { openPhotoToken } from "@/lib/photo-tokens";
import { PhoneCamera } from "./phone-camera";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product photo", robots: { index: false } };

export default async function PhonePhotoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await openPhotoToken(token);
  return (
    <main className="min-h-screen px-4 py-8 grid content-start gap-5 max-w-md mx-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-brand text-brand-ink grid place-items-center font-bold">K</div>
        <span className="text-[15px] font-semibold">Kenfri Cosmetics</span>
      </div>
      {row ? (
        <PhoneCamera token={token} productName={row.productName} />
      ) : (
        <div className="card p-6 grid gap-2">
          <h1 className="text-[18px] font-semibold">This link has expired</h1>
          <p className="text-[14px] text-ink-600">Photo links work once, for 30 minutes. Tap “Add photo” on the till again for a new one.</p>
        </div>
      )}
    </main>
  );
}
