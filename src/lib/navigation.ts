export const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/explore", label: "Explore Routes" },
  { href: "/fares", label: "Fare Guide" },
  { href: "/about", label: "About" },
] as const;

/** Primary call to action, shown beside the links rather than among them. */
export const SEARCH_ITEM = { href: "/search", label: "Find a route" } as const;

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
