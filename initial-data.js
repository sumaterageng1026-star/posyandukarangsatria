'use strict';

const locations = [
  ['alamanda-b', 'T. Alamanda B', 'Taman Alamanda Blok B, RW 12'],
  ['edelweis', 'Edelweis', 'VMG C, RW 24'],
  ['cempaka-v', 'Cempaka V', 'MGR Blok B, RT 4, 8, 9'],
  ['koperpu', 'Koperpu', 'Koperpu 6, 8, 9'],
  ['setia', 'Posyandu Setia', 'T. Alamanda GH, RW 22'],
  ['satelit-cempaka-1', 'Satelit Cempaka 1', 'Kp. Gebang'],
  ['anggrek-v', 'Anggrek V', 'Bumi Anggrek JKL, RT 2/7'],
  ['karya-mutiara', 'Karya Mutiara', 'VMG Y, RT 1/6'],
  ['cempaka-v-a', 'Cempaka V Blok A', 'MGR A, RT 5, 6, 7, RW 31'],
  ['cempaka-2', 'Cempaka 2', 'Rawa Kalong 1, 2, 3, 4'],
  ['kenanga', 'Kenanga', 'MGR C, RT 1, 2, 3, 4, 5'],
  ['alamanda-c', 'Alamanda C', 'Taman Alamanda C, RW 13'],
  ['delta-alamanda', 'Delta Alamanda', 'Taman Alamnda D 25'],
  ['satelit-sehat-mandiri', 'Satelit Sehat Mandiri', 'Rawa Kalong 3/3'],
  ['cempaka-1', 'Cempaka 1', 'Karang Sambung 1/9'],
  ['mutiara-tambun', 'Mutiara Tambun', 'Mutiara Tambun 7/4'],
  ['anggrek-iv-pq', 'Anggrek IV PQ', 'Bumi Anggrek PQ'],
  ['bis', 'Posyandu BIS', 'Kav. Bumi Indah Sejahtera'],
].map(([id, name, address]) => ({ id, name, address }));
const locationById = id => locations.find(item => item.id === id);

const puskesmas = {
  name: 'UPTD Puskesmas Karang Satria',
  address: 'Jl. Raya Rawa Kalong No. 6, RT 05/RW 06, Desa Karangsatria, Kecamatan Tambun Utara, Kabupaten Bekasi, Jawa Barat',
  source: 'https://skm.bekasikab.go.id/site/instansi?id_instansi_jenis=6',
};
const serviceContact = {
  phone: '08XX-XXXX-1234',
  email: 'posyandu@karangsatria.example',
};
const households = [
  { id: 'kk-a', kk: '0000000000000001', name: 'Kepala Keluarga A', location: 'alamanda-b', email: 'wali.a@posyandu.example', phone: '080000000001' },
  { id: 'kk-b', kk: '0000000000000002', name: 'Kepala Keluarga B', location: 'edelweis', email: 'wali.b@posyandu.example', phone: '080000000002' },
  { id: 'kk-c', kk: '0000000000000003', name: 'Kepala Keluarga C', location: 'cempaka-v', email: 'wali.c@posyandu.example', phone: '080000000003' },
];
const householdById = id => (data?.households ?? households).find(item => item.id === id);
const maskedKK = id => { const family = householdById(id); return '•••• •••• •••• ' + (family?.kk_last4 || family?.kk?.slice(-4) || '••••'); };
const kaderAccount = { locations: [] };

const exampleReportSessions = [
  {
    id: 'laporan-setia-12', date: '2026-11-12', time: '08:00', end: '10:00', location: 'setia',
    name: 'Penimbangan dan pemantauan pertumbuhan', officer: 'Kader Setia',
    participants: [
      ['Balita Setia 01', 'Balita', 'Hadir', 'Berat dan tinggi badan', 'Selesai'],
      ['Balita Setia 02', 'Balita', 'Hadir', 'Berat dan tinggi badan', 'Selesai'],
      ['Wali Setia 01', 'Ibu', 'Hadir', 'Skrining ibu', 'Selesai'],
    ],
    inventory: [['Kartu KMS', 'lembar', 20, 0, 2, 18], ['Formulir skrining', 'lembar', 12, 3, 1, 14]],
  },
  {
    id: 'laporan-cempaka-12', date: '2026-11-12', time: '08:00', end: '10:00', location: 'cempaka-v',
    name: 'Pemeriksaan balita dan skrining ibu', officer: 'Kader Cempaka V',
    participants: [
      ['Balita Cempaka 01', 'Balita', 'Hadir', 'Berat dan tinggi badan', 'Selesai'],
      ['Balita Cempaka 02', 'Balita', 'Tidak hadir', 'Pemeriksaan pertumbuhan', 'Belum diperiksa'],
      ['Wali Cempaka 01', 'Ibu', 'Hadir', 'Skrining ibu', 'Selesai'],
    ],
    inventory: [['Kartu KMS', 'lembar', 15, 5, 1, 19], ['Formulir skrining', 'lembar', 7, 0, 1, 6]],
  },
];

