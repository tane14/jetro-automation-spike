import { createContext, useContext, type ReactNode } from "react";
import type { ControlPlaneDataSource } from "../adapters/ControlPlaneDataSource.ts";

const DataSourceContext = createContext<ControlPlaneDataSource | null>(null);

export function DataSourceProvider({
  source,
  children,
}: {
  source: ControlPlaneDataSource;
  children: ReactNode;
}) {
  return (
    <DataSourceContext.Provider value={source}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource(): ControlPlaneDataSource {
  const source = useContext(DataSourceContext);
  if (!source) {
    throw new Error("ControlPlaneDataSource is not available");
  }
  return source;
}
