import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { SeasonalThemeContext, type SeasonalDecorations } from "./seasonal-theme-context-hooks";

interface SeasonalTheme {
  id: string;
  slug: string;
  name: string;
  decorations: SeasonalDecorations;
  is_active: boolean;
}

export function SeasonalThemeProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery<SeasonalTheme | null>({
    queryKey: ["active-seasonal-theme"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seasonal_themes")
        .select("*")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data as SeasonalTheme | null;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000, // refresh every 5 minutes
  });

  const slug = data?.slug ?? "none";
  const decorations = (data?.decorations as SeasonalDecorations) ?? {};

  return (
    <SeasonalThemeContext.Provider
      value={{
        slug,
        name: data?.name ?? "None",
        decorations,
        isActive: slug !== "none",
      }}
    >
      {children}
    </SeasonalThemeContext.Provider>
  );
}

