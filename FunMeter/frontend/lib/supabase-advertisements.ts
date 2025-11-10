// lib/supabase-advertisements.ts
// Helper functions untuk integrasi dengan Supabase Storage untuk iklan

export interface Advertisement {
  id: string;
  src: string; // Path di storage, contoh: 'advertisements/image-123.jpg'
  type: 'image' | 'video';
  enabled: boolean;
  display_order: number;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  title?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdvertisementUpload {
  file: File;
  title?: string;
  description?: string;
  enabled?: boolean;
  display_order?: number;
}

/**
 * Get Supabase URL dari environment variable
 */
function getSupabaseUrl(): string {
  if (typeof window === 'undefined') return '';
  // Ambil dari environment variable atau config
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!url) {
    console.warn('[SUPABASE] NEXT_PUBLIC_SUPABASE_URL tidak di-set');
  }
  return url;
}

/**
 * Get Supabase anon key dari environment variable
 */
function getSupabaseAnonKey(): string {
  if (typeof window === 'undefined') return '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!key) {
    console.warn('[SUPABASE] NEXT_PUBLIC_SUPABASE_ANON_KEY tidak di-set');
  }
  return key;
}

/**
 * Build public URL untuk file di Supabase Storage
 */
export function getAdvertisementPublicUrl(filePath: string): string {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    // Fallback: return path saja jika URL tidak di-set
    return `/storage/v1/object/public/advertisements/${filePath}`;
  }
  return `${supabaseUrl}/storage/v1/object/public/advertisements/${filePath}`;
}

/**
 * Fetch semua iklan aktif dari Supabase
 */
export async function fetchActiveAdvertisements(): Promise<Advertisement[]> {
  try {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase URL tidak dikonfigurasi');
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/advertisements_active`, {
      headers: {
        'apikey': getSupabaseAnonKey(),
        'Authorization': `Bearer ${getSupabaseAnonKey()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch advertisements: ${response.statusText}`);
    }

    const data = await response.json();
    return data.map((ad: any) => ({
      ...ad,
      src: getAdvertisementPublicUrl(ad.src), // Convert path ke full URL
    }));
  } catch (error) {
    console.error('[SUPABASE] Error fetching advertisements:', error);
    throw error;
  }
}

/**
 * Fetch semua iklan (termasuk yang disabled) - untuk admin
 */
export async function fetchAllAdvertisements(): Promise<Advertisement[]> {
  try {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase URL tidak dikonfigurasi');
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/advertisements?order=display_order.asc,created_at.asc`, {
      headers: {
        'apikey': getSupabaseAnonKey(),
        'Authorization': `Bearer ${getSupabaseAnonKey()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch advertisements: ${response.statusText}`);
    }

    const data = await response.json();
    return data.map((ad: any) => ({
      ...ad,
      src: getAdvertisementPublicUrl(ad.src), // Convert path ke full URL
    }));
  } catch (error) {
    console.error('[SUPABASE] Error fetching all advertisements:', error);
    throw error;
  }
}

/**
 * Upload file ke Supabase Storage dan create record di database
 * Note: Perlu authentication token untuk admin
 */
export async function uploadAdvertisement(
  upload: AdvertisementUpload,
  authToken: string
): Promise<Advertisement> {
  try {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase URL tidak dikonfigurasi');
    }

    // 1. Upload file ke storage
    const fileExt = upload.file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `advertisements/${fileName}`;

    // Upload ke storage
    const formData = new FormData();
    formData.append('file', upload.file);

    const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/advertisements/${filePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Failed to upload file: ${uploadResponse.statusText} - ${errorText}`);
    }

    // 2. Create record di database
    const dbRecord = {
      src: filePath,
      type: upload.file.type.startsWith('image/') ? 'image' : 'video',
      enabled: upload.enabled ?? true,
      display_order: upload.display_order ?? 0,
      file_name: upload.file.name,
      file_size: upload.file.size,
      mime_type: upload.file.type,
      title: upload.title,
      description: upload.description,
    };

    const dbResponse = await fetch(`${supabaseUrl}/rest/v1/advertisements`, {
      method: 'POST',
      headers: {
        'apikey': getSupabaseAnonKey(),
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(dbRecord),
    });

    if (!dbResponse.ok) {
      // Rollback: delete file dari storage jika database insert gagal
      await fetch(`${supabaseUrl}/storage/v1/object/advertisements/${filePath}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      throw new Error(`Failed to create advertisement record: ${dbResponse.statusText}`);
    }

    const created = await dbResponse.json();
    const advertisement = Array.isArray(created) ? created[0] : created;

    return {
      ...advertisement,
      src: getAdvertisementPublicUrl(advertisement.src),
    };
  } catch (error) {
    console.error('[SUPABASE] Error uploading advertisement:', error);
    throw error;
  }
}

