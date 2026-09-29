/**
 * Chart of accounts for a non-VAT cosmetics shop on Turnover Tax.
 * Codes are stable — the ledger references system accounts by code.
 */

export const SYS = {
  CASH_DRAWER: "1000",
  CASH_AT_HAND: "1010",
  MPESA_TILL: "1020",
  BANK: "1030",
  AR: "1200",
  INVENTORY: "1400",
  AP: "2100",
  LOYALTY_LIABILITY: "2200",
  EXCHANGE_CREDIT: "2250",
  TOT_PAYABLE: "2300",
  SALARIES_PAYABLE: "2400",
  OWNER_EQUITY: "3000",
  DRAWINGS: "3100",
  RETAINED: "3200",
  OPENING_BALANCE: "3900",
  SALES_RETAIL: "4000",
  SALES_WHOLESALE: "4010",
  SALES_RETURNS: "4100",
  PROMO_DISCOUNTS: "4110",
  MANUAL_DISCOUNTS: "4120",
  COGS: "5000",
  STOCK_LOSS: "5100",
  CASH_OVER_SHORT: "5200",
  LOYALTY_EXPENSE: "6100",
  TOT_EXPENSE: "6200",
  SMS_EXPENSE: "6300",
  OTHER_EXPENSE: "6900",
} as const;

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface AccountSeed {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  description: string;
  system?: boolean;
}

export const SEED_ACCOUNTS: AccountSeed[] = [
  // Assets
  { code: "1000", name: "Cash Drawer", type: "asset", subtype: "cash", description: "Cash physically in the till drawer during trading.", system: true },
  { code: "1010", name: "Cash at Hand", type: "asset", subtype: "cash", description: "Cash taken out of the drawer at cash-up and held before banking.", system: true },
  { code: "1020", name: "M-Pesa Till", type: "asset", subtype: "bank", description: "Money received on the shop's M-Pesa Till number.", system: true },
  { code: "1030", name: "Bank Account", type: "asset", subtype: "bank", description: "The shop's bank account.", system: true },
  { code: "1200", name: "Accounts Receivable", type: "asset", subtype: "receivable", description: "Money owed by credit customers (salons, wholesale, retail on account).", system: true },
  { code: "1400", name: "Inventory", type: "asset", subtype: "stock", description: "Stock on hand at FIFO cost, including supplier VAT (not claimable).", system: true },
  { code: "1500", name: "Shop Equipment", type: "asset", subtype: "fixed_asset", description: "Shelving, till PC, printer, scanner, fittings." },
  // Liabilities
  { code: "2100", name: "Accounts Payable", type: "liability", subtype: "payable", description: "Money owed to suppliers for stock bought on credit.", system: true },
  { code: "2200", name: "Loyalty Points Liability", type: "liability", subtype: "current", description: "Value of loyalty points customers have earned but not yet spent.", system: true },
  { code: "2250", name: "Exchange Credit", type: "liability", subtype: "current", description: "Value of returned items a customer can still spend on an exchange.", system: true },
  { code: "2300", name: "Turnover Tax Payable", type: "liability", subtype: "current", description: "Turnover Tax owed to KRA, due by the 20th of the following month.", system: true },
  { code: "2400", name: "Salaries Payable", type: "liability", subtype: "current", description: "Net salaries owed to staff.", system: true },
  // Equity
  { code: "3000", name: "Owner's Equity", type: "equity", subtype: "equity", description: "Money the owner has put into the business.", system: true },
  { code: "3100", name: "Owner's Drawings", type: "equity", subtype: "equity", description: "Money the owner has taken out of the business for personal use.", system: true },
  { code: "3200", name: "Retained Earnings", type: "equity", subtype: "equity", description: "Accumulated profits from previous periods.", system: true },
  { code: "3900", name: "Opening Balance Equity", type: "equity", subtype: "equity", description: "Balancing account for opening stock and balances at go-live.", system: true },
  // Income
  { code: "4000", name: "Sales – Retail", type: "income", subtype: "sales", description: "Sales to retail customers.", system: true },
  { code: "4010", name: "Sales – Wholesale", type: "income", subtype: "sales", description: "Sales to salons and wholesale customers.", system: true },
  { code: "4100", name: "Sales Returns", type: "income", subtype: "contra_sales", description: "Refunds and exchanges given back to customers.", system: true },
  { code: "4110", name: "Promotional Discounts", type: "income", subtype: "contra_sales", description: "Price reductions from scheduled offers.", system: true },
  { code: "4120", name: "Manual Discounts", type: "income", subtype: "contra_sales", description: "Discounts given at the till by cashiers or the owner.", system: true },
  // Cost of sales
  { code: "5000", name: "Cost of Goods Sold", type: "expense", subtype: "cogs", description: "FIFO cost of stock sold.", system: true },
  { code: "5100", name: "Stock Loss & Shrinkage", type: "expense", subtype: "cogs", description: "Damaged, lost or missing stock, and stock-take differences.", system: true },
  { code: "5200", name: "Cash Over/Short", type: "expense", subtype: "other", description: "Differences found when counting the till at cash-up.", system: true },
  // Expenses
  { code: "6000", name: "Rent", type: "expense", subtype: "operating", description: "Shop rent." },
  { code: "6010", name: "Salaries & Wages", type: "expense", subtype: "operating", description: "Staff pay." },
  { code: "6020", name: "Electricity & Water", type: "expense", subtype: "operating", description: "Utilities." },
  { code: "6030", name: "Transport & Delivery", type: "expense", subtype: "operating", description: "Stock pickup, deliveries, fares." },
  { code: "6040", name: "Packaging & Bags", type: "expense", subtype: "operating", description: "Shopping bags, wrapping, receipt rolls." },
  { code: "6050", name: "Airtime & Internet", type: "expense", subtype: "operating", description: "Shop internet and phone." },
  { code: "6060", name: "Repairs & Maintenance", type: "expense", subtype: "operating", description: "Fixing equipment and the shop." },
  { code: "6070", name: "Bank & M-Pesa Charges", type: "expense", subtype: "operating", description: "Transaction and withdrawal fees." },
  { code: "6100", name: "Loyalty Rewards", type: "expense", subtype: "marketing", description: "Cost of loyalty points issued to customers.", system: true },
  { code: "6200", name: "Turnover Tax", type: "expense", subtype: "tax", description: "Monthly Turnover Tax on gross sales.", system: true },
  { code: "6300", name: "SMS & Marketing", type: "expense", subtype: "marketing", description: "SMS receipts, reminders and promotions.", system: true },
  { code: "6900", name: "Other Expenses", type: "expense", subtype: "operating", description: "Anything that doesn't fit elsewhere.", system: true },
];

/** Default category tree for a cosmetics shop (from Bestlady-style ranges). */
export const SEED_CATEGORIES: { name: string; children?: string[] }[] = [
  { name: "Hair", children: ["Relaxers", "Shampoo & Conditioner", "Treatments", "Hair Colour", "Oils & Food", "Styling", "Braids & Extensions"] },
  { name: "Skin care", children: ["Lotions & Creams", "Face Care", "Soaps & Body Wash", "Sun Care"] },
  { name: "Makeup", children: ["Foundation", "Powder", "Lips", "Eyes", "Brows"] },
  { name: "Nails" },
  { name: "Perfumes & deodorants" },
  { name: "Bath" },
  { name: "Baby care" },
  { name: "Shaving & hair removal" },
  { name: "Sanitary" },
  { name: "Jewelry" },
  { name: "Innerwear" },
  { name: "Equipment & accessories" },
];
