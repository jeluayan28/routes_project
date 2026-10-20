import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type ErrorMessageProps = {
  title?: string;
  message: string;
  action?: ReactNode;
};

/** Announced to assistive tech; red is reserved for errors and warnings. */
export function ErrorMessage({ title = "Something went wrong", message, action }: ErrorMessageProps) {
  return (
    <Alert variant="destructive" role="alert">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {action && <div className="mt-3">{action}</div>}
      </AlertDescription>
    </Alert>
  );
}
