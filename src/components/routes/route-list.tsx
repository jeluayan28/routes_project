import { RouteCard } from "@/components/routes/route-card";
import type { Route } from "@/lib/validation/route";

type RouteListProps = {
  routes: readonly Route[];
  selectedId?: string | null;
  onSelect?: (route: Route) => void;
  label: string;
};

export function RouteList({ routes, selectedId, onSelect, label }: RouteListProps) {
  return (
    <ul aria-label={label} className="space-y-3">
      {routes.map((route) => (
        <li key={route.id}>
          <RouteCard route={route} selected={route.id === selectedId} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
