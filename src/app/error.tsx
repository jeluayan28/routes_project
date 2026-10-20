"use client";

import { ErrorMessage } from "@/components/common/error-message";
import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <ErrorMessage
        message="An unexpected error occurred while loading this page. Please try again."
        action={
          <Button type="button" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
