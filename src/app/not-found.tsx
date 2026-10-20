import Link from "next/link";
import { MapPinOff } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <EmptyState
        icon={MapPinOff}
        title="Page not found"
        description="That page or route doesn't exist, or it may have been removed."
        action={
          <Link href="/explore" className={buttonVariants()}>
            Explore routes
          </Link>
        }
      />
    </div>
  );
}
