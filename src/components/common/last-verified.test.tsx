// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LastVerified } from "@/components/common/last-verified";

describe("LastVerified", () => {
  it("shows the date a route was last verified", () => {
    render(<LastVerified at={new Date().toISOString()} />);
    expect(screen.getByText(/last verified/i)).toBeInTheDocument();
    expect(screen.queryByText(/a while ago/i)).not.toBeInTheDocument();
  });

  it("warns when the verification is older than the threshold", () => {
    render(<LastVerified at="2020-01-01T00:00:00Z" />);
    expect(screen.getByText(/a while ago/i)).toBeInTheDocument();
  });

  it("says so when there is no date", () => {
    render(<LastVerified at={null} />);
    expect(screen.getByText(/date not recorded/i)).toBeInTheDocument();
  });
});
