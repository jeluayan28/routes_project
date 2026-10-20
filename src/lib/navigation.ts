export const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/explore", label: "Explore Routes" },
  { href: "/fares", label: "Fare Guide" },
  { href: "/about", label: "About" },
] as const;

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
