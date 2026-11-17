'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const DAY = '2026-11-12';
const DB_KEY = 'posyandu-karangsatria-data-v1';
const LEGACY_DB_KEYS = ['karangsatria-demo-v2', 'karangsatria-demo-v1'];
const SESSION_KEY = DB_KEY + '-session';
const ACTIVITY_KEY = DB_KEY + '-last-activity';
const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' });
const periodFormat = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
const shortDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const fmt = number => numberFormat.format(number);
const dateObject = day => new Date(day + 'T12:00:00+07:00');
const dateLabel = day => dateFormat.format(dateObject(day));
const periodLabel = month => periodFormat.format(dateObject(month + '-01'));
const timeLabel = time => time.replace(':', '.') + ' WIB';
const timeToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = timeToday.format(new Date());
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const sampleChildren = [
  { id: 'alya', name: 'Alya', born: '2024-08-08', familyId: 'kk-a', location: 'alamanda-b', relation: 'Orang tua' },
  { id: 'alya-b', name: 'Alya', born: '2025-11-03', familyId: 'kk-b', location: 'edelweis', relation: 'Orang tua' },
  { id: 'bima', name: 'Bima', born: '2024-05-03', familyId: 'kk-b', location: 'edelweis', relation: 'Orang tua' },
  { id: 'citra', name: 'Citra', born: '2024-03-02', familyId: 'kk-c', location: 'cempaka-v', relation: 'Wali' },
  { id: 'farah', name: 'Farah', born: '2025-08-13', familyId: 'kk-a', location: 'alamanda-b', relation: 'Orang tua' },
];
const personById = id => data.children.find(person => person.id === id);
const personName = id => personById(id)?.name ?? 'Peserta belum tercatat';
const familyChildren = () => data.children.filter(person => person.familyId === session.familyId);
const familyMembersFor = familyId => (data.familyMembers ?? []).filter(member => member.familyId === familyId);
const currentFamilyMembers = () => familyMembersFor(session.familyId);
const memberById = id => (data.familyMembers ?? []).find(member => member.id === id);
const staffLocations = () => locations.filter(item => kaderAccount.locations.includes(item.id));
const staffChildren = () => data.children.filter(person => staffLocations().some(item => item.id === person.location));

const types = [
  { key: 'weight', label: 'Berat badan', unit: 'kg' },
  { key: 'height', label: 'Panjang atau tinggi badan', unit: 'cm' },
  { key: 'head', label: 'Lingkar kepala', unit: 'cm' },
];
const growthIndexes = [
  ['BB/U', 'Berat badan menurut umur'],
  ['PB/U atau TB/U', 'Panjang atau tinggi badan menurut umur'],
  ['BB/PB atau BB/TB', 'Berat badan menurut panjang atau tinggi badan'],
  ['IMT/U', 'Indeks massa tubuh menurut umur'],
];
const pendingAssessment = 'Menunggu acuan resmi Puskesmas Karangsatria';
const initialPeriod = DAY.slice(0, 7);
function regionOf(person) {
  if (person?.region) return person.region;
  const rw = locationById(person?.location)?.address.match(/RW\s*(\d+)/i)?.[1];
  return rw ? 'RW ' + rw : 'Wilayah belum tercatat';
}

const legacySeed = {
  measurements: [
    { child: 'alya', date: '2026-08-08', weight: 10.3, height: 80.9, head: 46, position: 'Berdiri', immunization: 'Riwayat dicatat' },
    { child: 'alya', date: '2026-09-12', weight: 10.7, height: 82.3, head: 46.3, position: 'Berdiri', immunization: '' },
    { child: 'alya', date: '2026-10-10', weight: 11.1, height: 84.6, head: 46.7, position: 'Berdiri', immunization: '' },
    { child: 'alya', date: '2026-11-07', weight: 11.4, height: 85.4, head: 47, position: 'Berdiri', immunization: '' },
    { child: 'bima', date: '2026-11-07', weight: 12.3, height: 88.4, head: 48, position: 'Berdiri', immunization: '' },
    { child: 'citra', date: '2026-10-10', weight: 12.8, height: 91, head: 48.5, position: 'Berdiri', immunization: '' },
    { child: 'farah', date: '2026-10-10', weight: 8.7, height: 73.2, head: 44.7, position: 'Telentang', immunization: '' },
    { child: 'farah', date: '2026-11-07', weight: 9, height: 74.5, head: 45, position: 'Telentang', immunization: '' },
  ],
  events: [
    { id: 'nov-07', name: 'Pemeriksaan bulanan', date: '2026-11-07', time: '08:00', place: 'Balai Desa Karangsatria', status: 'Selesai' },
    { id: 'nov-22', name: 'Posyandu balita', date: '2026-11-22', time: '08:00', place: 'Balai Desa Karangsatria', status: 'Terjadwal' },
    { id: 'dec-12', name: 'Pemeriksaan bulanan', date: '2026-12-12', time: '08:00', place: 'Balai Desa Karangsatria', status: 'Terjadwal' },
  ],
  attendance: [
    { child: 'alya', status: 'Hadir' }, { child: 'bima', status: 'Hadir' },
    { child: 'citra', status: 'Tidak hadir', follow: '' }, { child: 'farah', status: 'Hadir' },
  ],
  lots: [
    { id: 'a', item: 'Vitamin A', lot: 'VA-1126', count: 18, min: 8, unit: 'kapsul', expiry: '2027-01-31' },
    { id: 'b', item: 'Kartu KMS', lot: 'KMS-1126', count: 6, min: 10, unit: 'lembar', expiry: '' },
    { id: 'c', item: 'Kapas steril', lot: 'KS-1026', count: 24, min: 10, unit: 'paket', expiry: '2027-02-28' },
  ],
  transactions: [],
  points: [
    { id: 'hadir-nov', name: 'Kehadiran Posyandu', points: 10, date: '2026-11-07' },
    { id: 'kms-nov', name: 'Pemeriksaan KMS', points: 15, date: '2026-11-07' },
  ],
  reminder: 3,
  optedIn: false,
  screening: 'Belum diisi',
  report: null,
  saw: null,
};
const seed = makeInitialSeed(legacySeed, sampleChildren);
const reportSessionsForView = window.posyanduSupabaseConfigured ? [] : exampleReportSessions;
const readStorage = (storage, key) => {
  try { return window[storage].getItem(key); } catch { return null; }
};
const writeStorage = (storage, key, value) => {
  try { window[storage].setItem(key, value); } catch { /* Data hanya tersedia sementara di memori. */ }
};
function loadData() {
  try {
    if (window.posyanduSupabaseConfigured) {
      // Online release must never start with seeded household or health records.
      // The connected flows are populated from Supabase after authentication.
      const fresh = migrateInitialData(null, legacySeed, seed);
      return {
        ...fresh,
        households: [], familyMembers: [], children: [], measurements: [], events: [], attendance: [],
        lots: [], transactions: [], dispatches: [], vaccinations: [], queues: [], screenings: [],
        points: [], claims: [], reminders: {}, directoryProfiles: {}, certificates: {}, linkedFamilies: {}, aliases: {},
        report: null, saw: null,
      };
    }
    const saved = readStorage('localStorage', DB_KEY) ?? LEGACY_DB_KEYS.map(key => readStorage('localStorage', key)).find(Boolean);
    return migrateInitialData(saved ? JSON.parse(saved) : null, legacySeed, seed);
  } catch {
    if (window.posyanduSupabaseConfigured) {
      const empty = structuredClone(seed);
      for (const key of ['households', 'familyMembers', 'children', 'measurements', 'events', 'attendance', 'lots', 'transactions', 'dispatches', 'vaccinations', 'queues', 'screenings', 'points', 'claims']) empty[key] = [];
      empty.reminders = {}; empty.directoryProfiles = {}; empty.certificates = {}; empty.linkedFamilies = {}; empty.aliases = {}; empty.report = null; empty.saw = null;
      return empty;
    }
    return structuredClone(seed);
  }
}
function loadSession() {
  // In online mode, never trust a role stored in browser sessionStorage. Supabase Auth must re-validate it.
  if (window.posyanduSupabaseConfigured) return { role: '', familyId: '' };
  try {
    const current = JSON.parse(readStorage('sessionStorage', SESSION_KEY));
    const lastActivity = Number(current?.lastActivity ?? current?.issuedAt ?? 0);
    const isFresh = lastActivity > 0 && Date.now() - lastActivity < 30 * 60 * 1000;
    if (isFresh && (current?.role === 'kader' || (current?.role === 'keluarga' && householdById(current.familyId)))) return current;
  } catch { /* Start at the login screen. */ }
  return { role: '', familyId: '' };
}
let data = loadData();
// Keep the legacy lookup list in sync with registered households loaded from browser storage.
function syncHouseholdList() {
  if (Array.isArray(data.households)) households.splice(0, households.length, ...data.households);
}
syncHouseholdList();
function ensureFamilyMembers() {
  data.familyMembers ??= [];
  for (const family of (data.households ?? [])) {
    if (!data.familyMembers.some(member => member.familyId === family.id && member.relation.toLowerCase().includes('kepala keluarga'))) {
      data.familyMembers.push({ id: 'head-' + family.id, familyId: family.id, name: family.name, born: '', sex: 'Tidak disebutkan', relation: 'Kepala keluarga / wali', location: family.location, selectedForExam: true, childId: '' });
    }
  }
  for (const child of (data.children ?? [])) {
    if (!data.familyMembers.some(member => member.childId === child.id || member.id === 'member-' + child.id)) {
      data.familyMembers.push({ id: 'member-' + child.id, familyId: child.familyId, name: child.name, born: child.born, sex: 'Tidak disebutkan', relation: 'Anak', location: child.location, selectedForExam: true, childId: child.id });
    }
  }
}
ensureFamilyMembers();
let session = loadSession();
let role = session.role;
const ui = {
  kaderChild: 'alya', familyChild: familyChildren()[0]?.id ?? '', metric: 'weight',
  kaderLocation: '', growthLocation: '', monitoringPeriod: initialPeriod, monitoringRegion: '', dashboardMetric: 'weight',
  reportPeriod: '2026-11', reportKind: 'Rekap kegiatan bulanan',
  loginRole: 'keluarga', pendingRoute: '', screeningDraft: null, analysisLocation: '',
  registrationStep: 'form', pendingEmail: '', registrationDone: false,
};

