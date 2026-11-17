# PATCH 1 — KEGIATAN DAN JADWAL POSYANDU

Paket ini adalah patch awal dari proyek Posyandu Karangsatria versi Vercel.

## Perubahan
- Menambahkan tabel `public.posyandu_events` melalui SQL migrasi tambahan.
- Kader/admin yang memiliki akses lokasi dapat membuat kegiatan dan membatalkan jadwal melalui Supabase.
- Akun keluarga dapat membaca jadwal pada lokasi keluarga melalui kebijakan RLS.
- Saat Supabase aktif, pesan sukses hanya ditampilkan setelah operasi database berhasil.
- Kode JavaScript `services.js` telah diperiksa dengan `node --check`.

## PENTING — sebelum memasang
1. Backup database Supabase terlebih dahulu.
2. Jangan jalankan ulang `SUPABASE_SCHEMA_POSYANDU_KARANGSATRIA.sql` pada database yang sudah berisi data.
3. Buka `supabase-config.js` dan pastikan URL serta publishable/anon key sesuai project aktif. Jangan masukkan service_role atau sb_secret key.
4. Jangan bagikan `.env.local`, token Vercel, password, OTP, atau secret key.
5. Jalankan `MIGRASI_KEGIATAN_JADWAL.sql` SATU KALI di Supabase SQL Editor.
6. Setelah migrasi berhasil, deploy isi paket ini melalui alur Vercel yang biasa digunakan.

## Uji penerimaan
1. Masuk sebagai kader uji yang sudah ditugaskan ke lokasi.
2. Buka Kader → Jadwal Posyandu.
3. Tambahkan jadwal uji dengan tanggal mendatang.
4. Pastikan pesan menyatakan jadwal tersimpan ke database.
5. Periksa tabel `posyandu_events` di Supabase Table Editor.
6. Refresh halaman, lalu login ulang sebagai kader; jadwal harus tetap ada.
7. Login sebagai akun keluarga uji pada lokasi yang sama; jadwal harus terlihat.
8. Pastikan akun keluarga tidak memiliki tombol tambah atau batalkan jadwal.
9. Uji batal jadwal dari akun kader dan pastikan status berubah di Supabase.

## Batasan patch
Ini patch tahap pertama khusus kegiatan/jadwal. Fitur antrean, vaksinasi, stok, distribusi, poin, dan notifikasi belum dinyatakan terintegrasi/selesai oleh patch ini. Uji langsung pada project Supabase dan deployment aktual tetap diperlukan sebelum dianggap siap produksi.
