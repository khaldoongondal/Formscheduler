import Link from "next/link";
import { PLAN_COPY, isUpgradeableLimitMessage } from "@/lib/billing/plan-copy";

/** "See plans and upgrade" under a free-plan limit message; renders nothing for any other message. */
export function UpgradeHint({ message }: { message: string | null | undefined }) {
  if (!isUpgradeableLimitMessage(message)) return null;
  return (
    <p className="mt-1">
      <Link href="/admin/plan" className="text-sm font-semibold text-emerald-700 hover:underline">
        {PLAN_COPY.upgradeHint}
      </Link>
    </p>
  );
}
