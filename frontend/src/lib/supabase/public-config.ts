// Public browser settings for the XOCRISK production project, not server credentials.
// Keep these defaults available when a deployment omits NEXT_PUBLIC_* at build time.
const productionUrl = "https://ufyfhcboglcnfdxarysr.supabase.co";
const productionPublishableKey = "sb_publishable_1tusT3a0XoJ_df2o2DmeIA_T7JpjPuj";

export function resolveSupabasePublicConfig(url?: string, anonKey?: string, publishableKey?: string) {
  const projectUrl = url?.trim().replace(/\/+$/, "") || productionUrl;
  // Never pair another project's URL with XOCRISK's default key.
  const key = anonKey?.trim() || publishableKey?.trim()
    || (projectUrl === productionUrl ? productionPublishableKey : undefined);
  return { url: projectUrl, key };
}
