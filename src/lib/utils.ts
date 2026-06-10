import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import React from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getProductPlaceholder(name?: string): string {
  // Return the unified local placeholder to maintain UI consistency for missing/broken images
  return "/placeholder.svg";
}

export function getRawImageUrl(url: string): string {
  if (!url) return "";
  const str = String(url).trim();
  if (str.includes('/api/proxy-image?url=')) {
    try {
      const parts = str.split('/api/proxy-image?url=');
      if (parts.length > 1) {
        return decodeURIComponent(parts[1]);
      }
    } catch { /* ignore */ }
  }
  return str;
}

export function handleImageError(e: React.SyntheticEvent<HTMLImageElement>, rawUrl?: string) {
  const img = e.target as HTMLImageElement;
  
  if (img.dataset.fallback === "failed") {
    return;
  }

  if (img.src.includes('/api/proxy-image')) {
    let fallbackUrl = rawUrl || "";
    if (fallbackUrl.includes('/api/proxy-image?url=')) {
      fallbackUrl = getRawImageUrl(fallbackUrl);
    }
    if (fallbackUrl && (fallbackUrl.startsWith('http://') || fallbackUrl.startsWith('https://'))) {
      img.src = fallbackUrl;
      return;
    }
  }
  
  img.dataset.fallback = "failed";
  img.src = "/placeholder.svg";
}

export function parseImageUrl(url: unknown, nameFallback?: string): string {
  if (!url) return getProductPlaceholder(nameFallback);
  let extracted = "";
  if (Array.isArray(url)) {
    if (url.length === 0) return getProductPlaceholder(nameFallback);
    const firstUrl = url[0];
    if (typeof firstUrl === "string" && firstUrl.trim().startsWith('[')) {
      try {
         const nested = JSON.parse(firstUrl);
         if (Array.isArray(nested) && nested.length > 0) extracted = String(nested[0]);
      } catch { /* ignore */ }
    } else {
      extracted = String(firstUrl);
    }
  } else {
    const strUrl = String(url).trim();
    if (strUrl.startsWith('[')) {
      try {
        const parsed = JSON.parse(strUrl.replace(/'/g, '"'));
        if (Array.isArray(parsed) && parsed.length > 0) {
          const firstUrl = String(parsed[0]);
          if (firstUrl.trim().startsWith('[')) {
            try {
              const doubleParsed = JSON.parse(firstUrl.replace(/'/g, '"'));
              if (Array.isArray(doubleParsed) && doubleParsed.length > 0) {
                extracted = String(doubleParsed[0]);
              }
            } catch { /* ignore */ }
          }
          if (!extracted) extracted = firstUrl;
        }
      } catch {
        // Fallback: strip brackets and quotes
        extracted = strUrl.replace(/^\[\s*['"]?/, '').replace(/['"]?\s*\]$/, '').split(',')[0].replace(/['"]/g, '').trim();
      }
    } else {
      extracted = strUrl;
    }
  }

  // Unwrap any local proxy prefix first to get the clean raw URL
  extracted = getRawImageUrl(extracted);

  // Handle known dead image domains and empty strings
  if (
    !extracted ||
    extracted === '/placeholder.svg' ||
    extracted.includes('placehold.co') ||
    extracted.includes('placeimg.com') ||
    extracted.includes('imgur.com') ||
    extracted.includes('ui-avatars.com') ||
    extracted.includes('picsum.photos') 
  ) {
    return getProductPlaceholder(nameFallback || extracted);
  }
  
  // Wrap any external absolute image URLs through our safe local proxy to avoid browser CORS/referrer/access restrictions
  if (extracted.startsWith('http://') || extracted.startsWith('https://')) {
    return `/api/proxy-image?url=${encodeURIComponent(extracted.trim())}`;
  }
  
  return extracted.trim();
}

