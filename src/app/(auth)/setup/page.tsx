import { redirect } from "next/navigation";
import { ownerExists } from "./actions";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await ownerExists()) redirect("/login");
  return <SetupForm />;
}