let route = '';
let toastTimer;
let lastFocus;

const icons = {
  mark: '<path d="M4 13a8 8 0 1 1 16 0v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><circle cx="10" cy="9" r="2"/><circle cx="15" cy="12" r="1.55"/><path d="M7.5 16a3.2 3.2 0 0 1 6.3-.4m.8.4a2.1 2.1 0 0 1 2-.8"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-6h6v6"/>',
  users: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
  kms: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13h6m-3-3v6"/>',
  graph: '<path d="M4 4v16h16M8 15l4-4 3 2 5-6"/>',
  calendar: '<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v5m8-5v5M4 11h16m-11 5h.01m3 0h.01m3 0h.01"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4m-9 4h6m-6 4h6"/>',
  star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1zm0 0v14"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4m-9 4v10M7.5 5l9 4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zm5 3a2 2 0 0 0 4 0"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pin: '<path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  exit: '<path d="M10 4H4v16h6m4-13 5 5-5 5m-7-5h12"/>',
};
const icon = key => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + icons[key] + '</svg>';
const link = (text, url, style = 'secondary', glyph = '') => `<a class="btn ${style}" href="#${url}">${h(text)}${glyph ? icon(glyph) : ''}</a>`;
const action = (text, id, style = 'secondary', extra = '') => `<button type="button" class="btn ${style}" data-action="${id}" ${extra}>${h(text)}</button>`;
const pill = (text, style = '') => `<span class="pill ${style}">${h(text)}</span>`;
const options = (entries, current) => entries.map(([key, text]) => `<option value="${h(key)}"${String(key) === String(current) ? ' selected' : ''}>${h(text)}</option>`).join('');
const selection = (list, current, distinguish = false) => options(list.map(item => [
  item.id, distinguish ? item.name + ' · KK ' + (householdById(item.familyId)?.kk_last4 || householdById(item.familyId)?.kk?.slice(-4) || '••••') : item.name,
]), current);
const normalizeLocationId = value => {
  const key = String(value ?? '').trim().toLocaleLowerCase('id-ID');
  if (!key) return '';
  const match = locations.find(item => item.id.toLocaleLowerCase('id-ID') === key || item.name.trim().toLocaleLowerCase('id-ID') === key);
  return match?.id ?? key;
};
const atLocation = (item, id) => !id || normalizeLocationId(item.location) === normalizeLocationId(id);
const staffLocation = () => role === 'kader' ? ui.kaderLocation : '';
const locationName = id => locationById(id)?.name ?? 'Lokasi belum ditetapkan';
const publishedProfile = id => {
  const profile = data.directoryProfiles[id];
  return profile?.status === 'Terverifikasi' ? profile : profile?.published;
};
const localAddress = id => publishedProfile(id)?.address ?? locationById(id)?.address;
const fullLocationAddress = id => {
  const address = localAddress(id);
  const area = 'Desa Karangsatria, Kecamatan Tambun Utara, Kabupaten Bekasi, Jawa Barat';
  if (!address) return 'Alamat belum tercatat';
  return address.toLowerCase().includes('karangsatria') ? address : address + ', ' + area;
};
const locationDetail = (id, fallback = '') => {
  const place = locationById(id);
  if (place) return '<span class="location-name">' + h(place.name) + '</span><small class="location-caption">' + h(localAddress(id)) + '</small>';
  return '<span class="location-name">Lokasi belum ditetapkan</span>' + (fallback ? '<small class="location-caption">' + h(fallback) + '</small>' : '');
};
const locationOptions = (current, empty = 'Pilih lokasi Posyandu', list = locations) => options([['', empty], ...list.map(item => [item.id, item.name])], current);
function locationField(name, { label = 'Lokasi Posyandu', value = '', required = true, empty = 'Pilih lokasi Posyandu', change = '', list = locations } = {}) {
  const address = localAddress(value);
  return `<div class="location-control"><label class="field">${h(label)}<select name="${h(name)}" data-location-select${required ? ' required' : ''}${change ? ` data-change="${h(change)}"` : ''}>${locationOptions(value, empty, list)}</select></label><small class="location-caption" data-location-note${address ? '' : ' hidden'}>${h(address)}</small></div>`;
}
const currentEvents = (id = staffLocation()) => data.events.filter(event => String(event.status ?? '').trim().toLocaleLowerCase('id-ID') === 'terjadwal' && atLocation(event, id)).sort((a, b) => a.date.localeCompare(b.date));
const records = (child, location = '') => data.measurements.filter(item => item.child === child && atLocation(item, location)).sort((a, b) => a.date.localeCompare(b.date));

