import { requirePage } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { PageHeader } from "@/components/ui";
import { ShopForm } from "../forms";
import { BrandCard } from "../brand-card";

export default async function ShopSettingsPage() {
  const s = await requirePage("settings.edit");
  const o = s.org;
  return (
    <>
      <PageHeader title="Shop settings" />
      <div className="mb-5">
        <BrandCard shopName={o.name} logoUrl={o.logoUrl} brandColor={o.brandColor} />
      </div>
      <ShopForm v={{
        name: o.name, phone: o.phone ? formatPhone(o.phone) : "", address: o.address ?? "", kraPin: o.kraPin ?? "", receiptFooter: o.receiptFooter ?? "",
        cashierDiscountLimit: o.cashierDiscountLimitCents / 100, returnWindowHours: o.returnWindowHours,
        loyaltyEarnKes: o.loyaltyEarnCentsPerPoint / 100, loyaltyPointValue: o.loyaltyPointValueCents / 100, loyaltyMinRedeem: o.loyaltyMinRedeemCents / 100,
        totRatePct: o.totRateBp / 100,
      }} />
    </>
  );
}
