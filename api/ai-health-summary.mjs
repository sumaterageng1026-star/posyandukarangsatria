import {
  weightForAge,
  heightForAge,
  bmiForAge,
  weightForLength,
  weightForHeight,
  bmi,
} from 'who-growth-standards';

const STARTED_AT = Date.now();
const TOTAL_BUDGET_MS = 105_000;
const DB_TIMEOUT_MS = 7_000;
const OPENAI_TIMEOUT_MS = 45_000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

function logStage(stage, status, details = {}) {
  // Log only stage names/timing/status. Never log tokens, names, or measurement data.
  console.info('[AI_REPORT]', JSON.stringify({
    stage,
    status,
    elapsedMs: Date.now() - STARTED_AT,
    ...details,
  }));
}

function signalFor(maxMs) {
  const remaining = TOTAL_BUDGET_MS - (Date.now() - STARTED_AT);
  if (remaining < 800) {
    const error = new Error('Batas waktu internal laporan AI hampir habis.');
    error.name = 'DeadlineError';
    throw error;
  }
  return AbortSignal.timeout(Math.max(500, Math.min(maxMs, remaining - 500)));
}

async function timed(stage, work, timeoutMs = DB_TIMEOUT_MS) {
  const started = Date.now();
  logStage(stage, 'started');
  try {
    const result = await work();
    logStage(stage, 'ok', { durationMs: Date.now() - started });
    return result;
  } catch (error) {
    logStage(stage, 'error', {
      durationMs: Date.now() - started,
      errorName: error?.name || 'Error',
      message: String(error?.message || 'Unknown error').slice(0, 180),
    });
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const wrapped = new Error(`Langkah "${stage}" melewati batas waktu ${Math.round(timeoutMs / 1000)} detik.`);
      wrapped.name = 'StageTimeoutError';
      wrapped.stage = stage;
      throw wrapped;
    }
    throw error;
  }
}