/**
 * Update iklan (metadata saja, bukan file)
 */
export async function updateAdvertisement(
  id: string,
  updates: Partial<Pick<Advertisement, 'enabled' | 'display_order' | 'title' | 'description'>>,
  authToken: string
): Promise<Advertisement> {
  try {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase URL tidak dikonfigurasi');
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/advertisements?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': getSupabaseAnonKey(),
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`Failed to update advertisement: ${response.statusText}`);
    }

    const updated = await response.json();
    const advertisement = Array.isArray(updated) ? updated[0] : updated;

    return {
      ...advertisement,
      src: getAdvertisementPublicUrl(advertisement.src),
    };
  } catch (error) {
    console.error('[SUPABASE] Error updating advertisement:', error);
    throw error;
  }
}

/**
 * Delete iklan (hapus file dan record)
 */
export async function deleteAdvertisement(
  id: string,
  authToken: string
): Promise<void> {
  try {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase URL tidak dikonfigurasi');
    }

    // 1. Get file path dari database
    const getResponse = await fetch(`${supabaseUrl}/rest/v1/advertisements?id=eq.${id}&select=src`, {
      headers: {
        'apikey': getSupabaseAnonKey(),
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!getResponse.ok) {
      throw new Error(`Failed to get advertisement: ${getResponse.statusText}`);
    }

    const data = await getResponse.json();
    if (!data || data.length === 0) {
      throw new Error('Advertisement not found');
    }

    const filePath = data[0].src;

    // 2. Delete file dari storage
    const deleteFileResponse = await fetch(`${supabaseUrl}/storage/v1/object/advertisements/${filePath}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    // Continue even if file delete fails (might already be deleted)
    if (!deleteFileResponse.ok && deleteFileResponse.status !== 404) {
      console.warn('[SUPABASE] Failed to delete file from storage:', deleteFileResponse.statusText);
    }

    // 3. Delete record dari database
    const deleteDbResponse = await fetch(`${supabaseUrl}/rest/v1/advertisements?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        'apikey': getSupabaseAnonKey(),
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!deleteDbResponse.ok) {
      throw new Error(`Failed to delete advertisement record: ${deleteDbResponse.statusText}`);
    }
  } catch (error) {
    console.error('[SUPABASE] Error deleting advertisement:', error);
    throw error;
  }
}

/**
 * Reorder iklan (update display_order)
 */
export async function reorderAdvertisements(
  orders: Array<{ id: string; display_order: number }>,
  authToken: string
): Promise<void> {
  try {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase URL tidak dikonfigurasi');
    }

    // Update semua dalam satu transaction (jika memungkinkan)
    // Atau update satu per satu
    await Promise.all(
      orders.map(({ id, display_order }) =>
        fetch(`${supabaseUrl}/rest/v1/advertisements?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'apikey': getSupabaseAnonKey(),
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ display_order }),
        })
      )
    );
  } catch (error) {
    console.error('[SUPABASE] Error reordering advertisements:', error);
    throw error;
  }
}

