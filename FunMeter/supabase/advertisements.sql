-- ============================================
-- Supabase SQL Schema for Advertisements
-- Storage untuk menyimpan iklan (gambar/video)
-- ============================================

-- 1. Create Storage Bucket untuk iklan
-- Jalankan di Supabase Dashboard > Storage > Create Bucket
-- Atau gunakan SQL berikut:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'advertisements',
  'advertisements',
  true, -- Public bucket agar bisa diakses langsung
  52428800, -- 50MB limit per file
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Create Table untuk metadata iklan
CREATE TABLE IF NOT EXISTS public.advertisements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  src TEXT NOT NULL, -- Path/URL ke file di storage (contoh: 'advertisements/image-123.jpg')
  type TEXT NOT NULL CHECK (type IN ('image', 'video')),
  enabled BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0, -- Urutan tampil (0 = pertama)
  file_name TEXT, -- Nama file asli saat upload
  file_size BIGINT, -- Ukuran file dalam bytes
  mime_type TEXT, -- MIME type (image/jpeg, video/mp4, dll)
  title TEXT, -- Judul iklan (opsional)
  description TEXT, -- Deskripsi iklan (opsional)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 3. Create Index untuk performa query
CREATE INDEX IF NOT EXISTS idx_advertisements_enabled ON public.advertisements(enabled);
CREATE INDEX IF NOT EXISTS idx_advertisements_display_order ON public.advertisements(display_order);
CREATE INDEX IF NOT EXISTS idx_advertisements_type ON public.advertisements(type);
CREATE INDEX IF NOT EXISTS idx_advertisements_created_at ON public.advertisements(created_at DESC);

-- 4. Create Function untuk auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_advertisements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create Trigger untuk auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_advertisements_updated_at ON public.advertisements;
CREATE TRIGGER trigger_update_advertisements_updated_at
  BEFORE UPDATE ON public.advertisements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_advertisements_updated_at();

-- 6. Row Level Security (RLS) Policies
ALTER TABLE public.advertisements ENABLE ROW LEVEL SECURITY;

-- Policy: Semua orang bisa membaca iklan yang enabled (public)
CREATE POLICY "Public can view enabled advertisements"
  ON public.advertisements
  FOR SELECT
  USING (enabled = true);

-- Policy: Admin bisa membaca semua iklan
CREATE POLICY "Admins can view all advertisements"
  ON public.advertisements
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Admin bisa insert iklan baru
CREATE POLICY "Admins can insert advertisements"
  ON public.advertisements
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Admin bisa update iklan
CREATE POLICY "Admins can update advertisements"
  ON public.advertisements
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Admin bisa delete iklan
CREATE POLICY "Admins can delete advertisements"
  ON public.advertisements
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- 7. Storage Policies untuk bucket 'advertisements'
-- Policy: Semua orang bisa membaca file (public bucket)
CREATE POLICY "Public can view advertisement files"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'advertisements');

-- Policy: Admin bisa upload file
CREATE POLICY "Admins can upload advertisement files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'advertisements'
    AND (
      EXISTS (
        SELECT 1 FROM auth.users
        WHERE auth.users.id = auth.uid()
        AND auth.users.raw_user_meta_data->>'role' = 'admin'
      )
    )
  );

-- Policy: Admin bisa update file
CREATE POLICY "Admins can update advertisement files"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'advertisements'
    AND (
      EXISTS (
        SELECT 1 FROM auth.users
        WHERE auth.users.id = auth.uid()
        AND auth.users.raw_user_meta_data->>'role' = 'admin'
      )
    )
  );

-- Policy: Admin bisa delete file
CREATE POLICY "Admins can delete advertisement files"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'advertisements'
    AND (
      EXISTS (
        SELECT 1 FROM auth.users
        WHERE auth.users.id = auth.uid()
        AND auth.users.raw_user_meta_data->>'role' = 'admin'
      )
    )
  );

-- 8. Function untuk mendapatkan URL public file
CREATE OR REPLACE FUNCTION public.get_advertisement_url(file_path TEXT)
RETURNS TEXT AS $$
DECLARE
  supabase_url TEXT;
BEGIN
  -- Ambil URL Supabase dari environment variable atau set manual
  -- Format: https://[project-ref].supabase.co/storage/v1/object/public/advertisements/[file_path]
  SELECT current_setting('app.supabase_url', true) INTO supabase_url;
  
  IF supabase_url IS NULL OR supabase_url = '' THEN
    -- Fallback: return path saja, frontend akan handle URL building
    RETURN '/storage/v1/object/public/advertisements/' || file_path;
  END IF;
  
  RETURN supabase_url || '/storage/v1/object/public/advertisements/' || file_path;
END;
$$ LANGUAGE plpgsql STABLE;

-- 9. View untuk iklan yang aktif (untuk frontend)
CREATE OR REPLACE VIEW public.advertisements_active AS
SELECT 
  id,
  src,
  type,
  display_order,
  file_name,
  title,
  description,
  created_at,
  updated_at
FROM public.advertisements
WHERE enabled = true
ORDER BY display_order ASC, created_at ASC;

-- 10. Grant permissions
GRANT SELECT ON public.advertisements TO anon, authenticated;
GRANT SELECT ON public.advertisements_active TO anon, authenticated;
GRANT ALL ON public.advertisements TO authenticated;

-- ============================================
-- Contoh Query untuk Testing
-- ============================================

-- Insert contoh iklan (setelah upload file ke storage)
-- INSERT INTO public.advertisements (src, type, enabled, display_order, file_name, file_size, mime_type, title)
-- VALUES 
--   ('advertisements/banner-1.jpg', 'image', true, 1, 'banner-1.jpg', 102400, 'image/jpeg', 'Banner Promosi'),
--   ('advertisements/video-1.mp4', 'video', true, 2, 'video-1.mp4', 5242880, 'video/mp4', 'Video Iklan');

-- Get semua iklan aktif
-- SELECT * FROM public.advertisements_active;

-- Get iklan untuk admin (termasuk yang disabled)
-- SELECT * FROM public.advertisements ORDER BY display_order, created_at;

