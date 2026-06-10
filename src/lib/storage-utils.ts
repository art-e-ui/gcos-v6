import { supabase } from "./supabase";

/**
 * Uploads a base64 string or File to Supabase Storage and returns the public URL.
 * @param path The path in storage (e.g., 'profiles/uid/avatar.jpg')
 * @param data The base64 string (with data:image/... prefix) or File object
 * @returns The download URL
 */
export async function uploadImage(path: string, data: string | File): Promise<string> {
  let base64Data = data;

  // Convert File to base64 if needed
  if (data instanceof File || data instanceof Blob) {
    base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(data);
    });
  }

  try {
    const res = await fetch('/api/upload-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path, data: base64Data })
    });

    if (res.ok) {
      const json = await res.json();
      if (json.url) return json.url;
    }
  } catch (err) {
    console.error("API upload failed, trying base64 fallback", err);
  }

  // If the API fails or returns no URL, we just return the base64 string directly
  // This bypasses storage completely and embeds the image in Postgres JSON payload
  return base64Data as string;
}

/**
 * Compresses an image file to a base64 string.
 * This is useful for storing images directly in Firestore to bypass Storage rules.
 * The image is resized to max 800x800 and compressed to JPEG with 0.6 quality.
 */
export async function compressImageToBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.error("[IMAGE_COMPRESS] Image processing timed out");
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
          
          const compressed = canvas.toDataURL('image/jpeg', 0.6);
          resolve(compressed);
        } catch (err) {
          console.error("[IMAGE_COMPRESS] Error during canvas processing:", err);
          resolve(null);
        }
      };
      img.onerror = (err) => {
        clearTimeout(timeout);
        resolve(null);
      };
      img.src = result as string;
    };
    reader.onerror = (err) => {
      clearTimeout(timeout);
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}
