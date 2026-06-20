"use client";

import { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const convex = new ConvexReactClient(url);

export function Providers({ children }: { children: ReactNode }) {
  if (!url) {
    return (
      <div className="p-8 text-sm text-red-600">
        Missing NEXT_PUBLIC_CONVEX_URL. Add it to .env.local.
      </div>
    );
  }
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