const vaccines = [
  ['hb0', 'HB-0'], ['bcg', 'BCG'], ['bopv', 'Polio tetes (bOPV)'], ['ipv', 'Polio suntik (IPV)'],
  ['dpt', 'DPT-HB-Hib'], ['pcv', 'PCV'], ['rv', 'Rotavirus (RV)'], ['mr', 'Campak-rubela (MR)'],
];
const vaccineName = id => vaccines.find(([key]) => key === id)?.[1] ?? 'Imunisasi';
const vaccineSeries = ['Awal', '1', '2', '3', '4', 'Lanjutan'];

const participationRules = [
  { id: 'hadir', label: 'Hadir di Posyandu', points: 10 },
  { id: 'kelas', label: 'Mengikuti kelas edukasi', points: 15 },
  { id: 'kuis', label: 'Menyelesaikan kuis edukasi', points: 5 },
  { id: 'umpan-balik', label: 'Mengisi umpan balik', points: 5 },
  { id: 'komunitas', label: 'Mengikuti kegiatan komunitas', points: 10 },
];
const participationEvents = [
  ['hadir-aug', 'hadir', 'Kunjungan Agustus', '2026-08-08'],
  ['kelas-aug', 'kelas', 'Kelas buku KIA', '2026-08-08'],
  ['hadir-sep', 'hadir', 'Kunjungan September', '2026-09-12'],
  ['kelas-sep', 'kelas', 'Kelas persiapan Posyandu', '2026-09-12'],
  ['kuis-sep', 'kuis', 'Kuis buku KIA', '2026-09-12'],
  ['komunitas-sep', 'komunitas', 'Kegiatan keluarga September', '2026-09-13'],
  ['hadir-oct', 'hadir', 'Kunjungan Oktober', '2026-10-10'],
  ['umpan-balik-oct', 'umpan-balik', 'Umpan balik kunjungan Oktober', '2026-10-10'],
  ['umpan-balik-nov', 'umpan-balik', 'Umpan balik kunjungan November', '2026-11-07'],
  ['hadir-nov', 'hadir', 'Kunjungan November', '2026-11-07'],
  ['kuis-nov', 'kuis', 'Kuis riwayat KMS', '2026-11-12'],
  ['kelas-nov', 'kelas', 'Kelas membaca jadwal', '2026-11-12'],
  ['komunitas-nov', 'komunitas', 'Kegiatan keluarga November', '2026-11-12'],
].map(([id, ruleId, name, date]) => ({ id, ruleId, name, date }));
function participationCredit(event, familyId, pointRules = {}) {
  const rule = participationRules.find(item => item.id === event.ruleId);
  return { id: event.id, familyId, name: event.name, rule: rule.label, points: pointRules[rule.id] ?? rule.points, date: event.date };
}
const rewardProgram = { active: true, quota: 5, period: '2026-11' };

const queueServices = [['kms', 'Pemeriksaan pertumbuhan'], ['imunisasi', 'Imunisasi'], ['umum', 'Layanan umum']];
const queueSteps = ['Menunggu', 'Dipanggil', 'Dilayani', 'Selesai'];
const screeningQuestions = [
  'Apakah ada keluhan kesehatan yang ingin disampaikan tentang anggota keluarga yang diperiksa?',
  'Apakah ada perubahan kondisi kesehatan sejak kunjungan Posyandu terakhir?',
  'Apakah ada kendala makan atau minum yang ingin dibicarakan dengan kader?',
  'Apakah ada kesulitan tidur atau aktivitas sehari-hari yang ingin disampaikan?',
  'Apakah keluarga membutuhkan konsultasi atau informasi lanjutan dari kader?',
];
const screeningChoiceSets = [
  ['Tidak ada', 'Ada', 'Belum yakin'],
  ['Tidak ada perubahan', 'Ada perubahan', 'Tidak tahu'],
  ['Tidak ada', 'Ada', 'Belum yakin'],
  ['Tidak ada', 'Ada', 'Belum yakin'],
  ['Tidak', 'Ya', 'Belum yakin'],
];
const screeningChoices = ['Tidak ada', 'Ada', 'Belum yakin'];

