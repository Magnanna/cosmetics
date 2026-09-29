import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { ctx } from "./context";

export type SalesDimension = "day" | "hour" | "category" | "brand" | "product" | "cashier" | "customer_type";

export const DIMENSIONS: Record<SalesDimension, string> = {
  day: "Day",
  hour: "Hour of day",
  category: "Category",
  brand: "Brand",
  product: "Product",
  cashier: "Cashier",
  customer_type: "Retail vs wholesale",
};

export interface SalesRow {
  label: string;
  units: number;
  netCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
}

/** Sales net of returns, grouped by one dimension. Units and money exclude anything returned. */
export async function salesBy(db: DbOrTx, from: string, to: string, by: SalesDimension): Promise<SalesRow[]> {
  const { orgId } = ctx();
  const key = {
    day: sql`s.business_date`,
    hour: sql`lpad(extract(hour from s.created_at at time zone 'Africa/Nairobi')::text, 2, '0') || ':00'`,
    category: sql`coalesce(coalesce(parent.name, cat.name), 'Uncategorised')`,
    brand: sql`coalesce(b.name, 'No brand')`,
    product: sql`p.name || coalesce(' · ' || v.option1_value, '') || coalesce(' · ' || v.option2_value, '')`,
    cashier: sql`coalesce(m.name, 'Staff')`,
    customer_type: sql`case s.price_level when 'wholesale' then 'Salons / wholesale' else 'Retail' end`,
  }[by];
  const rows = await db.execute<{ label: string; units: string; net: string; cost: string }>(sql`
    with lines as (
      select sl.*, s.business_date, s.created_at, s.price_level, s.member_id,
        coalesce((select sum(r.qty) from sale_return_lines r where r.sale_line_id = sl.id), 0) as r_qty,
        coalesce((select sum(r.amount_cents) from sale_return_lines r where r.sale_line_id = sl.id), 0) as r_amount,
        coalesce((select sum(r.cost_cents) from sale_return_lines r where r.sale_line_id = sl.id), 0) as r_cost
      from sale_lines sl join sales s on s.id = sl.sale_id
      where s.org_id = ${orgId} and s.business_date between ${from} and ${to}
    )
    select ${key} as label,
      sum(s.qty - s.r_qty) as units,
      sum(s.line_total_cents - s.r_amount) as net,
      sum(s.cost_cents - s.r_cost) as cost
    from lines s
    join variants v on v.id = s.variant_id
    join products p on p.id = v.product_id
    left join brands b on b.id = p.brand_id
    left join categories cat on cat.id = p.category_id
    left join categories parent on parent.id = cat.parent_id
    left join members m on m.id = s.member_id
    group by 1
    order by ${by === "day" || by === "hour" ? sql`1` : sql`3 desc`}`);
  return rows.map((r) => {
    const net = Number(r.net);
    const cost = Number(r.cost);
    return { label: String(r.label), units: Number(r.units), netCents: net, costCents: cost, marginCents: net - cost, marginPct: net > 0 ? Math.round(((net - cost) / net) * 1000) / 10 : null };
  });
}

export interface StockRow {
  variantId: number;
  name: string;
  brand: string | null;
  qty: number;
  costCents: number;
  retailCents: number;
  lastSold: string | null;
}

export async function stockReport(db: DbOrTx): Promise<StockRow[]> {
  const { orgId } = ctx();
  const rows = await db.execute<{ variant_id: number; name: string; brand: string | null; qty: string; cost: string; retail: string; last_sold: string | null }>(sql`
    select v.id as variant_id,
      p.name || coalesce(' · ' || v.option1_value, '') || coalesce(' · ' || v.option2_value, '') as name,
      b.name as brand,
      coalesce(sum(l.remaining_qty), 0) as qty,
      coalesce(sum(l.remaining_cost_cents), 0) as cost,
      coalesce(sum(l.remaining_qty), 0) * v.retail_price_cents as retail,
      (select max(s.business_date) from sale_lines sl join sales s on s.id = sl.sale_id where sl.variant_id = v.id) as last_sold
    from variants v
    join products p on p.id = v.product_id
    left join brands b on b.id = p.brand_id
    left join stock_lots l on l.variant_id = v.id
    where v.org_id = ${orgId} and not v.archived and not p.archived
    group by v.id, p.name, b.name
    order by 5 desc`);
  return rows.map((r) => ({ variantId: r.variant_id, name: r.name, brand: r.brand, qty: Number(r.qty), costCents: Number(r.cost), retailCents: Number(r.retail), lastSold: r.last_sold }));
}
