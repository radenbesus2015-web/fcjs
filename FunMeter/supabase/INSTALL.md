# Install Supabase Package

Sebelum menggunakan fungsi-fungsi Supabase, install package terlebih dahulu:

```bash
cd FunMeter/frontend
npm install @supabase/supabase-js
```

Atau jika menggunakan yarn:

```bash
cd FunMeter/frontend
yarn add @supabase/supabase-js
```

Setelah install, pastikan environment variables sudah di-set di `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Selesai! File `supabase-advertisements.ts` sudah siap digunakan.