function makeInitialSeed(base, children) {
  const stock = [
    ['bcg-stock', 'Vaksin BCG', 'BCG-AWAL-01', 12, 3, 'vial', '2027-02-28', 'Habis pakai'],
    ['dpt-stock', 'Vaksin DPT-HB-Hib', 'DPT-AWAL-01', 18, 5, 'vial', '2027-03-31', 'Habis pakai'],
    ['pelarut', 'Pelarut sesuai produk', 'PL-AWAL-01', 15, 3, 'unit', '2027-03-31', 'Habis pakai'],
    ['ads', 'Alat suntik ADS', 'ADS-AWAL-01', 36, 8, 'unit', '2027-11-30', 'Habis pakai'],
    ['tetes', 'Alat tetes sesuai produk', 'TT-AWAL-01', 12, 4, 'unit', '', 'Habis pakai'],
    ['safety', 'Safety box', 'SB-AWAL-01', 8, 2, 'unit', '', 'Habis pakai'],
    ['carrier', 'Vaccine carrier', 'VC-AWAL-01', 4, 1, 'unit', '', 'Dikembalikan'],
    ['cool', 'Cool pack', 'CP-AWAL-01', 16, 4, 'unit', '', 'Dikembalikan'],
    ['pemantau', 'Alat pemantau suhu', 'PS-AWAL-01', 4, 1, 'unit', '', 'Dikembalikan'],
    ['form', 'Formulir pencatatan', 'FP-AWAL-01', 40, 8, 'lembar', '', 'Habis pakai'],
  ].map(([id, item, lot, count, min, unit, expiry, kind]) => ({ id, item, lot, count, min, unit, expiry, kind, location: 'alamanda-b' }));
  const mappedEvents = base.events.map(event => ({
    ...event, vitaminA: event.id === 'nov-22', location: event.id === 'dec-12' ? 'edelweis' : 'alamanda-b',
    vaccines: event.id === 'nov-22' ? ['bcg', 'dpt', 'ipv'] : event.id === 'dec-12' ? ['mr', 'pcv'] : ['bopv'],
  }));
  const householdMembers = households.flatMap(family => [
    { id: 'head-' + family.id, familyId: family.id, name: family.name, born: '', sex: 'Tidak disebutkan', relation: 'Kepala keluarga / wali', location: family.location, selectedForExam: true, childId: '' },
    ...children.filter(child => child.familyId === family.id).map(child => ({ id: 'member-' + child.id, familyId: family.id, name: child.name, born: child.born, sex: 'Tidak disebutkan', relation: 'Anak', location: child.location, selectedForExam: true, childId: child.id })),
  ]);
  return {
    version: 2,
    households: structuredClone(households),
    familyMembers: householdMembers,
    children,
    measurements: [
      ...base.measurements.map(item => ({ ...item, location: children.find(child => child.id === item.child).location })),
      { child: 'alya-b', date: '2026-11-07', weight: 8.6, height: 73.4, head: 44, position: 'Telentang', immunization: '', location: 'edelweis' },
    ],
    events: [
      ...mappedEvents,
      { id: 'edelweis-nov', name: 'Layanan balita', date: '2026-11-23', time: '08:30', status: 'Terjadwal', location: 'edelweis', vaccines: ['mr', 'pcv'] },
      { id: 'cempaka-nov', name: 'Pemantauan balita', date: '2026-11-24', time: '08:00', status: 'Terjadwal', location: 'cempaka-v', vaccines: [] },
    ],
    attendance: base.attendance.map(item => ({ ...item, location: 'alamanda-b' })),
    lots: [
      ...base.lots.map(lot => ({ ...lot, location: 'alamanda-b', kind: 'Habis pakai' })),
      ...stock,
      { ...stock[0], id: 'bcg-edelweis', lot: 'BCG-AWAL-02', count: 7, location: 'edelweis' },
    ],
    transactions: [],
    dispatches: [],
    vaccinations: [
      { id: 'vak-a', child: 'alya', vaccine: 'mr', series: '1', date: '2026-09-12', location: 'alamanda-b', source: 'Posyandu' },
      { id: 'vak-b', child: 'alya-b', vaccine: 'bcg', series: 'Awal', date: '2026-02-08', location: 'edelweis', source: 'Fasilitas lain', facility: 'Fasilitas Kesehatan Lain' },
    ],
    queues: [],
    screenings: [
      { id: 'sk-001', code: 'SK-001', familyId: 'kk-a', personId: 'head-kk-a', respondentName: 'Kepala Keluarga A', respondentRelation: 'Kepala keluarga / wali', location: 'alamanda-b', date: '2026-11-12', time: '09:00', status: 'Menunggu', questions: [...screeningQuestions], answers: ['Tidak ada', 'Tidak ada perubahan', 'Ada', 'Tidak ada', 'Tidak'] },
      { id: 'sk-002', code: 'SK-002', familyId: 'kk-b', personId: 'member-alya-b', respondentName: 'Alya', respondentRelation: 'Anak', location: 'edelweis', date: '2026-11-12', time: '10:00', status: 'Dipanggil', questions: [...screeningQuestions], answers: ['Belum yakin', 'Ada perubahan', 'Tidak ada', 'Belum yakin', 'Ya'] },
    ],
    points: [
      ...participationEvents.slice(0, 10).map(event => participationCredit(event, 'kk-a')),
      ...participationEvents.filter(event => ['hadir-oct', 'hadir-nov'].includes(event.id)).map(event => participationCredit(event, 'kk-b')),
    ],
    claims: [],
    pointRules: Object.fromEntries(participationRules.map(rule => [rule.id, rule.points])),
    reward: { ...rewardProgram },
    reminders: { 'kk-a': 1, 'kk-b': 1, 'kk-c': 1 },
    directoryProfiles: {},
    certificates: {
      'kk-a': { number: 'SKA-AWAL-001', name: 'Kepala Keluarga A', location: 'alamanda-b', points: 95, issuedOn: '2026-11-12', issuer: 'Koordinator Posyandu' },
    },
    linkedFamilies: { 'kk-a': true, 'kk-b': true },
    aliases: {},
    report: base.report ?? {
      period: '2026-11', kind: 'Rekap kegiatan bulanan', location: '', status: 'Disetujui',
      rows: [['Kegiatan selesai', 1], ['Kehadiran tercatat', 3], ['Ketidakhadiran tercatat', 1], ['Pemeriksaan KMS', 4], ['Catatan imunisasi', 0]],
    },
    saw: base.saw,
  };
}

