import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PinForm } from "./pin-form";

export default async function PinPage() {
  const s = await requirePage(null);
  return (
    <>
      <PageHeader
        title="My PIN"
        subtitle={s.role === "owner" ? "You type this on the till to approve big discounts, refunds and late returns. Keep it to yourself." : "A PIN for quick actions on the till."}
      />
      <div className="max-w-sm"><PinForm hasPin={!!s.member.pinHash} /></div>
    </>
  );
}