const screenTitle = (title, subtitle, trailing = '') => `<header class="page-head"><div><h1 id="page-title" tabindex="-1">${h(title)}</h1><p>${h(subtitle)}</p></div>${trailing}</header>`;
const table = (headers, rows, label, wide = false) => rows.length ? `<div class="table-box${wide ? ' wide-table' : ''}" tabindex="0" role="region" aria-label="${h(label)}"><table>
  <thead><tr>${headers.map(text => `<th scope="col">${h(text)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="empty">Belum ada ${h(label.toLowerCase())}.</p>`;
const brand = () => `<a class="mark" href="#beranda" aria-label="Posyandu Karangsatria, beranda"><span class="mark-icon">${icon('mark')}</span><span>Posyandu<small>Karangsatria</small></span></a>`;
const save = () => {
  const snapshot = structuredClone(data);
  // Once Supabase is configured, keep family identities, member records and screening answers out of browser storage.
  if (window.posyanduSupabaseConfigured) {
    snapshot.households = [];
    snapshot.familyMembers = [];
    snapshot.children = [];
    snapshot.screenings = [];
  }
  writeStorage('localStorage', DB_KEY, JSON.stringify(snapshot));
};

function publicHeader() {
  return `<header class="public-header"><div class="wrap">${brand()}<nav aria-label="Navigasi publik">
    ${link('Layanan', 'layanan', 'plain')}${link('Lokasi', 'lokasi', 'plain')}${link('Daftar akun warga', 'daftar', 'primary', 'arrow')}${link('Masuk', 'masuk/orang-tua', 'secondary')}
  </nav></div></header>`;
}
function footer() {
  return `<footer class="footer"><div class="wrap row between"><span>Posyandu Karangsatria · Desa Karangsatria, Kecamatan Tambun Utara</span><a href="DESIGN.md" download>Unduh DESIGN.md</a></div></footer>`;
}
function landing() {
  const services = [
    ['graph', 'Tumbuh kembang balita', 'Lihat catatan berat dan tinggi badan anak dari setiap kunjungan.', 'keluarga/pertumbuhan'],
    ['kms', 'Imunisasi anak', 'Cek jadwal dan riwayat imunisasi anak.', 'keluarga/imunisasi'],
    ['users', 'Skrining ibu', 'Isi formulir dan lihat status tindak lanjutnya.', 'keluarga/skrining'],
    ['calendar', 'Jadwal kunjungan', 'Cek tanggal, jam, dan tempat posyandu sebelum berangkat.', 'keluarga/jadwal'],
  ];
  return `${publicHeader()}<main id="content" tabindex="-1">
    <section class="wrap hero">
      <div class="hero-copy"><div class="eyebrow">Desa Karangsatria · Tambun Utara</div>
        <h1 id="page-title" tabindex="-1">Pantau <em>tumbuh kembang</em> anak.</h1>
        <p>Bunda bisa cek jadwal posyandu, lihat riwayat kesehatan si kecil, dan siapkan kunjungan berikutnya.</p>
        <div class="row hero-actions">
          ${link('Daftar akun warga', 'daftar', 'primary', 'arrow')}
          ${link('Masuk ke akun', role === 'keluarga' ? 'keluarga/dashboard' : 'masuk/orang-tua', 'secondary')}
        </div>
        <p class="small muted">Belum punya akun? Daftar menggunakan email aktif, lalu masukkan kode OTP yang dikirim ke email.</p>
      </div>
      <figure class="hero-media">
        <img src="foto-ibu-dan-anak.webp" alt="Seorang ibu menggendong bayinya di luar ruangan" width="1125" height="1500" fetchpriority="high">
        <figcaption><a href="https://www.pexels.com/photo/smiling-asian-woman-holding-baby-girl-13884988/" target="_blank" rel="noopener noreferrer">Foto Halem Mumtaz Mahal · Pexels</a></figcaption>
      </figure>
    </section>
    <section id="layanan" class="public-section" aria-labelledby="services-title">
      <div class="wrap service-layout">
        <div><h2 id="services-title" tabindex="-1">Layanan Posyandu untuk ibu dan anak</h2>
          <ul class="service-items">${services.map(([glyph, title, detail, url]) => `<li><a href="#${url}">
            <span class="service-icon">${icon(glyph)}</span><div><h3>${title}</h3><p>${detail}</p></div>${icon('arrow')}
          </a></li>`).join('')}</ul>
        </div>
        <aside class="note-panel stack visit-panel">
          <h3>Sebelum berangkat</h3>
          <ul class="visit-list">
            <li>${icon('check')}<span>Cek jadwal dan tempat posyandu.</span></li>
            <li>${icon('check')}<span>Bawa Buku KIA jika ada.</span></li>
            <li>${icon('check')}<span>Catat hal yang ingin Bunda tanyakan.</span></li>
          </ul>
          ${link('Lihat peta lokasi', 'lokasi', 'secondary', 'pin')}
        </aside>
      </div>
    </section>
    <section id="lokasi" class="public-section" aria-labelledby="home-location-title">
      <div class="wrap stack">
        <h2 id="home-location-title" tabindex="-1">Lokasi layanan</h2>
        <div class="home-map-layout">
          <div class="home-map">
            <iframe title="Google Maps UPTD Puskesmas Karang Satria" src="${h(puskesmasMapEmbed())}" width="660" height="340" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
          </div>
          <div class="panel stack home-location-info">
            <div class="stack-tight">
              <div class="eyebrow">Puskesmas pembina</div>
              <h3>${h(puskesmas.name)}</h3>
              <p class="small muted">${h(puskesmas.address)}</p>
            </div>
            <dl class="home-contact">
              <dt>Kontak layanan</dt>
              <dd>Belum ditetapkan</dd>
            </dl>
            <div class="row">
              ${mapLink('Buka Google Maps', puskesmasMapSearch())}
              ${link('Daftar 18 posyandu', 'lokasi/daftar', 'plain', 'arrow')}
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>${footer()}`;
}
const kaderNav = [
  ['dashboard', 'Dasbor', 'home'], ['keluarga', 'Data keluarga', 'users'], ['peserta', 'Data ibu dan balita', 'users'],
  ['kms', 'KMS Digital', 'kms'], ['pertumbuhan', 'Pemantauan pertumbuhan', 'graph'],
  ['gizi', 'Analisis status gizi', 'graph'], ['imunisasi', 'Imunisasi', 'kms'],
  ['antrean', 'Daftar Pelayanan', 'clock'], ['skrining', 'Hasil Skrining', 'lock'],
  ['jadwal', 'Jadwal posyandu', 'calendar'], ['kehadiran', 'Balita tidak hadir', 'clock'],
  ['stok', 'Pengelolaan stok', 'box'], ['poin', 'Bunda Teladan', 'star'],
  ['edukasi', 'Edukasi dan berita', 'book'], ['lokasi', 'Puskesmas dan lokasi', 'pin'],
  ['laporan', 'Laporan', 'file'], ['wilayah', 'Analisis Lokasi Posyandu', 'pin'], ['akun', 'Manajemen akun', 'person'], ['pengaturan', 'Pengaturan', 'person'],
];
const familyNav = [
  ['dashboard', 'Beranda', 'home'], ['anggota', 'Anggota keluarga', 'users'], ['pertumbuhan', 'Tumbuh kembang', 'graph'],
  ['riwayat', 'Riwayat kesehatan', 'kms'], ['imunisasi', 'Imunisasi', 'kms'],
  ['antrean', 'Daftar Pelayanan', 'clock'], ['skrining', 'Skrining Ibu', 'lock'],
  ['jadwal', 'Jadwal posyandu', 'calendar'], ['poin', 'Bunda Teladan', 'star'],
  ['edukasi', 'Edukasi dan berita', 'book'], ['lokasi', 'Puskesmas dan lokasi', 'pin'], ['notifikasi', 'Notifikasi', 'bell'],
  ['pengaturan', 'Akun saya', 'person'],
];
function shell(nav, page, body) {
  const isFamily = role === 'keluarga';
  const isAdmin = typeof authProfileRole !== 'undefined' && authProfileRole === 'admin';
  const portalLabel = isFamily ? 'Portal orang tua' : (isAdmin ? 'Portal administrator' : 'Portal kader');
  return `<div class="app-shell${isFamily ? ' family-shell' : ''}">
    <aside class="sidebar" id="portal-nav">${brand()}<div class="nav-label">${portalLabel}</div>
    <nav aria-label="Menu portal">${nav.filter(([id]) => id !== 'akun' || isAdmin).map(([id, name, glyph]) => `<a class="nav-link" href="#${role}/${id}"${page === id ? ' aria-current="page"' : ''}>${icon(glyph)}<span>${name}</span></a>`).join('')}</nav></aside>
    <div class="workspace">
      <header class="topbar">
        <div class="row"><button type="button" class="btn plain menu-toggle" data-action="menu" aria-controls="portal-nav" aria-expanded="false">${icon('menu')} Menu</button><span class="section-id">${isFamily ? h(householdById(session.familyId).name) : portalLabel}</span>${pill('Akun aktif', 'good')}</div>
        <div class="row topbar-actions">
          ${isFamily ? '' : locationField('filter-location', { label: 'Lokasi', value: ui.kaderLocation, required: false, empty: 'Semua lokasi', change: 'staff-location', list: staffLocations() })}
          ${action('Keluar', 'logout', 'plain')}
        </div>
      </header>
      <main class="dash" id="content" tabindex="-1">${body}</main>
    </div>
  </div>`;
}

function metricCard(glyph, value, text, short = false) {
  return `<article class="metric">${icon(glyph)}<div class="value numeric${short ? ' short-value' : ''}">${h(value)}</div><p>${h(text)}</p></article>`;
}
function eventSummary(event) {
  return event ? `<div class="stack-tight"><h3>${h(event.name)}</h3><div class="row small muted">${icon('calendar')} ${dateLabel(event.date)} · ${timeLabel(event.time)}</div><div class="row small muted">${icon('pin')} ${locationDetail(event.location, event.place)}</div></div>` : '<p class="empty">Belum ada jadwal aktif.</p>';
}
function chart(child, type = 'weight', location = '', through = '') {
  const metric = types.find(item => item.key === type);
  const points = records(child, location).filter(item => (!through || item.date.slice(0, 7) <= through) && Number.isFinite(item[type])).slice(-6);
  if (!points.length) return '<p class="empty">Belum ada pengukuran untuk anak ini.</p>';
  const values = points.map(item => item[type]);
  const min = Math.floor(Math.min(...values) - .3);
  const max = Math.ceil(Math.max(...values) + .3);
  const x = index => points.length === 1 ? 290 : 65 + index * (450 / (points.length - 1));
  const y = value => 144 - (value - min) * 121 / (max - min);
  const guides = [min, (min + max) / 2, max];
  return `<svg class="chart" viewBox="0 0 560 182" role="img" aria-label="${h(metric.label)} dalam ${metric.unit} untuk ${h(personName(child))}">
    ${guides.map(value => `<line x1="49" x2="530" y1="${y(value)}" y2="${y(value)}"/><text x="5" y="${y(value) + 4}">${fmt(value)}</text>`).join('')}
    <polyline points="${values.map((value, i) => x(i) + ',' + y(value)).join(' ')}" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    ${points.map((point, i) => `<circle cx="${x(i)}" cy="${y(point[type])}" r="5" fill="var(--accent)"><title>${dateLabel(point.date)} · ${fmt(point[type])} ${metric.unit}</title></circle><text x="${x(i)}" y="170" text-anchor="middle">${shortDate.format(dateObject(point.date))}</text>`).join('')}
  </svg>`;
}
function measurementChanges(child) {
  const labels = {weight: 'Berat badan', height: 'Panjang atau tinggi', head: 'Lingkar kepala', position: 'Posisi', immunization: 'Imunisasi', note: 'Catatan kader'};
  const timestamp = new Intl.DateTimeFormat('id-ID', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jakarta'});
  const rows = (data.measurementChanges ?? []).filter(item => item.child === child && atLocation(item, staffLocation())).slice().reverse();
  return `<details class="section-gap"><summary>Riwayat perubahan</summary>${table(['Waktu perubahan (WIB)', 'Pemeriksaan', 'Perubahan'], rows.map(item => [
    h(timestamp.format(new Date(item.at))), dateLabel(item.date), item.edits.map(edit => `${labels[edit.field]}: ${h(edit.before || '—')} → ${h(edit.after || '—')}`).join('<br>')
  ]), 'Riwayat perubahan pemeriksaan')}</details>`;
}
function measurementTable(child, location = '') {
  const staff = role === 'kader';
  return table(['Tanggal', 'Berat', 'Panjang atau tinggi', 'Lingkar kepala', 'Lokasi', 'Catatan imunisasi', ...(staff ? ['Catatan kader'] : [])],
    records(child, location).slice().reverse().map(item => [dateLabel(item.date), fmt(item.weight) + ' kg', fmt(item.height) + ' cm',
      fmt(item.head) + ' cm', locationDetail(item.location), h(item.immunization) || '—', ...(staff ? [h(item.note) || '—'] : [])]), 'Riwayat pengukuran', true);
}
function monitoringData(region = '') {
  const location = staffLocation();
  const period = ui.monitoringPeriod;
  const people = staffChildren().filter(person => atLocation(person, location));
  const regions = [...new Set(people.map(regionOf))].sort();
  const children = people.filter(person => !region || regionOf(person) === region);
  const ids = new Set(children.map(person => person.id));
  const checks = data.measurements.filter(item => ids.has(item.child) && atLocation(item, location) && item.date.startsWith(period));
  return { location, period, regions, children, checks, examined: new Set(checks.map(item => item.child)) };
}
function monitoringFilters(period, secondaryField) {
  const months = [...new Set([initialPeriod, ...data.events.map(item => item.date.slice(0, 7)), ...data.measurements.map(item => item.date.slice(0, 7))])].sort().reverse();
  return `<div class="form-grid monitor-filters">
    <label class="field">Periode<select data-change="monitoring-period">${options(months.map(month => [month, periodLabel(month)]), period)}</select></label>
    ${secondaryField}
  </div>`;
}
function coverageAddressField(location) {
  const places = staffLocations().map(place => ({ ...place, address: localAddress(place.id) || 'Alamat belum tercatat' }));
  const addresses = places.map(place => {
    const shared = places.some(other => other.id !== place.id && other.address === place.address);
    return [place.id, shared ? `${place.address} · ${place.name}` : place.address];
  });
  return `<label class="field coverage-address">Alamat Posyandu
    <select name="coverage-address" data-change="dashboard-location">
      <button><selectedcontent></selectedcontent></button>
      ${options([['', 'Semua Posyandu'], ...addresses], location)}
    </select>
  </label>`;
}
function dashboardKader() {
  const {location, period, children, checks, examined} = monitoringData();
  const event = currentEvents()[0];
  const stockIssues = data.lots.filter(lot => lot.count <= lot.min && atLocation(lot, location)).length;
  const queueCount = data.queues.filter(item => item.status === 'Menunggu' && atLocation(item, location)).length;
  const child = children.find(person => person.id === ui.kaderChild) ?? children[0];
  const metric = types.find(item => item.key === ui.dashboardMetric);
  const missing = children.filter(person => !examined.has(person.id));
  const visits = new Map();
  for (const check of checks) visits.set(check.location, (visits.get(check.location) ?? 0) + 1);
  return `${screenTitle('Dasbor kader', (location ? locationName(location) : 'Seluruh lokasi Posyandu') + ' · ' + periodLabel(period), link('Catat pemeriksaan', 'kader/kms', 'primary', 'arrow'))}
  <div class="dash-grid">
    <section class="panel stack-tight"><h2>Cakupan pemeriksaan</h2>${monitoringFilters(period, coverageAddressField(location))}
      <div class="metrics">
        ${metricCard('users', children.length, 'Balita terdaftar')}
        ${metricCard('kms', examined.size, 'Sudah diperiksa')}
        ${metricCard('clock', missing.length, 'Belum diperiksa')}
        ${metricCard('graph', 'Belum dapat dinilai', 'Perlu tinjau pertumbuhan', true)}
      </div>
      <p class="small muted">Setiap anak dihitung sekali dalam cakupan pemeriksaan.</p>
    </section>
    <div class="cols">
      <section class="panel"><div class="panel-heading"><div><h2>Tren pertumbuhan</h2><p class="small muted">Riwayat hingga ${periodLabel(period)} · ${h(metric.unit)}</p></div>${link('Lihat grafik', 'kader/pertumbuhan', 'plain')}</div>
        ${child ? `<div class="form-grid"><label class="field">Pilih anak<select data-change="kader-child">${selection(children, child.id, true)}</select></label><label class="field">Ukuran<select data-change="dashboard-metric">${options(types.slice(0,2).map(item => [item.key, item.label]), metric.key)}</select></label></div>${chart(child.id, metric.key, location, period)}` : '<p class="empty">Belum ada peserta dalam pilihan ini.</p>'}
      </section>
      <div class="stack">
        <section class="panel tinted stack-tight"><h2>Jadwal berikutnya</h2>${eventSummary(event)}${link('Kelola jadwal', 'kader/jadwal', 'plain', 'arrow')}</section>
        <section class="panel"><h2>Tindak lanjut</h2><ul class="list">
          <li><span>${missing.length} balita belum diperiksa</span>${link('Lihat daftar', 'kader/kehadiran', 'plain')}</li>
          <li><span>${stockIssues} lot mencapai batas minimum</span>${link('Lihat stok', 'kader/stok', 'plain')}</li>
          <li><span>${queueCount} pendaftaran menunggu</span>${link('Buka daftar pelayanan', 'kader/antrean', 'plain')}</li>
          <li><span>Prediksi belum tersedia</span>${link('Analisis prediktif', 'kader/gizi', 'plain')}</li>
        </ul></section>
      </div>
    </div>
    <section class="panel stack-tight"><div class="panel-heading"><h2>Rekap kunjungan pemeriksaan</h2>${link('Analisis Lokasi Posyandu', 'kader/wilayah', 'plain')}</div>
      <p class="small muted">${checks.length} kunjungan KMS tercatat. Pemeriksaan ulang dihitung sebagai kunjungan tersendiri.</p>
      ${table(['Posyandu', 'Kunjungan KMS'], [...visits].map(([id, total]) => [h(locationName(id)), total]), 'Rekap kunjungan pemeriksaan')}
    </section>
  </div>`;
}
function regionPage() {
  const period = ui.monitoringPeriod;
  const selected = ui.analysisLocation || staffLocation();
  const months = [...new Set([initialPeriod, ...data.measurements.map(item => item.date.slice(0, 7)), ...data.events.map(item => item.date.slice(0, 7))])].sort().reverse();
  const locationsInScope = staffLocations().filter(place => !staffLocation() || staffLocation() === place.id);
  const counts = new Map();
  for (const place of locationsInScope) counts.set(place.id, { total: 0, done: 0 });
  const examined = new Set(data.measurements.filter(item => item.date.startsWith(period) && item.location)
    .map(item => `${item.location}/${item.child}`));
  for (const child of data.children) {
    const placeId = locationById(child.location) ? child.location : 'unknown';
    if (staffLocation() && placeId !== staffLocation()) continue;
    if (placeId !== 'unknown' && !counts.has(placeId)) continue;
    const count = counts.get(placeId) ?? { total: 0, done: 0 };
    count.total += 1;
    count.done += Number(examined.has(`${placeId}/${child.id}`));
    counts.set(placeId, count);
  }
  const label = id => id === 'unknown' ? 'Posyandu belum tercatat' : locationName(id);
  const locationChoices = [...locationsInScope.map(place => [place.id, place.name]), ...(counts.has('unknown') ? [['unknown', label('unknown')]] : [])];
  const rows = [...counts].filter(([id, count]) => selected ? id === selected : count.total > 0).map(([id, count]) => [
    h(label(id)), count.total, count.done, count.total - count.done, count.total ? fmt(100 * count.done / count.total) + '%' : '—',
  ]);
  return `${screenTitle('Analisis Lokasi Posyandu', (selected ? label(selected) : 'Semua Posyandu') + ' · ' + periodLabel(period))}
    <div class="dash-grid"><section class="panel stack"><h2>Rekap pemeriksaan per Posyandu</h2>
    <div class="form-grid monitor-filters">
      <label class="field">Periode<select data-change="monitoring-period">${options(months.map(month => [month, periodLabel(month)]), period)}</select></label>
      <label class="field">Tempat Posyandu<select data-change="analysis-location">${options([['', 'Semua Posyandu'], ...locationChoices], selected)}</select></label>
    </div>
    <p class="small muted">Cakupan dihitung dari balita yang diperiksa minimal sekali pada periode terpilih dibagi jumlah balita terdaftar di posyandu yang sama.</p>
    ${table(['Tempat Posyandu', 'Terdaftar', 'Diperiksa', 'Belum diperiksa', 'Cakupan'], rows, 'Rekap pemeriksaan per Posyandu')}
    <p class="callout">Sebaran status pertumbuhan belum dapat dinilai. ${pendingAssessment}.</p></section></div>`;
}
function dashboardFamily() {
  const children = familyChildren();
  const child = children.some(item => item.id === ui.familyChild) ? ui.familyChild : children[0]?.id;
  const recent = child ? records(child).at(-1) : null;
  const members = currentFamilyMembers();
  const selected = members.filter(member => member.selectedForExam !== false).length;
  const points = pointsForFamily(session.familyId);
  return `${screenTitle('Beranda keluarga', 'Ikuti pengukuran anak, jadwal, dan pelayanan Posyandu.')}
  <div class="dash-grid">
    <section class="panel family-card"><div class="panel-heading"><div class="stack-tight">
      <div class="eyebrow">Anggota keluarga</div><h2>${members.length} orang terdaftar</h2>
      <p class="small muted">${selected} anggota dipilih untuk pemeriksaan berikutnya</p></div>
      ${link('Kelola anggota', 'keluarga/anggota', 'secondary', 'arrow')}
    </div>${child ? `<div class="stack-tight"><h3>${h(personName(child))}</h3><p class="small muted">${recent ? 'Pemeriksaan terakhir · ' + dateLabel(recent.date) + ' · ' + h(locationName(recent.location)) : 'Belum ada pemeriksaan'}</p>${recent ? `<div class="reading numeric">${fmt(recent.weight)} kg</div><p class="small muted">Berat badan terakhir</p>` : ''}</div>` : '<p class="empty">Belum ada balita yang tertaut untuk pemantauan pertumbuhan.</p>'}
    <div class="actions">${child ? link('Lihat tumbuh kembang', 'keluarga/pertumbuhan', 'primary', 'arrow') : ''}${link('Ambil nomor layanan', 'keluarga/antrean', 'secondary')}</div></section>
    <div class="cols">
      <section class="panel"><div class="panel-heading"><div><h2>Tren berat badan</h2><p class="small muted">${h(personName(child))} · kg</p></div>${link('Buka riwayat', 'keluarga/riwayat', 'plain')}</div>${chart(child)}</section>
      <div class="stack">
        <section class="panel stack-tight"><h2>Jadwal berikutnya</h2>${eventSummary(currentEvents(householdById(session.familyId).location)[0])}${link('Lihat jadwal', 'keluarga/jadwal', 'plain', 'arrow')}</section>
        <section class="panel stack-tight"><h2>Bunda Teladan</h2><p class="small muted">${points} poin partisipasi</p>${link('Lihat pencapaian', 'keluarga/poin', 'plain')}</section>
      </div>
    </div>
  </div>`;
}

function kmsPage() {
  const children = staffChildren();
  const child = children.some(item => item.id === ui.kaderChild) ? ui.kaderChild : children[0]?.id;
  const day = today < DAY ? today : DAY;
  const location = ui.kmsLocation ?? staffLocation();
  return `${screenTitle('KMS Digital', 'Catat pengukuran untuk peserta yang dipilih.')}
  <div class="dash-grid">
    <section class="panel">
      <div class="panel-heading"><h2>Catat pemeriksaan</h2></div>
      <form data-form="kms">
        <div class="form-grid">
          <label class="field">Pilih anak<select name="child" required>${selection(children, child, true)}</select></label>
          <label class="field">Tanggal pemeriksaan<input name="date" type="date" required value="${day}" max="${today}"></label>
          ${locationField('location', { value: location, list: staffLocations() })}
          <label class="field">Berat badan (kg)<input name="weight" type="number" min="0.1" step="0.1" required placeholder="11,8"></label>
          <label class="field">Panjang atau tinggi badan (cm)<input name="height" type="number" min="1" step="0.1" required placeholder="86,2"></label>
          <label class="field">Posisi pengukuran<select name="position" required><option value="">Pilih posisi</option><option>Berdiri</option><option>Telentang</option></select></label>
          <label class="field">Lingkar kepala (cm)<input name="head" type="number" min="1" step="0.1" required placeholder="47,2"></label>
          <label class="field">Imunisasi<select name="immunization"><option value="">Lewati</option><option>Riwayat dicatat</option></select></label>
        </div>
        <label class="field section-gap">Catatan kader (opsional)<textarea name="note" maxlength="240" rows="2" placeholder="Isi catatan sesuai hasil pemeriksaan."></textarea></label>
        <p class="error-text" role="alert" hidden></p>
        <div class="actions"><button type="submit" class="btn primary">Simpan pemeriksaan</button>${link('Lihat tren', 'kader/pertumbuhan', 'plain')}</div>
      </form>
    </section>
    <section class="panel"><h2>Riwayat ${h(personName(child))}</h2>${measurementTable(child, staffLocation())}${measurementChanges(child)}</section>
  </div>`;
}
function growthPage(history = false) {
  const isFamily = role === 'keluarga';
  const children = isFamily ? familyChildren() : staffChildren();
  const requested = isFamily ? ui.familyChild : ui.kaderChild;
  const child = children.some(item => item.id === requested) ? requested : children[0]?.id;
  const type = types.find(item => item.key === ui.metric);
  const change = isFamily ? 'family-child' : 'kader-child';
  const location = isFamily ? ui.growthLocation : staffLocation();
  return `${screenTitle(history ? 'Riwayat kesehatan' : isFamily ? 'Tumbuh kembang' : 'Pemantauan pertumbuhan', 'Lihat pengukuran KMS berdasarkan anak dan lokasi pemeriksaan.')}
    <div class="dash-grid">
      <section class="panel">
        <div class="form-grid"><label class="field">Pilih anak<select data-change="${change}">${selection(children, child, !isFamily)}</select></label>
        ${isFamily ? locationField('growth-location', { label: 'Lokasi pemeriksaan', required: false, value: location, empty: 'Semua lokasi', change: 'growth-location' }) : ''}
        ${history ? '' : `<label class="field">Indikator<select data-change="metric">${options(types.map(item => [item.key, item.label]), type.key)}</select></label>`}</div>
        ${history ? '' : `<div class="panel-heading section-gap"><div><h2>${h(type.label)} (${type.unit})</h2><p class="small muted">${h(personName(child))} · ${location ? h(locationName(location)) : 'Semua lokasi'}</p></div></div>${chart(child, type.key, location)}`}
      </section>
      ${history ? '' : growthIndexPanel()}
      <section class="panel"><h2>Riwayat ${h(personName(child))}</h2>${measurementTable(child, location)}${isFamily ? '' : measurementChanges(child)}</section>
    </div>`;
}
function growthIndexPanel() {
  return `<section class="panel stack-tight"><h2>Indikator antropometri</h2>
    ${table(['Indikator', 'Nama'], growthIndexes, 'Daftar indikator antropometri')}
    <p class="small muted">Kurva pembanding WHO dan perubahan kategori belum tersedia pada sistem.</p>
    <p class="small"><a href="https://www.who.int/tools/child-growth-standards/">Standar Pertumbuhan Anak WHO</a> · <a href="https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-2-tahun-2020">Permenkes Nomor 2 Tahun 2020</a></p>
  </section>`;
}
function giziPage() {
  return `${screenTitle('Analisis status gizi', 'Tinjau pengukuran sebelum menentukan tindak lanjut.')}
    <div class="dash-grid">${growthIndexPanel()}
      <section class="panel stack-tight"><h2>Acuan penilaian</h2><p class="callout">${pendingAssessment}.</p>
      <p>Kriteria, skala, bobot, rumus, dan ambang belum ditetapkan.</p></section>
      <section class="panel stack-tight"><h2>Analisis prediktif</h2><p>${pill('Prediksi belum tersedia', 'warn')}</p>
      <p>Model belum tervalidasi. Gunakan riwayat pengukuran untuk meninjau perubahan yang tercatat.</p>
      <div>${link('Tinjau riwayat pengukuran', 'kader/pertumbuhan', 'secondary')}</div></section>
    </div>`;
}

function attendancePage() {
  const attendance = data.attendance.filter(item => atLocation(item, staffLocation()));
  const absent = attendance.filter(item => item.status === 'Tidak hadir');
  const {period, regions, children, examined} = monitoringData(ui.monitoringRegion);
  const overdue = children.filter(person => !examined.has(person.id));
  const regionField = `<label class="field">RT/RW<select data-change="monitoring-region">${options([['', 'Semua wilayah'], ...regions.map(region => [region, region])], ui.monitoringRegion)}</select></label>`;
  return `${screenTitle('Balita tidak hadir', 'Tinjau ketidakhadiran pada pemeriksaan 7 November 2026.')}
  <div class="dash-grid"><section class="panel stack-tight"><h2>Belum diperiksa · ${periodLabel(period)}</h2>
    ${monitoringFilters(period, regionField)}
    ${overdue.length ? `<ul class="list">${overdue.map(person => `<li><span>${h(person.name)} · ${h(locationName(person.location))}</span>${action('Catat pemeriksaan', 'choose-kms', 'plain', `data-child="${h(person.id)}"`)}</li>`).join('')}</ul>` : '<p class="empty">Tidak ada balita yang belum diperiksa dalam pilihan ini.</p>'}</section><section class="panel">
    <h2>Perlu tindak lanjut</h2>
    ${absent.length ? absent.map(item => `<div class="stack-tight"><div class="row between"><h3>${personName(item.child)}</h3>${pill(item.follow ? 'Tindak lanjut dicatat' : item.status, item.follow ? 'good' : 'warn')}</div>
    ${item.follow ? `<p class="small muted">${h(item.follow)}</p>` : ''}
    <details><summary>Catat tindak lanjut</summary><form data-form="follow" class="stack-tight"><input type="hidden" name="child" value="${item.child}"><label class="field">Tindakan<select name="status"><option>Pengingat telah dicatat</option><option>Jadwal kunjungan ulang dibahas</option><option>Perlu peninjauan kader</option></select></label><button type="submit" class="btn primary">Simpan tindak lanjut</button></form></details></div>`).join('') : '<p class="empty">Belum ada ketidakhadiran pada kegiatan ini.</p>'}
  </section><section class="panel"><h2>Daftar kehadiran</h2>${table(['Peserta', 'Status'], attendance.map(item => [h(personName(item.child)), pill(item.status, item.status === 'Hadir' ? 'good' : 'warn')]), 'Daftar kehadiran')}</section></div>`;
}
function reportRows(period, sessions) {
  const location = staffLocation();
  const measurements = data.measurements.filter(item => item.date.startsWith(period) && atLocation(item, location));
  const samples = reportSessionsForView.filter(item => item.date.startsWith(period) && atLocation(item, location)).flatMap(item => item.participants);
  const attendance = period === '2026-11' ? data.attendance.filter(item => atLocation(item, location)) : [];
  return [
    ['Kegiatan selesai', sessions.length],
    ['Kehadiran tercatat', attendance.filter(item => item.status === 'Hadir').length + samples.filter(row => row[2] === 'Hadir').length],
    ['Ketidakhadiran tercatat', attendance.filter(item => item.status === 'Tidak hadir').length + samples.filter(row => row[2] === 'Tidak hadir').length],
    ['Pemeriksaan KMS', measurements.length + samples.filter(row => row[3] === 'Berat dan tinggi badan' && row[4] === 'Selesai').length],
    ['Catatan imunisasi', measurements.filter(item => item.immunization).length + data.vaccinations.filter(item => item.date.startsWith(period) && atLocation(item, location)).length],
  ];
}
const participantColumns = ['Nama atau ID', 'Kategori', 'Kehadiran', 'Pemeriksaan', 'Status'];
const inventoryColumns = ['Barang', 'Satuan', 'Stok awal', 'Masuk', 'Terpakai', 'Sisa'];
function reportSessions(period, location) {
  const completed = data.events.filter(event => event.status === 'Selesai' && event.date.startsWith(period) && atLocation(event, location));
  const activities = [...completed, ...reportSessionsForView.filter(event => event.date.startsWith(period) && atLocation(event, location))];
  return activities.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).map(event => {
    const matches = item => item.eventId === event.id || (!item.eventId && event.id === 'nov-07' && item.location === event.location && (!item.date || item.date === event.date));
    const visits = new Map();
    for (const row of data.attendance.filter(matches)) visits.set(row.child, [personName(row.child), 'Balita', row.status, '—', 'Belum diperiksa']);
    for (const row of data.measurements.filter(matches)) visits.set(row.child, [personName(row.child), 'Balita', 'Hadir', 'Pemeriksaan KMS', 'Selesai']);
    const session = { ...event, officer: event.officer || 'Belum tercatat', address: fullLocationAddress(event.location), placeName: locationName(event.location) };
    const inventory = data.dispatches.filter(item => item.eventId === event.id).map(item => [item.item, item.unit, item.issued, 0, item.used, item.remaining]);
    return { ...session, participants: event.participants ?? [...visits.values()], inventory: event.inventory ?? inventory };
  });
}
function reportSessionDetails(sessions) {
  return sessions.length ? `<div class="stack report-sessions">${sessions.map(session => `<article class="report-session stack-tight">
    <h3>${h(session.placeName)} · ${h(session.name)}</h3>
    <p class="small muted">${dateLabel(session.date)} · ${h(session.end ? session.time.replace(':', '.') + '–' + timeLabel(session.end) : timeLabel(session.time))}</p>
    <p class="small">${h(session.address)}<br>Penanggung jawab ${h(session.officer)}</p>
    <h4>Peserta dan pemeriksaan</h4>${table(participantColumns, session.participants.map(row => row.map(h)), 'Peserta ' + session.placeName)}
    <h4>Stok per sesi</h4>${session.inventory.length ? table(inventoryColumns, session.inventory.map(row => row.map(h)), 'Stok ' + session.placeName) : '<p class="small muted">Stok sesi belum tercatat.</p>'}
  </article>`).join('')}</div>` : '<p class="empty">Belum ada sesi selesai pada periode dan lokasi ini.</p>';
}
const reportLabel = report => periodLabel(report.period) + ' | ' + (report.location ? locationName(report.location) : 'Semua lokasi');
function reportWithDetails(report) {
  if (report.sessions) return report;
  const sessions = reportSessions(report.period, report.location);
  const additions = sessions.filter(session => reportSessionsForView.some(item => item.id === session.id));
  if (!additions.length) return { ...report, sessions };
  const participants = additions.flatMap(session => session.participants);
  const extraCounts = [
    additions.length,
    participants.filter(row => row[2] === 'Hadir').length,
    participants.filter(row => row[2] === 'Tidak hadir').length,
    participants.filter(row => row[3] === 'Berat dan tinggi badan' && row[4] === 'Selesai').length,
  ];
  return { ...report, sessions, rows: report.rows.map(([label, count], index) => [label, Number(count) + (extraCounts[index] ?? 0)]) };
}
function reportPreview(report) {
  return `<div class="panel stack"><div class="row between"><h2 id="report-dialog-title">Pratinjau laporan</h2>${action('Tutup', 'close-dialog', 'plain')}</div>
    <div><h3>${h(report.kind)}</h3><p class="small muted">Posyandu Karangsatria · ${periodLabel(report.period)} · ${report.location ? h(locationName(report.location)) + ' · ' : ''}Perlu verifikasi pengelola</p></div>
    ${table(['Ringkasan', 'Jumlah'], report.rows, 'Rekap laporan')}
    ${reportSessionDetails(report.sessions)}</div>`;
}
function reportsPage() {
  const report = data.report ? reportWithDetails(data.report) : null;
  const approved = report?.status === 'Disetujui';
  return `${screenTitle('Laporan Posyandu', 'Buat rekap kegiatan untuk ditinjau dan diunduh.')}
    <div class="dash-grid">
      <section class="panel"><h2>Buat laporan</h2><form data-form="report"><div class="form-grid">
        <label class="field">Periode<select name="period">${options([...new Set(['2026-10', '2026-11', '2026-12', ...data.events.map(item => item.date.slice(0, 7)), ...data.measurements.map(item => item.date.slice(0, 7))])].sort().map(month => [month, periodLabel(month)]), ui.reportPeriod)}</select></label>
        <label class="field">Jenis laporan<select name="kind">${options([['Rekap kegiatan bulanan', 'Rekap kegiatan bulanan'], ['Rekap pemeriksaan', 'Rekap pemeriksaan']], ui.reportKind)}</select></label>
      </div><div class="actions"><button class="btn ${report && !approved ? 'secondary' : 'primary'}" type="submit">Buat draf</button></div></form></section>
      <section class="panel">
        <div class="panel-heading"><h2>Rekap laporan</h2>${report ? pill(report.status, approved ? 'good' : 'warn') : ''}</div>
        ${report ? `<h3>${h(report.kind)}</h3><p class="small muted">${periodLabel(report.period)} · ${report.location ? h(locationName(report.location)) : 'Semua lokasi'}</p>
          <div style="margin-top:10px">${table(['Ringkasan', 'Jumlah'], report.rows, 'Rekap laporan')}</div>
          <h3 class="section-gap">Rincian per sesi</h3>${reportSessionDetails(report.sessions)}
          <div class="actions">${action('Pratinjau laporan', 'preview-report')}
          ${approved ? action('Unduh PDF', 'pdf', 'secondary') + action('Unduh Excel', 'xlsx', 'secondary') : action('Setujui laporan', 'approve-report', 'primary')}</div>
          ${approved ? '<p class="small muted">Rekap siap diunduh.</p>' : '<p class="small muted">Opsi PDF dan Excel aktif setelah laporan disetujui.</p>'}
          <dialog aria-labelledby="report-dialog-title" id="report-preview">${reportPreview(report)}</dialog>` : '<p class="empty">Belum ada draf. Pilih periode untuk membuat rekap.</p>'}
      </section>
    </div>`;
}
function settingsPage() {
  const isFamily = role === 'keluarga';
  return `${screenTitle(isFamily ? 'Akun saya' : 'Pengaturan', 'Kelola preferensi akun dan data pada perangkat ini.')}
    <section class="panel stack">
      ${isFamily ? `<div><h2>${h(householdById(session.familyId).name)}</h2><p class="small muted">KK ${h(maskedKK(session.familyId))} · ${currentFamilyMembers().length} anggota keluarga</p>
        <label class="check"><input type="checkbox" data-change="alias"${data.aliases[session.familyId] ? ' checked' : ''}> Izinkan nama samaran pada daftar partisipasi.</label></div>` : '<div><h2>Akun kader</h2><p class="small muted">Posyandu Desa Karangsatria</p></div>'}
      <details><summary>Pemeliharaan data pada perangkat ini</summary><p class="small muted">Tindakan ini hanya memulihkan susunan data lokal pada perangkat ini. Tindakan ini tidak menghapus data yang tersimpan di Supabase.</p><div class="actions">${window.posyanduSupabaseConfigured ? '<p class="small muted">Data keluarga, anggota, dan hasil skrining dikelola melalui database Supabase.</p>' : action('Pulihkan data lokal', 'reset-initial-data', 'secondary')}</div></details>
    </section>`;
}

const kaderPages = {
  dashboard: dashboardKader, kms: kmsPage, pertumbuhan: growthPage, gizi: giziPage,
  kehadiran: attendancePage, laporan: reportsPage, wilayah: regionPage, pengaturan: settingsPage,
};
const familyPages = {
  dashboard: dashboardFamily, pertumbuhan: growthPage, riwayat: () => growthPage(true), pengaturan: settingsPage,
};
function render(focus = false) {
  const desired = location.hash.slice(1) || 'beranda';
  const [area, page] = desired.split('/');
  const pages = area === 'kader' ? kaderPages : familyPages;
  if (area === 'kader' || area === 'keluarga') {
    if (role !== area || !Object.hasOwn(pages, page)) {
      if (Object.hasOwn(pages, page)) {
        ui.pendingRoute = desired;
        ui.loginRole = area;
      }
      location.replace('#masuk');
      return;
    }
    $('#app').innerHTML = shell(area === 'kader' ? kaderNav : familyNav, page, pages[page]());
  } else {
    if (area === 'masuk') {
      if (page === 'orang-tua' && desired !== route) {
        ui.loginRole = 'keluarga';
        ui.pendingRoute = '';
      }
      if (page === 'lupa-sandi') $('#app').innerHTML = passwordResetRequestPage();
      else if (page === 'ubah-sandi') $('#app').innerHTML = passwordResetCompletePage();
      else $('#app').innerHTML = login();
    } else if (area === 'daftar') {
      $('#app').innerHTML = registerFamilyPage();
    } else if (area === 'lokasi' && page === 'daftar') {
      $('#app').innerHTML = publicHeader() + '<main class="wrap public-directory" id="content" tabindex="-1">' + directoryPage() + '</main>' + footer();
    } else {
      $('#app').innerHTML = landing();
    }
  }
  if (desired !== route) window.scrollTo(0, 0);
  route = desired;
  if (area === 'layanan') $('#services-title')?.focus();
  else if (area === 'lokasi' && !page) $('#home-location-title')?.focus();
  else if (focus) $('#page-title')?.focus({ preventScroll: true });
}
function navigate(path) {
  if (location.hash === '#' + path) render(true);
  else location.hash = path;
}
function say(message) {
  const toast = $('#notice');
  toast.hidden = false;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
}
function changed(message) {
  save();
  render(true);
  say(message);
}
function formError(form, name, message) {
  const error = $('.error-text', form);
  if (!error) { say(message); return; }
  error.hidden = false;
  error.textContent = message;
  if (name) {
    form.elements[name].setAttribute('aria-invalid', 'true');
    form.elements[name].focus();
  }
}
function chooseRole(nextRole, familyId = '') {
  session = { role: nextRole, familyId, issuedAt: Date.now(), lastActivity: Date.now() };
  role = nextRole;
  if (!window.posyanduSupabaseConfigured) writeStorage('sessionStorage', SESSION_KEY, JSON.stringify(session));
  ui.familyChild = familyChildren()[0]?.id ?? '';
  ui.growthLocation = '';
  ui.vaccineLocation = '';
  ui.familyScheduleLocation = undefined;
  ui.queueChild = '';
  ui.queueLocation = '';
  ui.queueEvent = '';
  ui.screeningDraft = null;
  const target = nextRole && ui.pendingRoute.startsWith(nextRole + '/') ? ui.pendingRoute : '';
  ui.pendingRoute = '';
  navigate(nextRole ? target || nextRole + '/dashboard' : 'masuk');
}

const actions = {
  logout: () => chooseRole(''),
  menu(button) {
    const open = $('#portal-nav').classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
  },
  'choose-kms'(button) {
    ui.kaderChild = button.dataset.child;
    ui.kmsLocation = staffLocation() || personById(ui.kaderChild)?.location || '';
    navigate('kader/kms');
  },
  'preview-report'(button) {
    lastFocus = button;
    $('#report-preview').showModal();
  },
  'close-dialog'() {
    document.querySelector('dialog[open]')?.close();
    lastFocus?.focus();
  },
  'approve-report'() {
    if (data.report?.status !== 'Draf') return;
    data.report.status = 'Disetujui';
    changed('Laporan disetujui. PDF dan Excel siap diunduh.');
  },
  pdf() {
    if (data.report?.status === 'Disetujui') PosyanduExports.download('pdf', reportWithDetails(data.report), reportLabel(data.report));
  },
  xlsx() {
    if (data.report?.status === 'Disetujui') PosyanduExports.download('xlsx', reportWithDetails(data.report), reportLabel(data.report));
  },
  'reset-initial-data'() {
    data = structuredClone(seed);
    syncHouseholdList();
    ensureFamilyMembers();
    ui.screeningDraft = null;
    changed('Susunan data lokal pada perangkat dipulihkan.');
  },
};

const forms = {
  kms(form, fields) {
    const child = staffChildren().find(person => person.id === fields.get('child'));
    const day = fields.get('date');
    if (!child || day < child.born || day > today) {
      formError(form, 'date', 'Gunakan tanggal sejak anak lahir hingga hari ini.');
      return;
    }
    const location = fields.get('location');
    if (!staffLocations().some(item => item.id === location)) {
      formError(form, 'location', 'Pilih lokasi pemeriksaan.');
      return;
    }
    const entry = {
      note: String(fields.get('note') ?? '').trim(),
      child: child.id, date: day, location, weight: Number(fields.get('weight')), height: Number(fields.get('height')),
      head: Number(fields.get('head')), position: fields.get('position'), immunization: fields.get('immunization'),
    };
    const index = data.measurements.findIndex(item => item.child === child.id && item.date === day && item.location === location);
    const relatedEvents = data.events.filter(item => item.location === location && item.date === day && item.status !== 'Dibatalkan');
    const eventId = data.measurements[index]?.eventId ?? (relatedEvents.length === 1 ? relatedEvents[0].id : undefined);
    if (eventId) entry.eventId = eventId;
    if (index < 0) data.measurements.push(entry);
    else {
      const prior = data.measurements[index];
      const fields = ['weight', 'height', 'head', 'position', 'immunization', 'note'];
      const edits = fields.filter(field => (prior[field] ?? '') !== (entry[field] ?? ''))
        .map(field => ({ field, before: prior[field], after: entry[field] }));
      if (edits.length) (data.measurementChanges ??= []).push({ child: child.id, date: day, location, at: new Date().toISOString(), edits });
      data.measurements[index] = entry;
    }
    ui.kaderChild = child.id;
    ui.kmsLocation = location;
    if (staffLocation() && staffLocation() !== location) ui.kaderLocation = location;
    changed(index < 0 ? 'Pemeriksaan tersimpan untuk ' + child.name + '.' : 'Pemeriksaan diperbarui untuk ' + child.name + '.');
  },
  follow(_form, fields) {
    const item = data.attendance.find(row => row.child === fields.get('child'));
    if (item?.status !== 'Tidak hadir') return;
    item.follow = fields.get('status');
    changed('Tindak lanjut dicatat.');
  },
  report(_form, fields) {
    ui.reportPeriod = fields.get('period');
    ui.reportKind = fields.get('kind');
    const sessions = reportSessions(ui.reportPeriod, staffLocation());
    data.report = { period: ui.reportPeriod, kind: ui.reportKind, location: staffLocation(), rows: reportRows(ui.reportPeriod, sessions), sessions, status: 'Draf' };
    changed('Draf laporan siap ditinjau.');
  },
};

const mutatingActions = new Set(['approve-report', 'reset-initial-data', 'cancel-event', 'queue-step', 'queue-cancel', 'screening-step', 'reward-claim', 'reward-step', 'issue-certificate', 'verify-directory']);
const mutatingForms = new Set(['kms', 'follow', 'event', 'reminder', 'points', 'point-settings', 'stock', 'dispatch', 'report', 'register-child', 'register-family', 'update-exam-members', 'family-add-member', 'vaccination', 'queue', 'screening-finish', 'save-directory']);

function withCurrentData(callback) {
  let callbackStarted = false;
  function run() {
    // In online mode, live records are loaded from Supabase after authentication.
    // Never replace those records with the browser's intentionally empty/legacy cache.
    if (!window.posyanduSupabaseConfigured
      && (readStorage('localStorage', DB_KEY) || LEGACY_DB_KEYS.some(key => readStorage('localStorage', key)))) {
      data = loadData();
      syncHouseholdList();
      ensureFamilyMembers();
    }
    callbackStarted = true;
    return callback();
  }
  if (navigator.locks && typeof navigator.locks.request === 'function') {
    navigator.locks.request(DB_KEY, run).catch(error => {
      // If Web Locks rejects before invoking the callback (for example, due to
      // browser/preview restrictions), run the action without the cross-tab lock
      // rather than silently preventing the form from reaching its save handler.
      console.error('Web Lock gagal untuk perubahan Posyandu:', error);
      if (!callbackStarted) {
        try {
          const result = run();
          if (result && typeof result.catch === 'function') {
            result.catch(fallbackError => {
              console.error('Aksi setelah fallback Web Lock gagal:', fallbackError);
              say('Perubahan belum tersimpan. Periksa Console untuk detail kesalahan.');
            });
          }
        } catch (fallbackError) {
          console.error('Fallback perubahan Posyandu gagal:', fallbackError);
          say('Perubahan belum tersimpan. Periksa Console untuk detail kesalahan.');
        }
      } else {
        say('Perubahan belum tersimpan. Periksa Console untuk detail kesalahan.');
      }
    });
  } else {
    run();
  }
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-action]');
  if (trigger) {
    const name = trigger.dataset.action;
    if (mutatingActions.has(name)) withCurrentData(() => actions[name]?.(trigger));
    else actions[name]?.(trigger);
  }
  if (event.target.closest('.skip')) {
    event.preventDefault();
    $('#content')?.focus();
  }
});
document.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const name = form.dataset.form;
  const fields = new FormData(form);
  if (mutatingForms.has(name)) withCurrentData(() => forms[name]?.(form, fields));
  else forms[name]?.(form, fields);
});
const selectHandlers = {};
document.addEventListener('change', event => {
  const control = event.target;
  if (control.matches('[aria-invalid="true"]')) control.removeAttribute('aria-invalid');
  if (control.matches('[data-location-select]')) {
    const note = $('[data-location-note]', control.closest('.location-control'));
    const address = localAddress(control.value);
    note.hidden = !address;
    note.textContent = address ?? '';
  }
  const key = control.dataset.change;
  if (!key) return;
  if (key === 'alias') {
    withCurrentData(() => {
      data.aliases[session.familyId] = control.checked;
      save();
      say('Preferensi alias tersimpan.');
    });
    return;
  }
  if (Object.hasOwn(selectHandlers, key)) {
    selectHandlers[key](control);
    return;
  }
  const mapping = {
    'family-child': 'familyChild', 'kader-child': 'kaderChild', metric: 'metric',
    'growth-location': 'growthLocation', 'staff-location': 'kaderLocation', 'dashboard-location': 'kaderLocation',
    'monitoring-period': 'monitoringPeriod', 'monitoring-region': 'monitoringRegion', 'dashboard-metric': 'dashboardMetric', 'analysis-location': 'analysisLocation',
  };
  if (!mapping[key]) return;
  ui[mapping[key]] = control.value;
  if (mapping[key] === 'kaderLocation') {
    ui.kmsLocation = undefined;
    ui.monitoringRegion = '';
    ui.analysisLocation = '';
    ui.screeningLocation = '';
  }
  render();
  $(`[data-change="${key}"]`)?.focus({ preventScroll: true });
});
window.addEventListener('storage', event => {
  if (event.key !== DB_KEY) return;
  data = loadData();
  syncHouseholdList();
  ensureFamilyMembers();
  if (/\/(dashboard|antrean|skrining|keluarga|anggota)$/.test(route) && !ui.screeningDraft && !document.querySelector('dialog[open]')) render();
});
document.addEventListener('pointerdown', refreshSessionActivity, { passive: true });
document.addEventListener('keydown', refreshSessionActivity);
function refreshSessionActivity() {
  if (!session.role) return;
  session.lastActivity = Date.now();
  if (window.posyanduSupabaseConfigured) writeStorage('sessionStorage', ACTIVITY_KEY, String(session.lastActivity));
  else writeStorage('sessionStorage', SESSION_KEY, JSON.stringify(session));
}
setInterval(() => {
  if (session.role && Date.now() - Number(session.lastActivity ?? session.issuedAt ?? 0) >= 30 * 60 * 1000) {
    try { window.posyanduSupabase?.auth.signOut(); } catch { /* The local session is still cleared. */ }
    try { window.sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* Browser storage may be unavailable. */ }
    if (typeof authProfileRole !== 'undefined') authProfileRole = '';
    chooseRole('');
    say('Sesi berakhir karena tidak ada aktivitas selama 30 menit. Silakan masuk kembali.');
  }
}, 60 * 1000);
window.addEventListener('hashchange', () => render(true));
