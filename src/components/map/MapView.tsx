import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";
import type { TacticalMapProps } from "./TacticalMap";
import { LoadingState } from "@/components/doip/primitives";

const TacticalMap = lazy(() => import("./TacticalMap"));

export function MapView(props: TacticalMapProps) {
  return (
    <div className="relative h-full w-full overflow-hidden border border-border bg-surface">
      <ClientOnly fallback={<LoadingState label="Loading tactical map" />}>
        <Suspense fallback={<LoadingState label="Loading tactical map" />}>
          <TacticalMap {...props} />
        </Suspense>
      </ClientOnly>
    </div>
  );
}
