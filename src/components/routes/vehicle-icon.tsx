import { Bus, Van, type LucideIcon } from "lucide-react";
import type { VehicleType } from "@/lib/validation/transport";

const ICONS: Record<VehicleType, LucideIcon> = {
  jeepney: Bus,
  multicab: Van,
};

export function VehicleIcon({ type, className }: { type: VehicleType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon aria-hidden="true" className={className} />;
}
