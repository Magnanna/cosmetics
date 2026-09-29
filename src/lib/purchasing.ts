import { and, eq, sql } from "drizzle-orm";
import { bills, billLines, supplierPayments, supplierPaymentAllocations, suppliers, variantSuppliers, variants, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { addStock } from "./inventory";
import { billTotals, landedLine } from "./landed-cost";
import { acct, postEntry, signedPair, type PostLine } from "./ledger";

export class PurchasingError extends Error {}

export interface BillInput {
  supplierId: number;
  supplierInvoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  ratesIncludeVat: boolean;
  vatBp: number;
  notes?: string | null;
  lines: { variantId: number; supplierItemCode?: string | null; qty: number; unitsPerUom: number; rateCents: number }[];
}

/**
 * Records a supplier invoice: FIFO lots for every line, Dr Inventory (VAT
 * inclusive — Kenfri can't claim it back) / Cr Accounts Payable, and
 * remembers the supplier's item code and pack size for next time.
 */
export async function postBill(tx: Tx, input: BillInput): Promise<{ billId: number; totalCents: number }> {
  const { orgId, memberId } = ctx();
  if (input.lines.length === 0) throw new PurchasingError("Add at least one line.");
  const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.orgId, orgId), eq(suppliers.id, input.supplierId))).limit(1);
  if (!supplier) throw new PurchasingError("Supplier not found.");

  const [dupe] = await tx
    .select({ id: bills.id })
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.supplierId, input.supplierId), eq(bills.supplierInvoiceNo, input.supplierInvoiceNo)))
    .limit(1);
  if (dupe) throw new PurchasingError(`Invoice ${input.supplierInvoiceNo} from this supplier is already recorded.`);

  const priced = input.lines.map((l) => {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new PurchasingError("Quantities must be whole numbers above zero.");
    if (!Number.isInteger(l.unitsPerUom) || l.unitsPerUom <= 0) throw new PurchasingError("Units per pack must be a whole number above zero.");
    return { ...l, landed: landedLine({ qty: l.qty, unitsPerUom: l.unitsPerUom, rateCents: l.rateCents, vatBp: input.vatBp, rateIncludesVat: input.ratesIncludeVat }) };
  });
  const totals = billTotals(priced.map((l) => ({ qty: l.qty, unitsPerUom: l.unitsPerUom, rateCents: l.rateCents, vatBp: input.vatBp, rateIncludesVat: input.ratesIncludeVat })));

  const [bill] = await tx
    .insert(bills)
    .values({
      orgId,
      supplierId: input.supplierId,
      supplierInvoiceNo: input.supplierInvoiceNo,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      ratesIncludeVat: input.ratesIncludeVat,
      vatBp: input.vatBp,
      netCents: totals.netCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
      notes: input.notes ?? null,
      memberId,
    })
    .returning({ id: bills.id });

  const inv = await acct(tx, SYS.INVENTORY);
  const cogs = await acct(tx, SYS.COGS);
  const lines: PostLine[] = [];
  let variance = 0;

  for (const l of priced) {
    const [v] = await tx.select({ id: variants.id }).from(variants).where(and(eq(variants.orgId, orgId), eq(variants.id, l.variantId))).limit(1);
    if (!v) throw new PurchasingError("A line refers to a product that no longer exists.");
    await tx.insert(billLines).values({
      orgId,
      billId: bill.id,
      variantId: l.variantId,
      supplierItemCode: l.supplierItemCode ?? null,
      qty: l.qty,
      unitsPerUom: l.unitsPerUom,
      rateCents: l.rateCents,
      units: l.landed.units,
      totalCents: l.landed.totalCents,
    });
    const r = await addStock(tx, { variantId: l.variantId, qty: l.landed.units, totalCostCents: l.landed.totalCents, date: input.invoiceDate, sourceType: "bill", sourceId: bill.id });
    variance += r.deficitVarianceCents;
    lines.push({ accountId: inv, debitCents: l.landed.totalCents, supplierId: input.supplierId });

    // Remember how this supplier names and packs the variant.
    if (l.supplierItemCode) {
      await tx
        .insert(variantSuppliers)
        .values({ orgId, variantId: l.variantId, supplierId: input.supplierId, supplierItemCode: l.supplierItemCode, unitsPerUom: l.unitsPerUom, lastCostCents: l.landed.unitCostCents })
        .onConflictDoUpdate({
          target: [variantSuppliers.orgId, variantSuppliers.supplierId, variantSuppliers.supplierItemCode],
          set: { variantId: l.variantId, unitsPerUom: l.unitsPerUom, lastCostCents: l.landed.unitCostCents },
        });
    }
  }

  lines.push({ accountId: await acct(tx, SYS.AP), creditCents: totals.totalCents, supplierId: input.supplierId, memo: input.supplierInvoiceNo });
  lines.push(...signedPair(variance, cogs, inv, "Settle oversold stock"));

  const entryId = await postEntry(tx, { date: input.invoiceDate, memo: `Bill ${input.supplierInvoiceNo}`, sourceType: "bill", sourceId: bill.id, lines });
  await tx.update(bills).set({ journalEntryId: entryId }).where(eq(bills.id, bill.id));
  return { billId: bill.id, totalCents: totals.totalCents };
}

const MONEY_ACCOUNT = { cash: SYS.CASH_AT_HAND, mpesa: SYS.MPESA_TILL, bank: SYS.BANK } as const;

/** Pays a supplier and allocates the money to their oldest unpaid bills first. */
export async function postSupplierPayment(
  tx: Tx,
  p: { supplierId: number; date: string; amountCents: number; method: keyof typeof MONEY_ACCOUNT; reference?: string | null }
): Promise<number> {
  const { orgId, memberId } = ctx();
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new PurchasingError("Enter an amount above zero.");

  const open = await tx
    .select({ id: bills.id, total: bills.totalCents, paid: bills.paidCents })
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.supplierId, p.supplierId), eq(bills.status, "posted"), sql`${bills.paidCents} < ${bills.totalCents}`))
    .orderBy(bills.dueDate, bills.id)
    .for("update");
  const owed = open.reduce((s, b) => s + (b.total - b.paid), 0);
  if (p.amountCents > owed) throw new PurchasingError(`This supplier is owed ${(owed / 100).toFixed(2)} — the payment is more than that.`);

  const [pay] = await tx
    .insert(supplierPayments)
    .values({ orgId, supplierId: p.supplierId, date: p.date, amountCents: p.amountCents, method: p.method, reference: p.reference ?? null, memberId })
    .returning({ id: supplierPayments.id });

  let left = p.amountCents;
  for (const b of open) {
    if (left === 0) break;
    const take = Math.min(left, b.total - b.paid);
    left -= take;
    await tx.insert(supplierPaymentAllocations).values({ orgId, paymentId: pay.id, billId: b.id, amountCents: take });
    await tx.update(bills).set({ paidCents: b.paid + take }).where(eq(bills.id, b.id));
  }

  const entryId = await postEntry(tx, {
    date: p.date,
    memo: `Supplier payment${p.reference ? ` ${p.reference}` : ""}`,
    sourceType: "supplier_payment",
    sourceId: pay.id,
    lines: [
      { accountId: await acct(tx, SYS.AP), debitCents: p.amountCents, supplierId: p.supplierId },
      { accountId: await acct(tx, MONEY_ACCOUNT[p.method]), creditCents: p.amountCents },
    ],
  });
  await tx.update(supplierPayments).set({ journalEntryId: entryId }).where(eq(supplierPayments.id, pay.id));
  return pay.id;
}
