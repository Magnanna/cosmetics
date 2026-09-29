import { requirePage } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { PageHeader } from "@/components/ui";
import { ShopForm } from "../forms";

export default async function ShopSettingsPage() {
  const s = await requirePage("settings.edit");
  const o = s.org;
  return (
    <>
      <PageHeader title="Shop settings" />
      <ShopForm v={{
        name: o.name, phone: o.phone ? formatPhone(o.phone) : "", address: o.address ?? "", kraPin: o.kraPin ?? "", receiptFooter: o.receiptFooter ?? "",
        cashierDiscountLimit: o.cashierDiscountLimitCents / 100, returnWindowHours: o.returnWindowHours,
        loyaltyEarnKes: o.loyaltyEarnCentsPerPoint / 100, loyaltyPointValue: o.loyaltyPointValueCents / 100, loyaltyMinRedeem: o.loyaltyMinRedeemCents / 100,
        totRatePct: o.totRateBp / 100,
      }} />
    </>
  );
}
