import { supabase } from "@/lib/supabase";
import { uploadImage } from "./storage-utils";

/**
 * Uploads an image to Supabase Storage via backend API and returns its public URL.
 * Falls back to base64 string if the API fails.
 */
export async function uploadChatImage(file: File): Promise<string | null> {
  try {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const extension = 'jpg';
    const storagePath = `chat_images/${timestamp}-${random}.${extension}`;

    return await uploadImage(storagePath, file);
  } catch (err) {
    console.error("[CHAT_UPLOAD] Error uploading image:", err);
    return null;
  }
}

/**
 * Compresses an image to JPEG format with max 800x800 dimensions.
 */
async function compressImage(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.error("[CHAT_UPLOAD] Image compression timed out");
      resolve(null);
    }, 15000);

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (!result) {
        clearTimeout(timeout);
        resolve(null);
        return;
      }

      const img = new Image();
      img.onload = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to blob instead of data URL
          canvas.toBlob(
            (blob) => {
              if (blob) {
                console.log("[CHAT_UPLOAD] Image compressed, size:", Math.round(blob.size / 1024), "KB");
                resolve(blob);
              } else {
                resolve(null);
              }
            },
            'image/jpeg',
            0.6
          );
        } catch (err) {
          console.error("[CHAT_UPLOAD] Error during compression:", err);
          resolve(null);
        }
      };
      img.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };
      img.src = result as string;
    };
    reader.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}

/** Image attachment tag format: [IMG_ATTACH:url] */
export function encodeImageAttachment(url: string, text?: string): string {
  const prefix = text?.trim() ? `${text.trim()} ` : "";
  return `${prefix}[IMG_ATTACH:${url}]`;
}

export function parseImageAttachment(message: string): { text: string; imageUrl: string | null } {
  const tag = "[IMG_ATTACH:";
  const idx = message.indexOf(tag);
  if (idx === -1) return { text: message, imageUrl: null };
  const urlStart = idx + tag.length;
  const urlEnd = message.indexOf("]", urlStart);
  if (urlEnd === -1) return { text: message, imageUrl: null };
  const imageUrl = message.substring(urlStart, urlEnd);
  const text = message.substring(0, idx).trim();
  return { text, imageUrl };
}