function migrateInitialData(previous, base, fresh) {
  if (previous?.version === 2) return { ...structuredClone(fresh), ...previous };
  if (!previous || typeof previous !== 'object') return structuredClone(fresh);
  const result = structuredClone(fresh);
  if (Array.isArray(previous.measurements)) {
    const unchangedRecord = item => base.measurements.some(sample => Object.keys(sample).every(key => sample[key] === item[key]));
    result.measurements = [
      ...previous.measurements.map(item => ({ ...item, location: unchangedRecord(item) ? fresh.children.find(child => child.id === item.child)?.location ?? '' : '' })),
      ...fresh.measurements.filter(item => item.child === 'alya-b'),
    ];
  }
  if (Array.isArray(previous.events)) {
    result.events = [
      ...previous.events.map(item => {
        const sample = base.events.find(event => event.id === item.id);
        const mapped = fresh.events.find(event => event.id === item.id);
        return sample?.place === item.place && mapped
          ? { ...item, location: mapped.location, vaccines: mapped.vaccines }
          : { ...item, location: '', vaccines: [] };
      }),
      ...fresh.events.filter(event => !base.events.some(old => old.id === event.id)),
    ];
  }
  if (Array.isArray(previous.lots)) {
    result.lots = [
      ...previous.lots.map(lot => ({ ...lot, location: 'alamanda-b', kind: 'Habis pakai' })),
      ...fresh.lots.filter(lot => !base.lots.some(old => old.id === lot.id)),
    ];
  }
  if (Array.isArray(previous.transactions)) {
    result.transactions = previous.transactions.map(row => ({ ...row, location: 'alamanda-b' }));
  }
  if (Array.isArray(previous.attendance)) {
    result.attendance = previous.attendance.map(item => ({ ...item, location: 'alamanda-b' }));
  }
  if (Array.isArray(previous.points)) {
    const extra = previous.points.filter(item => !base.points.some(sample => sample.id === item.id));
    result.points.push(...extra.map(item => ({ ...item, id: 'lama-' + item.id, familyId: 'kk-a', rule: 'Riwayat data sebelumnya' })));
  }
  if (previous.screening === 'Latihan selesai') result.screenings[0].status = 'Selesai';
  if (Number.isInteger(previous.reminder)) result.reminders['kk-a'] = previous.reminder;
  if (previous.optedIn) result.aliases['kk-a'] = true;
  result.report = previous.report ?? null;
  result.saw = previous.saw ?? null;
  return result;
}
