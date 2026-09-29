import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { LockForm } from "../forms";

export default async function BooksLockPage() {
  const s = await requirePage("books.lock");
  return (
    <>
      <PageHeader title="Close the books" subtitle="Once a month is checked and Turnover Tax is filed, close it so nothing can change it." />
      <LockForm lockDate={s.org.lockDate} />
    </>
  );
}
