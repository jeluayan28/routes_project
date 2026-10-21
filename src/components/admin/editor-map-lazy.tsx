"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { EditorMapProps } from "@/components/admin/editor-map";

// Leaflet needs `window`, so the editor map is client-only and code-split.
const EditorMap = dynamic(() => import("@/components/admin/editor-map"), {
  ssr: false,
  loading: () => (
    <div role="status" className="h-full w-full">
      <Skeleton className="h-full w-full rounded-lg" />
      <span className="sr-only">Loading map…</span>
    </div>
  ),
});

export function EditorMapLazy(props: EditorMapProps) {
  return <EditorMap {...props} />;
}