async function supabaseFetch(path, { url, anonKey, accessToken, method = 'GET', body, range = false } = {}) {
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  if (range) headers.Range = range === true ? '0-9999' : range;
  const response = await fetch(`${url.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signalFor(DB_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { response, data: parsed, text };
}

function checkCountLimit(response, limit, label) {
  const contentRange = response.headers.get('content-range') || '';
  const match = contentRange.match(/\/(\d+)$/);
  if (match && Number(match[1]) > limit) {
    const error = new Error(`Data ${label} melebihi ${limit} baris. Pilih satu lokasi Posyandu agar analisis lebih ringan.`);
    error.name = 'DataLimitError';
    throw error;
  }
}

const dateUtc = value => new Date(`${String(value || '')}T00:00:00Z`);

function ageAt(birthDate, measureDate) {
  const birth = dateUtc(birthDate);
  const measure = dateUtc(measureDate);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(measure.getTime()) || measure < birth) return null;
  const ageDays = Math.floor((measure.getTime() - birth.getTime()) / 86400000);
  let months = (measure.getUTCFullYear() - birth.getUTCFullYear()) * 12 + measure.getUTCMonth() - birth.getUTCMonth();
  if (measure.getUTCDate() < birth.getUTCDate()) months--;
  return { ageDays, months };
}

function classify(index, z) {
  if (!Number.isFinite(z)) return 'Tidak dapat dihitung';
  if (index === 'wfa') {
    if (z < -3) return 'Berat badan sangat kurang';
    if (z < -2) return 'Berat badan kurang';
    if (z <= 1) return 'Berat badan normal';
    return 'Risiko berat badan lebih';
  }
  if (index === 'hfa') {
    if (z < -3) return 'Sangat pendek';
    if (z < -2) return 'Pendek';
    if (z <= 3) return 'Normal';
    return 'Tinggi';
  }
  if (z < -3) return 'Gizi buruk';
  if (z < -2) return 'Gizi kurang';
  if (z <= 1) return 'Gizi baik';
  if (z <= 2) return 'Berisiko gizi lebih';
  if (z <= 3) return 'Gizi lebih';
  return 'Obesitas';
}

function sexCode(value) {
  const sex = String(value || '').toLowerCase();
  if (sex.includes('perempuan') || sex === 'female' || sex === 'f') return 'female';
  if (sex.includes('laki') || sex === 'male' || sex === 'm') return 'male';
  return '';
}

function assess(member, row) {
  const age = ageAt(member.birth_date, row.measurement_date);
  if (!age || age.ageDays > 1856 || age.months > 60 || age.months < 0) return null;
  const sex = sexCode(member.sex);
  const weight = Number(row.weight_kg);
  const height = Number(row.height_cm);
  if (!sex || !(weight > 0) || !(height > 0)) return null;

  const under24Months = age.months <= 24;
  let correctedLength = height;
  if (under24Months && row.measurement_position === 'Berdiri') correctedLength += 0.7;
  if (!under24Months && row.measurement_position === 'Telentang') correctedLength -= 0.7;

  const input = { sex, ageDays: age.ageDays };
  const wfa = weightForAge(weight, input);
  const hfa = heightForAge(correctedLength, input);
  const bmiValue = bmi(weight, correctedLength);
  const bfa = bmiForAge(bmiValue, input);
  const wh = under24Months
    ? weightForLength(weight, correctedLength, sex)
    : weightForHeight(weight, correctedLength, sex);
  const bodyIndex = under24Months ? 'wfl' : 'wfh';
  return {
    wfa: { z: wfa.zScore, category: classify('wfa', wfa.zScore) },
    hfa: { z: hfa.zScore, category: classify('hfa', hfa.zScore) },
    body: { key: bodyIndex, z: wh.zScore, category: classify(bodyIndex, wh.zScore) },
    bfa: { z: bfa.zScore, category: classify('bfa', bfa.zScore) },
  };
}

function crosses(previous, current, limits) {
  return limits.some(limit => (previous < limit && current >= limit) || (previous >= limit && current < limit));
}

function addAssessmentCounts(counts, result) {
  counts.zScoreReadyChildren++;
  const w = result.wfa.category;
  if (w === 'Berat badan sangat kurang') counts.weightForAge.severelyUnderweight++;
  else if (w === 'Berat badan kurang') counts.weightForAge.underweight++;
  else if (w === 'Berat badan normal') counts.weightForAge.normal++;
  else if (w === 'Risiko berat badan lebih') counts.weightForAge.riskOverweight++;

  const h = result.hfa.category;
  if (h === 'Sangat pendek') counts.heightForAge.severelyStunted++;
  else if (h === 'Pendek') counts.heightForAge.stunted++;
  else if (h === 'Normal') counts.heightForAge.normal++;

  const b = result.body.category;
  if (b === 'Gizi buruk') counts.bodyProportion.severelyWasted++;
  else if (b === 'Gizi kurang') counts.bodyProportion.wasted++;
  else if (b === 'Berisiko gizi lebih' || b === 'Gizi lebih') counts.bodyProportion.overweightOrRisk++;
  else if (b === 'Obesitas') counts.bodyProportion.obese++;
}

function aggregate(childRows, memberById, measurementRows) {
  const counts = {
    registeredChildren: childRows.length,
    measuredChildren: 0,
    coveragePercent: 0,
    measurementRecords: measurementRows.length,
    zScoreReadyChildren: 0,
    notCalculatedChildren: 0,
    weightForAge: { severelyUnderweight: 0, underweight: 0, normal: 0, riskOverweight: 0 },
    heightForAge: { severelyStunted: 0, stunted: 0, normal: 0 },
    bodyProportion: { severelyWasted: 0, wasted: 0, overweightOrRisk: 0, obese: 0 },
    trendSignals: { childrenWithAlerts: 0, weightNotIncreasingOrDeclining: 0 },
    periodLabel: 'Seluruh riwayat pengukuran yang tersedia',
  };

  // O(n) grouping by child. Do not use Array.some() inside the measurements loop.
  const rowsByChild = new Map();
  const childIds = new Set(childRows.map(child => child.id));
  for (const row of measurementRows) {
    if (!childIds.has(row.member_id)) continue;
    const member = memberById.get(row.member_id);
    if (!member || member.household_id !== row.household_id) continue;
    const age = ageAt(member.birth_date, row.measurement_date);
    if (!age || age.ageDays < 0 || age.ageDays > 1856 || age.months < 0 || age.months > 60) continue;
    if (!rowsByChild.has(row.member_id)) rowsByChild.set(row.member_id, []);
    rowsByChild.get(row.member_id).push(row);
  }

  for (const member of childRows) {
    const rows = rowsByChild.get(member.id) || [];
    if (!rows.length) continue;
    rows.sort((a, b) => String(a.measurement_date).localeCompare(String(b.measurement_date)));
    counts.measuredChildren++;
    const latest = rows[rows.length - 1];
    let latestAssessment = null;
    try { latestAssessment = assess(member, latest); } catch { latestAssessment = null; }
    if (!latestAssessment) counts.notCalculatedChildren++;
    else addAssessmentCounts(counts, latestAssessment);

    if (rows.length >= 2) {
      const previous = rows[rows.length - 2];
      let hasAlert = false;
      if (Number(latest.weight_kg) <= Number(previous.weight_kg)) {
        counts.trendSignals.weightNotIncreasingOrDeclining++;
        hasAlert = true;
      }
      try {
        const previousAssessment = assess(member, previous);
        if (previousAssessment && latestAssessment) {
          const limits = {
            wfa: [-3, -2, 1],
            hfa: [-3, -2, 3],
            body: [-3, -2, 1, 2, 3],
            bfa: [-3, -2, 1, 2, 3],
          };
          for (const key of Object.keys(limits)) {
            if (crosses(previousAssessment[key].z, latestAssessment[key].z, limits[key])) hasAlert = true;
          }
        }
      } catch { /* skip trend if a point is outside the reference tables */ }
      if (hasAlert) counts.trendSignals.childrenWithAlerts++;
    }
  }

  counts.coveragePercent = counts.registeredChildren
    ? Math.round((counts.measuredChildren / counts.registeredChildren) * 100)
    : 0;
  return counts;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Metode tidak didukung.' }, 405);
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-6-luna';

    if (!supabaseUrl || !supabaseAnonKey || !openaiKey) {
      return json({ error: 'Konfigurasi backend belum lengkap. Isi SUPABASE_URL, SUPABASE_ANON_KEY, dan OPENAI_API_KEY di Vercel.' }, 503);
    }
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
      return json({ error: 'SUPABASE_URL server tidak valid.' }, 500);
    }
    if (!/^[a-z0-9.-]{3,80}$/i.test(model)) return json({ error: 'Nama model AI tidak valid.' }, 500);

    const authHeader = request.headers.get('authorization') || '';
    const authMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!authMatch) return json({ error: 'Sesi masuk diperlukan.' }, 401);
    const accessToken = authMatch[1].trim();

    let body;
    try {
      const raw = await request.text();
      if (raw.length > 3000) return json({ error: 'Permintaan terlalu besar.' }, 413);
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Format permintaan tidak valid.' }, 400);
    }

    const locationId = typeof body?.locationId === 'string' ? body.locationId : '';
    if (!locationId || locationId.length > 80 || body?.periodMode !== 'all') {
      return json({ error: 'Wilayah atau mode periode analisis tidak valid.' }, 400);
    }

    let currentStage = 'memulai';
    try {
      currentStage = 'memvalidasi sesi Supabase';
      const auth = await timed(currentStage, () => supabaseFetch('/auth/v1/user', {
        url: supabaseUrl, anonKey: supabaseAnonKey, accessToken,
      }));
      if (!auth.response.ok || !auth.data?.id) {
        return json({ error: 'Sesi masuk tidak valid atau telah berakhir. Silakan masuk kembali.' }, 401);
      }
      const userId = auth.data.id;

      currentStage = 'memeriksa peran akun';
      const profileResult = await timed(currentStage, () => supabaseFetch(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,is_active,email_confirmed`,
        { url: supabaseUrl, anonKey: supabaseAnonKey, accessToken },
      ));
      const profile = Array.isArray(profileResult.data) ? profileResult.data[0] : null;
      if (!profileResult.response.ok || !profile || !['admin', 'kader'].includes(profile.role)
        || profile.is_active !== true || profile.email_confirmed !== true) {
        return json({ error: 'Akses AI hanya tersedia bagi administrator atau kader aktif dan terverifikasi.' }, 403);
      }

      let locationFilter = '';
      let householdJoinFilter = '';
      let storedLocation = null;
      let storedLocationName = '';
      if (locationId !== 'all') {
        currentStage = 'memeriksa lokasi Posyandu';
        const locationResult = await timed(currentStage, () => supabaseFetch(
          `/rest/v1/posyandu_locations?id=eq.${encodeURIComponent(locationId)}&select=id,name,is_active`,
          { url: supabaseUrl, anonKey: supabaseAnonKey, accessToken },
        ));
        const locationRow = Array.isArray(locationResult.data) ? locationResult.data[0] : null;
        if (!locationResult.response.ok || !locationRow || locationRow.is_active !== true) {
          return json({ error: 'Lokasi analisis tidak ditemukan atau tidak aktif.' }, 400);
        }
        storedLocation = locationId;
        storedLocationName = locationRow.name || locationId;
        locationFilter = `&location_id=eq.${encodeURIComponent(locationId)}`;
        householdJoinFilter = `&households.location_id=eq.${encodeURIComponent(locationId)}`;

        if (profile.role === 'kader') {
          currentStage = 'memeriksa penugasan kader';
          const assignment = await timed(currentStage, () => supabaseFetch(
            `/rest/v1/kader_locations?user_id=eq.${encodeURIComponent(userId)}&location_id=eq.${encodeURIComponent(locationId)}&select=location_id`,
            { url: supabaseUrl, anonKey: supabaseAnonKey, accessToken },
          ));
          if (!assignment.response.ok || !Array.isArray(assignment.data) || assignment.data.length !== 1) {
            return json({ error: 'Akun kader tidak ditugaskan pada wilayah yang dipilih.' }, 403);
          }
        }
      } else if (profile.role !== 'admin') {
        return json({ error: 'Kader harus memilih salah satu lokasi tugas.' }, 403);
      }

      currentStage = 'memeriksa batas penggunaan AI';
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recent = await timed(currentStage, () => supabaseFetch(
        `/rest/v1/ai_health_report_requests?requested_by=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=5`,
        { url: supabaseUrl, anonKey: supabaseAnonKey, accessToken },
      ));
      if (!recent.response.ok) {
        return json({ error: 'Log pemakaian AI belum tersedia. Periksa migrasi AI dan RLS Supabase.' }, 503);
      }
      if (Array.isArray(recent.data) && recent.data.length >= 5) {
        return json({ error: 'Batas ringkasan AI tercapai: maksimal 5 kali per jam per akun.' }, 429);
      }

      // One joined member query replaces a large household-id IN(...) URL.
      // Member data and measurement rows are fetched in parallel.
      currentStage = 'mengambil data anggota dan pengukuran';
      const membersPath = `/rest/v1/family_members?select=id,household_id,birth_date,sex,households!inner(location_id)${householdJoinFilter}&limit=5000`;
      const measurementsPath = `/rest/v1/posyandu_measurements?select=household_id,member_id,measurement_date,weight_kg,height_cm,measurement_position${locationFilter}&order=measurement_date.asc&limit=10000`;
      const [membersResult, measurementsResult] = await timed(currentStage, () => Promise.all([
        supabaseFetch(membersPath, { url: supabaseUrl, anonKey: supabaseAnonKey, accessToken, range: '0-4999' }),
        supabaseFetch(measurementsPath, { url: supabaseUrl, anonKey: supabaseAnonKey, accessToken, range: '0-9999' }),
      ]));

      if (!membersResult.response.ok || !Array.isArray(membersResult.data)) {
        return json({ error: 'Data anggota keluarga tidak dapat dibaca. Periksa akses RLS Supabase.' }, 503);
      }
      if (!measurementsResult.response.ok || !Array.isArray(measurementsResult.data)) {
        return json({ error: 'Data pengukuran KMS belum dapat dibaca. Pastikan migrasi pengukuran sudah berhasil dan RLS mengizinkan akses petugas.' }, 503);
      }
      checkCountLimit(membersResult.response, 5000, 'anggota keluarga');
      checkCountLimit(measurementsResult.response, 10000, 'pengukuran');

      const today = new Date().toISOString().slice(0, 10);
      const childRows = membersResult.data.filter(member => {
        const age = ageAt(member.birth_date, today);
        return age && age.ageDays >= 0 && age.ageDays <= 1856 && age.months >= 0 && age.months <= 60;
      });
      const memberById = new Map(childRows.map(member => [member.id, member]));
      const measurementRows = measurementsResult.data;
      const counts = aggregate(childRows, memberById, measurementRows);
      logStage('menghitung statistik agregat', 'ok', {
        durationMs: 0,
        registeredChildren: counts.registeredChildren,
        measuredChildren: counts.measuredChildren,
        measurementRecords: counts.measurementRecords,
      });
      if (!counts.measurementRecords || !counts.measuredChildren) {
        return json({ error: 'Belum ada pengukuran KMS yang cocok dengan balita pada lokasi ini. Pastikan lokasi, anak, dan catatan KMS saling sesuai.' }, 400);
      }

      const locationLabel = storedLocationName || 'seluruh wilayah Posyandu yang dapat diakses administrator';
      const prompt = [
        'Anda adalah asisten penyusun DRAF laporan monitoring Posyandu untuk petugas kesehatan masyarakat Indonesia.',
        'Gunakan bahasa Indonesia formal, ringkas, dan berorientasi tata kelola program.',
        'Data berikut hanya statistik agregat. Jangan meminta atau mengarang identitas individu.',
        'Jangan membuat diagnosis, prognosis, rekomendasi obat, dosis, atau keputusan klinis.',
        'Jangan menyebut hasil sebagai prevalensi seluruh populasi bila cakupan tidak lengkap.',
        'Bedakan BB/U, PB/U atau TB/U, dan BB/PB atau BB/TB/IMT/U berdasarkan hitungan yang diberikan.',
        'Susun lima bagian: Ringkasan eksekutif; Temuan utama berbasis angka; Hal yang perlu diverifikasi kader/Puskesmas; Tindak lanjut administratif non-klinis; Keterbatasan data.',
        'Jika jumlah data kecil, katakan secara eksplisit bahwa ringkasan masih awal dan belum mewakili populasi.',
        'Acuan: Permenkes RI Nomor 2 Tahun 2020 dan WHO Child Growth Standards usia 0–5 tahun. Hasil adalah skrining pendukung, bukan diagnosis.',
        `Lokasi analisis: ${locationLabel}.`,
        'Statistik agregat hasil hitung backend:',
        JSON.stringify(counts),
      ].join('\n\n');

      currentStage = 'meminta narasi dari OpenAI';
      const aiResponse = await timed(currentStage, () => fetch(
        'https://api.openai.com/v1/responses',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model,
            instructions: [
              'Anda adalah asisten penyusun DRAF laporan monitoring Posyandu untuk petugas kesehatan masyarakat Indonesia.',
              'Gunakan bahasa Indonesia formal, ringkas, dan berorientasi tata kelola program.',
              'Data input hanya statistik agregat. Jangan meminta atau mengarang identitas individu.',
              'Jangan membuat diagnosis, prognosis, rekomendasi obat, dosis, atau keputusan klinis.',
              'Jangan menyebut hasil sebagai prevalensi seluruh populasi bila cakupan tidak lengkap.',
              'Bedakan BB/U, PB/U atau TB/U, BB/PB atau BB/TB, dan IMT/U sesuai angka yang diberikan.',
              'Susun lima bagian: Ringkasan eksekutif; Temuan utama berbasis angka; Hal yang perlu diverifikasi kader/Puskesmas; Tindak lanjut administratif non-klinis; Keterbatasan data.',
              'Jika jumlah data kecil, nyatakan secara eksplisit bahwa ringkasan masih awal dan belum mewakili populasi.',
              'Acuan: Permenkes RI Nomor 2 Tahun 2020 dan WHO Child Growth Standards usia 0–5 tahun. Hasil adalah skrining pendukung, bukan diagnosis.',
            ].join('\n'),
            input: prompt,
            reasoning: { effort: 'none' },
            max_output_tokens: 1000,
            store: false,
          }),
          signal: signalFor(OPENAI_TIMEOUT_MS),
        },
      ), OPENAI_TIMEOUT_MS);
      const aiText = await timed('membaca respons OpenAI', () => aiResponse.text(), OPENAI_TIMEOUT_MS);
      let aiJson = {};
      try { aiJson = aiText ? JSON.parse(aiText) : {}; } catch { aiJson = {}; }
      if (!aiResponse.ok) {
        const detail = aiJson?.error?.message || `OpenAI API merespons HTTP ${aiResponse.status}.`;
        const status = aiResponse.status === 429 ? 429 : aiResponse.status === 503 ? 503 : 502;
        console.error('[AI_REPORT] OpenAI API request failed', JSON.stringify({
          status: aiResponse.status,
          requestId: aiResponse.headers.get('x-request-id') || null,
          errorType: aiJson?.error?.type || null,
          errorCode: aiJson?.error?.code || null,
        }));
        return json({ error: `OpenAI belum berhasil: ${String(detail).slice(0, 300)}` }, status);
      }
      const summary = (Array.isArray(aiJson?.output) ? aiJson.output : [])
        .filter(item => item?.type === 'message')
        .flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(part => part?.type === 'output_text')
        .map(part => part.text || '')
        .join('\n').trim();
      if (aiJson?.status === 'incomplete' || !summary) {
        const reason = aiJson?.incomplete_details?.reason || 'model tidak mengembalikan teks';
        return json({ error: `OpenAI belum menghasilkan laporan lengkap (${reason}). Coba lagi dengan data atau ringkasan yang lebih ringkas.` }, 502);
      }

      // Record only successful generations so failed attempts do not consume the hourly quota.
      currentStage = 'mencatat pemakaian AI';
      const logged = await timed(currentStage, () => supabaseFetch('/rest/v1/ai_health_report_requests', {
        url: supabaseUrl, anonKey: supabaseAnonKey, accessToken, method: 'POST',
        body: { requested_by: userId, location_id: storedLocation },
      }));
      if (!logged.response.ok) {
        console.warn('[AI_REPORT] usage log insert failed; report still returned to user');
      }

      logStage('selesai', 'ok', { measurementRecords: counts.measurementRecords, model: aiJson.model || model });
      return json({
        summary: summary.slice(0, 12000),
        model: aiJson.model || model,
        locationId,
        periodMode: 'all',
        periodLabel: 'Seluruh riwayat pengukuran yang tersedia',
        measurementRecords: counts.measurementRecords,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const timedOut = ['TimeoutError', 'AbortError', 'DeadlineError', 'StageTimeoutError'].includes(error?.name);
      const status = error?.name === 'DataLimitError' ? 413 : timedOut ? 504 : 500;
      const message = error?.name === 'StageTimeoutError'
        ? `${error.message} Coba lagi nanti; jika berulang, kirimkan log tahap ${error.stage}.`
        : error?.name === 'DeadlineError'
          ? 'Proses laporan melebihi batas waktu internal 105 detik. Data dibatasi agar tidak menggantung; coba lagi atau pilih satu lokasi.'
          : error?.name === 'DataLimitError'
            ? error.message
            : timedOut
              ? `Koneksi pada tahap "${currentStage}" terlalu lama. Coba lagi dan periksa log Vercel.`
              : 'Terjadi kesalahan saat menyusun laporan AI. Periksa log Vercel untuk detail tahap.';
      console.error('[AI_REPORT] request failed', JSON.stringify({
        stage: currentStage,
        errorName: error?.name || 'Error',
        message: String(error?.message || '').slice(0, 220),
        elapsedMs: Date.now() - STARTED_AT,
      }));
      return json({ error: message, stage: currentStage }, status);
    }
  },
};
