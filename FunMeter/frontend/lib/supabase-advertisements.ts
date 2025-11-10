// lib/supabase-advertisements.ts
// Helper functions untuk integrasi dengan Backend API untuk iklan
// Backend akan handle Supabase Storage dan Database

import { request, postForm } from './api';

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
 * Build public URL untuk file di Supabase Storage
 * Note: URL sudah di-build oleh backend, jadi fungsi ini hanya untuk fallback
 */
export function getAdvertisementPublicUrl(filePath: string): string {
  // URL sudah di-build oleh backend, return as-is jika sudah full URL
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }
  // Fallback: build URL manual
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (supabaseUrl) {
    return `${supabaseUrl}/storage/v1/object/public/advertisements/${filePath}`;
  }
  return `/storage/v1/object/public/advertisements/${filePath}`;
}

/**
 * Fetch semua iklan aktif dari Backend API (public endpoint)
 */
export async function fetchActiveAdvertisements(): Promise<Advertisement[]> {
  try {
    const response = await request<Advertisement[]>('/admin/advertisements/active');
    return response || [];
  } catch (error) {
    console.error('[API] Error fetching active advertisements:', error);
    // Return empty array untuk public endpoint (jangan throw error)
    return [];
  }
}

/**
 * Fetch semua iklan (termasuk yang disabled) - untuk admin
 */
export async function fetchAllAdvertisements(): Promise<Advertisement[]> {
  try {
    const response = await request<Advertisement[]>('/admin/advertisements');
    return response || [];
  } catch (error) {
    console.error('[API] Error fetching all advertisements:', error);
    throw error;
  }
}

/**
 * Upload file ke Backend API (backend akan handle Supabase Storage dan Database)
 */
export async function uploadAdvertisement(
  upload: AdvertisementUpload
): Promise<Advertisement> {
  try {
    // Create FormData untuk multipart/form-data
    const formData = new FormData();
    formData.append('file', upload.file);
    if (upload.title) formData.append('title', upload.title);
    if (upload.description) formData.append('description', upload.description);
    formData.append('enabled', String(upload.enabled ?? true));
    formData.append('display_order', String(upload.display_order ?? 0));

    // Upload ke backend API menggunakan postForm untuk handle FormData dengan benar
    const response = await postForm<Advertisement>('/admin/advertisements', formData);

    return response;
  } catch (error) {
    console.error('[API] Error uploading advertisement:', error);
    throw error;
  }
}

/**
 * Update iklan (metadata saja, bukan file)
 */
export async function updateAdvertisement(
  id: string,
  updates: Partial<Pick<Advertisement, 'enabled' | 'display_order' | 'title' | 'description'>>
): Promise<Advertisement> {
  try {
    const response = await request<Advertisement>(`/admin/advertisements/${id}`, {
      method: 'PUT',
      body: updates,
    });

    return response;
  } catch (error) {
    console.error('[API] Error updating advertisement:', error);
    throw error;
  }
}

/**
 * Delete iklan (hapus file dan record)
 */
export async function deleteAdvertisement(id: string): Promise<void> {
  try {
    await request(`/admin/advertisements/${id}`, {
      method: 'DELETE',
    });
  } catch (error) {
    console.error('[API] Error deleting advertisement:', error);
    throw error;
  }
}

/**
 * Reorder iklan (update display_order)
 */
export async function reorderAdvertisements(
  orders: Array<{ id: string; display_order: number }>
): Promise<void> {
  try {
    await request('/admin/advertisements/reorder', {
      method: 'PATCH',
      body: { orders },
    });
  } catch (error) {
    console.error('[API] Error reordering advertisements:', error);
    throw error;
  }
}

