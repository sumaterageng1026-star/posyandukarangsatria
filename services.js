'use strict';

let pendingFamilyRegistration = null;
let authProfileRole = '';
let screeningQuestionBank = (screeningQuestions || []).map((question, index) => ({
  id: 'local-' + index, code: 'feedback-' + String(index + 1).padStart(2, '0'),
  question_text: question, choices: [...(screeningChoiceSets?.[index] || screeningChoices)], version: 1, is_active: true,
}));
let activeScreeningQuestions = screeningQuestionBank.filter(question => question.is_active);
let adminAccounts = [];
const supabaseClient = () => {
  if (!window.posyanduSupabase) throw new Error('Integrasi database belum aktif. Isi URL project dan anon/publishable key Supabase pada supabase-config.js.');
  return window.posyanduSupabase;
};

const isAdministrator = () => authProfileRole === 'admin';

// Kegiatan/jadwal disimpan di Supabase; data.events hanya menjadi cache tampilan.
function mapRemoteEvent(row) {
  return {
    id: row.id, name: row.name, location: normalizeLocationId(row.location_id),
    date: row.event_date, time: String(row.event_time || '08:00').slice(0, 5),
    status: row.status, vitaminA: row.vitamin_a === true,
    vaccines: Array.isArray(row.vaccines) ? row.vaccines : [],
    place: row.place || '', description: row.description || '',
  };
}
async function loadRemoteEvents(client, locationIds = []) {
  let query = client.from('posyandu_events').select('*').order('event_date').order('event_time');
  if (locationIds.length) query = query.in('location_id', locationIds);
  const { data: rows, error } = await query;
  if (error) throw error;
  data.events = (rows || []).map(mapRemoteEvent);
  return data.events;
}
async function saveRemoteEvent(client, event) {
  const payload = {
    name: event.name, location_id: event.location, event_date: event.date,
    event_time: event.time, status: event.status, vitamin_a: event.vitaminA,
    vaccines: event.vaccines, place: event.place || '', description: event.description || '',
  };
  const { data: row, error } = await client.from('posyandu_events').insert(payload).select('*').single();
  if (error) throw error;
  const mapped = mapRemoteEvent(row);
  data.events = [...data.events.filter(item => item.id !== mapped.id), mapped];
  return mapped;
}
async function cancelRemoteEvent(client, eventId) {
  const { data: row, error } = await client.from('posyandu_events')
    .update({ status: 'Dibatalkan' }).eq('id', eventId).eq('status', 'Terjadwal')
    .select('*').single();
  if (error) throw error;
  const mapped = mapRemoteEvent(row);
  data.events = data.events.map(item => item.id === mapped.id ? mapped : item);
  return mapped;
}

// Antrean disimpan di Supabase agar pendaftaran keluarga dan daftar kader selalu memakai data yang sama.
function mapRemoteQueue(row) {
  const number = Number(row.queue_number || 0);
  return {
    id: row.id,
    code: 'A-' + String(number).padStart(3, '0'),
    queueNumber: number,
    child: row.child_id,
    familyId: row.household_id,
    eventId: row.event_id,
    location: row.location_id,
    date: row.service_date,
    time: String(row.service_time || '08:00').slice(0, 5),
    service: row.service_type,
    status: row.status || 'Menunggu',
    createdAt: row.created_at || '',
  };
}
async function loadRemoteQueues(client, { householdId = '', locationIds = [] } = {}) {
  let query = client.from('posyandu_queues').select('*').order('created_at', { ascending: false });
  if (householdId) query = query.eq('household_id', householdId);
  if (locationIds.length) query = query.in('location_id', locationIds);
  const { data: rows, error } = await query;
  if (error) throw error;
  data.queues = (rows || []).map(mapRemoteQueue);
  return data.queues;
}

const safeDateJakarta = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const safeTimeJakarta = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(value));


// Persediaan, transaksi, dan distribusi stok dimuat bersama dari Supabase.
function mapRemoteStockLot(row) {
  return {
    id: row.id, location: normalizeLocationId(row.location_id), item: row.item_name,
    category: row.category || 'Lainnya', lot: row.lot_number || 'UMUM',
    kind: row.stock_type || 'Habis pakai', unit: row.unit || 'pcs',
    count: Number(row.quantity || 0), min: Number(row.min_quantity || 0),
    expiry: row.expiry_date || '', notes: row.notes || '',
    active: row.is_active !== false, createdAt: row.created_at || '', updatedAt: row.updated_at || '',
  };
}
function mapRemoteStockTransaction(row, lots) {
  const lot = lots.find(item => item.id === row.stock_lot_id);
  return {
    id: row.id, lotId: row.stock_lot_id, item: row.item_name || lot?.item || 'Barang diarsipkan',
    lot: row.lot_number || lot?.lot || '', unit: row.unit || lot?.unit || '', location: normalizeLocationId(row.location_id),
    direction: row.transaction_type, amount: Number(row.quantity || 0),
    balanceAfter: Number(row.balance_after || 0), reference: row.reference_text || '',
    notes: row.notes || '', createdAt: row.created_at || '',
  };
}
function mapRemoteStockDispatch(row) {
  return {
    id: row.id, lotId: row.stock_lot_id, eventId: row.event_id || '',
    origin: normalizeLocationId(row.origin_location_id), location: normalizeLocationId(row.destination_location_id),
    date: row.service_date, item: row.item_name, lot: row.lot_number,
    kind: row.stock_type, unit: row.unit, issued: Number(row.quantity_issued || 0),
    used: Number(row.quantity_used || 0), returned: Number(row.quantity_returned || 0),
    remaining: Number(row.destination_balance || 0), notes: row.notes || '', createdAt: row.created_at || '',
  };
}
async function loadRemoteStock(client, locationIds = []) {
  let lotsQuery = client.from('posyandu_stock_lots').select('*').order('item_name').order('lot_number');
  let transactionQuery = client.from('posyandu_stock_transactions').select('*').order('created_at', { ascending: false }).limit(500);
  let dispatchQuery = client.from('posyandu_stock_dispatches').select('*').order('created_at', { ascending: false }).limit(500);
  if (locationIds.length) {
    lotsQuery = lotsQuery.in('location_id', locationIds);
    transactionQuery = transactionQuery.in('location_id', locationIds);
  }
  const [lotsResult, transactionsResult, dispatchesResult] = await Promise.all([lotsQuery, transactionQuery, dispatchQuery]);
  if (lotsResult.error) throw lotsResult.error;
  if (transactionsResult.error) throw transactionsResult.error;
  if (dispatchesResult.error) throw dispatchesResult.error;
  data.lots = (lotsResult.data || []).map(mapRemoteStockLot);
  data.transactions = (transactionsResult.data || []).map(row => mapRemoteStockTransaction(row, data.lots));
  data.dispatches = (dispatchesResult.data || []).map(mapRemoteStockDispatch);
  return { lots: data.lots, transactions: data.transactions, dispatches: data.dispatches };
}


async function loadAdminAccounts(client) {
  const [{ data: profiles, error: profileError }, { data: assignments, error: assignmentError }] = await Promise.all([
    client.from('profiles').select('id,full_name,email,role,is_active,email_confirmed,created_at').order('created_at', { ascending: false }),
    client.from('kader_locations').select('user_id,location_id'),
  ]);
  if (profileError) throw profileError;
  if (assignmentError) throw assignmentError;
  adminAccounts = (profiles || []).map(profile => ({
    ...profile,
    locations: (assignments || []).filter(item => item.user_id === profile.id).map(item => item.location_id),
  }));
  return adminAccounts;
}

function adminAccountsPage() {
  if (!isAdministrator()) return `${screenTitle('Manajemen akun', 'Halaman ini hanya tersedia untuk administrator.')}<section class="panel"><p class="empty">Akses ditolak.</p></section>`;
  return `${screenTitle('Manajemen akun', 'Atur peran, status akun, dan penugasan kader. Akun kader harus dibuat terlebih dahulu melalui Supabase Authentication atau pendaftaran warga.')} 
    <section class="panel stack">
      <div class="row between"><h2>Daftar akun terdaftar</h2>${action('Muat ulang akun', 'refresh-admin-accounts', 'secondary')}</div>
      <p class="small muted">Pendaftaran publik selalu membuat akun keluarga. Admin dapat mengubah akun yang sudah terdaftar menjadi kader, menentukan lokasi tugas, atau menonaktifkan akun. Akun admin tidak dapat diubah dari halaman ini.</p>
      ${adminAccounts.map(account => `<article class="account-card stack-tight">
        <div class="row between"><div class="stack-tight"><strong>${h(account.full_name || 'Nama belum diisi')}</strong><span class="small muted">${h(account.email || 'Email tidak tersedia')} · dibuat ${h(safeDateJakarta(account.created_at))}</span></div>
          <div class="row">${pill(account.email_confirmed ? 'Email terverifikasi' : 'Email belum terverifikasi', account.email_confirmed ? 'good' : 'warn')}${pill(account.is_active ? 'Aktif' : 'Nonaktif', account.is_active ? 'good' : 'bad')}</div>
        </div>
        ${account.role === 'admin' ? '<p class="small muted">Akun administrator. Peran dan status administrator dikelola melalui prosedur pemilik project agar tidak terjadi penguncian akses.</p>' : !account.email_confirmed ? '<p class="callout">Akun belum dapat diberi akses kader atau dinonaktifkan sebelum pemilik email menyelesaikan verifikasi.</p>' : `<form data-form="admin-update-account" data-user-id="${h(account.id)}" class="stack">
          <div class="form-grid">
            <label class="field">Peran<select name="role"><option value="keluarga"${account.role === 'keluarga' ? ' selected' : ''}>Warga / keluarga</option><option value="kader"${account.role === 'kader' ? ' selected' : ''}>Kader</option></select></label>
            <label class="check"><input type="checkbox" name="active"${account.is_active ? ' checked' : ''}> Akun aktif dan boleh masuk</label>
          </div>
          <fieldset class="stack-tight"><legend>Wilayah tugas kader</legend><div class="choice-grid">${locations.map(location => `<label class="check"><input type="checkbox" name="location" value="${h(location.id)}"${account.locations.includes(location.id) ? ' checked' : ''}> ${h(location.name)}</label>`).join('')}</div></fieldset>
          ${inlineError}<div class="actions">${submitButton('Simpan pengaturan akun')}</div>
        </form>`}
      </article>`).join('') || '<p class="empty">Belum ada akun. Warga dapat mendaftar dari halaman awal.</p>'}
    </section>`;
}

async function loadRemoteQuestionBank(client) {
  const { data: rows, error } = await client.from('screening_questions').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  screeningQuestionBank = (rows || []).map(row => ({
    id: row.id, code: row.code, question_text: row.question_text,
    choices: Array.isArray(row.choices) ? row.choices : [], version: row.version || 1,
    is_active: row.is_active === true,
  }));
  activeScreeningQuestions = screeningQuestionBank.filter(question => question.is_active && question.question_text && question.choices.length >= 2);
}

function mapRemoteScreening(row, members, families) {
  const respondent = (members || []).find(member => member.id === row.respondent_member_id);
  const family = (families || []).find(item => item.id === row.household_id);
  const rawAnswers = Array.isArray(row.answers) ? row.answers : [];
  const questions = rawAnswers.map((answer, index) => answer.question_text || answer.question || ('Pertanyaan ' + (index + 1)));
  const answers = rawAnswers.map(answer => typeof answer === 'string' ? answer : (answer.answer ?? 'Belum dijawab'));
  const submittedAt = row.submitted_at || new Date().toISOString();
  return {
    id: row.id,
    code: 'SK-' + String(row.id).slice(0, 8).toUpperCase(),
    familyId: row.household_id,
    personId: row.respondent_member_id,
    respondentName: respondent?.name || 'Anggota keluarga',
    respondentRelation: respondent?.relation || '',
    answeredBy: family?.name || 'Akun keluarga',
    location: row.location_id,
    date: safeDateJakarta(submittedAt),
    time: safeTimeJakarta(submittedAt),
    status: row.status || 'Menunggu',
    contactTime: row.contact_time || '',
    questions,
    answers,
    submittedAt,
  };
}

async function fetchRemoteScreenings(client, filters = {}) {
  let query = client.from('screening_sessions').select('*').order('submitted_at', { ascending: false });
  if (filters.householdId) query = query.eq('household_id', filters.householdId);
  if (filters.locationIds?.length) query = query.in('location_id', filters.locationIds);
  const { data: rows, error } = await query;
  if (error) throw error;
  const mapped = (rows || []).map(row => mapRemoteScreening(row, data.familyMembers || [], data.households || []));
  data.screenings = mapped;
  return mapped;
}

const submitButton = label => `<button type="submit" class="btn primary">${h(label)}</button>`;
const inlineError = '<p class="error-text" role="alert" hidden></p>';
const setFilter = (key, value, control) => {
  ui[key] = value;
  render();
  if (control) $(`[data-change="${control}"]`)?.focus({ preventScroll: true });
};
const tabButton = (title, actionId, value, active) =>
  action(title, actionId, 'secondary', `data-tab="${h(value)}" aria-pressed="${active === value}"`);

function showDetails(title, content, trigger) {
  const current = $('#detail-dialog');
  if (current?.open) current.close();
  current?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'detail-dialog';
  dialog.setAttribute('aria-labelledby', 'detail-title');
  dialog.innerHTML = `<div class="panel stack"><div class="row between">
    <h2 id="detail-title">${h(title)}</h2>${action('Tutup', 'close-dialog', 'plain')}
    </div>${content}</div>`;
  $('#app').append(dialog);
  lastFocus = trigger;
  dialog.showModal();
}

const normalizeContact = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');

function login() {
  const isStaff = ui.loginRole === 'kader';
  const form = isStaff
    ? `<form data-form="staff-login" class="stack">
        <label class="field">Email kader<input type="email" name="email" autocomplete="username" required></label>
        <label class="field">Kata sandi<input type="password" name="password" autocomplete="current-password" required></label>
        ${inlineError}<div class="row">${submitButton('Masuk sebagai kader')}</div><p class="small muted">Akun kader dibuat oleh administrator Posyandu. Pendaftaran publik hanya untuk warga.</p>${link('Lupa kata sandi?', 'masuk/lupa-sandi', 'plain')}
      </form>`
    : `<form data-form="parent-login" class="stack">
        <label class="field">Email terdaftar<input name="email" type="email" autocomplete="username" autocapitalize="none" required></label>
        <label class="field">Kata sandi<input name="password" type="password" autocomplete="current-password" required></label>
        ${inlineError}<div class="row">${submitButton('Masuk sebagai warga')}</div>${link('Lupa kata sandi?', 'masuk/lupa-sandi', 'plain')}
      </form>`;
  const setupNotice = window.posyanduSupabaseConfigured ? '' : '<p class="callout">Layanan akun online belum diaktifkan. Pengelola perlu mengisi URL dan publishable key Supabase serta mengaktifkan SMTP sebelum warga dapat masuk atau mendaftar.</p>';
  return `${publicHeader()}<main id="content" class="wrap" tabindex="-1"><section class="login login-layout">
    <header class="login-intro stack"><div class="eyebrow">Posyandu Karangsatria</div>
      <h1 id="page-title" tabindex="-1">Masuk ke portal</h1>
      <p class="muted">Gunakan akun kader atau akun keluarga yang sudah didaftarkan. Warga yang belum memiliki akun dapat membuat akun dan memverifikasi email terlebih dahulu.</p>
      ${link('Kembali ke beranda', 'beranda', 'plain', 'back')}
    </header>
    <section class="panel login-panel"><div class="tabs" aria-label="Pilih peran">
      ${tabButton('Orang tua atau wali', 'login-role', 'keluarga', ui.loginRole)}
      ${tabButton('Kader / Admin', 'login-role', 'kader', ui.loginRole)}
      </div>${setupNotice}<h2>${isStaff ? 'Masuk sebagai kader' : 'Masuk sebagai orang tua atau wali'}</h2>${form}
      ${!isStaff ? `<div class="note-panel stack-tight"><strong>Belum punya akun?</strong><p class="small muted">Buat akun keluarga menggunakan email aktif. Kode OTP akan dikirim ke email untuk verifikasi.</p>${link('Daftar akun keluarga', 'daftar', 'primary', 'arrow')}</div>` : ''}
    </section>
  </section></main>${footer()}`;
}
function passwordResetRequestPage() {
  return `${publicHeader()}<main id="content" class="wrap public-section" tabindex="-1">
    ${screenTitle('Pulihkan kata sandi', 'Masukkan email akun Anda. Tautan pemulihan akan dikirim melalui Supabase Auth.')}
    <section class="panel stack" style="max-width:640px">
      <form data-form="request-password-reset" class="stack">
        <label class="field">Email terdaftar<input type="email" name="email" autocomplete="email" required></label>
        ${inlineError}<div class="actions">${submitButton('Kirim tautan pemulihan')}${link('Kembali ke masuk', 'masuk/orang-tua', 'plain')}</div>
      </form>
    </section>
  </main>${footer()}`;
}
function passwordResetCompletePage() {
  return `${publicHeader()}<main id="content" class="wrap public-section" tabindex="-1">
    ${screenTitle('Buat kata sandi baru', 'Gunakan kata sandi kuat yang belum pernah dipakai untuk akun lain.')}
    <section class="panel stack" style="max-width:640px">
      <form data-form="save-new-password" class="stack">
        <label class="field">Kata sandi baru (minimal 12 karakter)<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
        <label class="field">Ulangi kata sandi<input type="password" name="confirm-password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
        ${inlineError}<div class="actions">${submitButton('Simpan kata sandi baru')}</div>
      </form>
    </section>
  </main>${footer()}`;
}

function memberRow(index = 1) {
  const rowId = crypto.randomUUID();
  return `<div class="member-entry" data-member-row>
    <input type="hidden" name="member-key" value="${rowId}">
    <div class="form-grid">
      <label class="field">Nama anggota<input name="member-name" maxlength="80"></label>
      <label class="field">Tanggal lahir<input name="member-born" type="date" max="${today}"></label>
      <label class="field">Jenis kelamin<select name="member-sex"><option value="">Pilih</option><option>Perempuan</option><option>Laki-laki</option></select></label>
      <label class="field">Hubungan<select name="member-relation"><option value="">Pilih hubungan</option><option>Suami</option><option>Istri</option><option>Anak</option><option>Orang tua</option><option>Mertua</option><option>Saudara</option><option>Cucu</option><option>Keponakan</option><option>Lainnya</option></select></label>
    </div>
    <label class="check"><input type="checkbox" name="member-screen" value="${rowId}" checked> Akan didaftarkan untuk pemeriksaan Posyandu</label>
    ${action('Hapus anggota ini', 'remove-member-row', 'plain')}
  </div>`;
}
function registerFamilyPage() {
  if (ui.registrationDone) {
    return `${publicHeader()}<main id="content" class="wrap public-section" tabindex="-1">
      <section class="panel stack" style="max-width:720px;margin:32px auto">
        <div class="pill good">Pendaftaran berhasil</div>
        <h1 id="page-title" tabindex="-1">Email dan data keluarga sudah terverifikasi</h1>
        <p>Alamat <strong>${h(ui.pendingEmail)}</strong> berhasil diverifikasi. Data keluarga telah tersimpan pada database Posyandu.</p>
        <p class="small muted">Gunakan email dan kata sandi yang dibuat saat pendaftaran untuk masuk kembali.</p>
        <div class="actions">${link('Masuk ke akun keluarga', 'masuk/orang-tua', 'primary', 'arrow')}${link('Kembali ke beranda', 'beranda', 'plain')}</div>
      </section></main>${footer()}`;
  }
  if (ui.registrationStep === 'otp' || ui.registrationStep === 'save') {
    const isSave = ui.registrationStep === 'save';
    return `${publicHeader()}<main id="content" class="wrap public-section" tabindex="-1">
      ${screenTitle(isSave ? 'Selesaikan pendaftaran keluarga' : 'Verifikasi email', isSave ? 'Email sudah terverifikasi. Simpan data keluarga untuk menyelesaikan pendaftaran.' : 'Masukkan kode OTP yang dikirim ke email Anda.')}
      <section class="panel stack" style="max-width:720px">
        <p>Kode verifikasi dikirim ke <strong>${h(ui.pendingEmail)}</strong>. Periksa kotak masuk dan folder spam.</p>
        ${isSave ? `<form data-form="complete-family-registration" class="stack">${inlineError}<div class="actions">${submitButton('Simpan data keluarga')}</div></form>` : `<form data-form="verify-family-signup" class="stack">
          <label class="field">Kode OTP dari email<input name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" minlength="8" maxlength="8" required autofocus></label>
          <p class="small muted">Kode berlaku sesuai masa kedaluwarsa yang diatur pada Supabase. Jangan bagikan kode ini kepada siapa pun.</p>
          ${inlineError}<div class="actions">${submitButton('Verifikasi email')}</div>
        </form>
        <div class="row">${action('Kirim ulang OTP', 'resend-family-signup-otp', 'secondary')}${action('Batalkan pendaftaran', 'cancel-family-signup', 'plain')}</div>`}
      </section></main>${footer()}`;
  }
  return `${publicHeader()}<main id="content" class="wrap public-section" tabindex="-1">
    ${screenTitle('Daftar akun keluarga', 'Buat akun untuk mendaftarkan kepala keluarga, anggota keluarga, dan memilih siapa saja yang akan mengikuti pemeriksaan Posyandu.')}
    ${window.posyanduSupabaseConfigured ? '' : '<p class="callout">Pendaftaran online belum aktif. Lengkapi konfigurasi Supabase dan SMTP sebelum menerima pendaftaran warga.</p>'}
    <div class="dash-grid">
      <section class="panel stack">
        <h2>Identitas keluarga dan akun</h2>
        <form data-form="register-family" class="stack">
          <div class="form-grid">
            <label class="field">Nomor Kartu Keluarga (16 digit)<input name="kk" inputmode="numeric" pattern="[0-9]{16}" minlength="16" maxlength="16" autocomplete="off" required></label>
            <label class="field">Nama kepala keluarga<input name="head-name" maxlength="80" autocomplete="name" required></label>
            <label class="field">Tanggal lahir kepala keluarga<input name="head-born" type="date" max="${today}" required></label>
            <label class="field">Jenis kelamin kepala keluarga<select name="head-sex" required><option value="">Pilih</option><option>Perempuan</option><option>Laki-laki</option></select></label>
            <label class="field">Email aktif untuk akun dan OTP<input name="email" type="email" autocomplete="email" maxlength="120" required></label>
            <label class="field">Nomor HP aktif<input name="phone" type="tel" autocomplete="tel" maxlength="20" required></label>
            <label class="field">RT<input name="rt" inputmode="numeric" maxlength="3" required></label>
            <label class="field">RW<input name="rw" inputmode="numeric" maxlength="3" required></label>
          </div>
          <label class="field">Alamat lengkap<input name="address" maxlength="220" required placeholder="Nama jalan, nomor rumah, blok/perumahan"></label>
          ${locationField('location', { label: 'Posyandu wilayah', value: '', empty: 'Pilih Posyandu wilayah' })}
          <div class="divider"></div>
          <div class="row between"><div><h2>Anggota keluarga lainnya</h2><p class="small muted">Kepala keluarga dihitung sebagai anggota pertama. Tambahkan anggota lain di bawah ini.</p></div>${action('Tambah anggota', 'add-member-row', 'secondary')}</div>
          <div class="stack" data-member-list>${memberRow(1)}</div>
          <div class="form-grid">
            <label class="field">Kata sandi akun (minimal 12 karakter)<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
            <label class="field">Ulangi kata sandi<input type="password" name="confirm-password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
          </div>
          <p class="small muted">Setelah formulir dikirim, kode OTP akan dikirim ke email. Data keluarga disimpan setelah kode OTP berhasil diverifikasi.</p>
          <label class="check"><input type="checkbox" name="consent" required> Saya menyatakan data ini benar dan bersedia data keluarga digunakan untuk administrasi Posyandu.</label>
          ${inlineError}<div class="actions">${submitButton('Daftar dan kirim OTP')}${link('Sudah punya akun? Masuk', 'masuk/orang-tua', 'plain')}</div>
        </form>
      </section>
      <aside class="panel stack"><h2>Proses pendaftaran</h2><ul class="visit-list">
        <li>${icon('check')}<span>Isi data kepala keluarga dan anggota keluarga.</span></li>
        <li>${icon('check')}<span>Pilih anggota yang akan didaftarkan untuk pemeriksaan.</span></li>
        <li>${icon('check')}<span>Buat kata sandi akun.</span></li>
        <li>${icon('check')}<span>Masukkan OTP yang dikirim ke email.</span></li>
        <li>${icon('check')}<span>Data keluarga tersimpan setelah email terverifikasi.</span></li>
      </ul><p class="callout">Gunakan alamat email milik sendiri dan pastikan dapat menerima email. Jangan bagikan kode OTP kepada orang lain.</p></aside>
    </div>
  </main>${footer()}`;
}
function familyMembersPage() {
  const members = familyMembersFor(session.familyId);
  const selected = members.filter(member => member.selectedForExam !== false).length;
  const family = householdById(session.familyId);
  return `${screenTitle('Anggota keluarga', 'Periksa daftar seluruh anggota keluarga dan tentukan siapa yang akan mengikuti pemeriksaan.')}
    <div class="dash-grid">
      <section class="panel stack">
        <div class="metrics">${metricCard('users', String(members.length), 'Total anggota keluarga')}${metricCard('check', String(selected), 'Dijadwalkan untuk diperiksa')}</div>
        ${table(['Nama', 'Tanggal lahir', 'Hubungan', 'Pemeriksaan'], members.map(member => [h(member.name), member.born ? dateLabel(member.born) : '—', h(member.relation), member.selectedForExam === false ? pill('Belum dipilih') : pill('Akan diperiksa', 'good')]), 'Anggota keluarga')}
        <form data-form="update-exam-members" class="stack">
          <h2>Pilih anggota yang akan diperiksa</h2>
          <p class="small muted">Centang setiap anggota keluarga yang akan datang ke Posyandu berikutnya.</p>
          ${members.map(member => `<label class="check"><input type="checkbox" name="exam-member" value="${h(member.id)}"${member.selectedForExam === false ? '' : ' checked'}> ${h(member.name)} · ${h(member.relation)}</label>`).join('')}
          ${inlineError}<div class="actions">${submitButton('Simpan pilihan pemeriksaan')}</div>
        </form>
      </section>
      <section class="panel stack">
        <h2>Tambah anggota keluarga</h2>
        <form data-form="family-add-member" class="stack">
          <div class="form-grid">
            <label class="field">Nama lengkap<input name="name" maxlength="80" required></label>
            <label class="field">Tanggal lahir<input name="born" type="date" max="${today}" required></label>
            <label class="field">Jenis kelamin<select name="sex" required><option value="">Pilih</option><option>Perempuan</option><option>Laki-laki</option></select></label>
            <label class="field">Hubungan<select name="relation" required><option>Anak</option><option>Suami</option><option>Istri</option><option>Orang tua</option><option>Mertua</option><option>Saudara</option><option>Lainnya</option></select></label>
          </div>
          <label class="check"><input type="checkbox" name="selected" checked> Akan diperiksa</label>
          ${inlineError}<div class="actions">${submitButton('Tambah anggota')}</div>
        </form>
      </section>
    </div>`;
}
function familiesPage() {
  const families = households.filter(family => !staffLocation() || family.location === staffLocation());
  const allMembers = families.flatMap(family => familyMembersFor(family.id));
  const chosen = allMembers.filter(member => member.selectedForExam !== false).length;
  return `${screenTitle('Data keluarga', 'Lihat jumlah anggota setiap KK dan anggota yang sudah dipilih untuk pemeriksaan.')}
    <section class="panel stack">
      <div class="metrics">${metricCard('users', String(families.length), 'Keluarga terdaftar')}${metricCard('person', String(allMembers.length), 'Total anggota keluarga')}${metricCard('check', String(chosen), 'Anggota dipilih untuk diperiksa')}</div>
      ${table(['Kepala keluarga', 'Nomor KK', 'Jumlah anggota', 'Akan diperiksa', 'Lokasi', 'Rincian'], families.map(family => {
        const members = familyMembersFor(family.id);
        return [h(family.name), h(maskedKK(family.id)), members.length, members.filter(member => member.selectedForExam !== false).length, locationDetail(family.location), action('Lihat anggota', 'family-detail', 'secondary', `data-family="${h(family.id)}"`)];
      }), 'Data keluarga', true)}
    </section>`;
}

const mapSearch = address => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
const puskesmasMapQuery = [puskesmas.name, puskesmas.address].join(', ');
const puskesmasMapSearch = () => mapSearch(puskesmasMapQuery);
const puskesmasMapEmbed = () => 'https://www.google.com/maps?q=' + encodeURIComponent(puskesmasMapQuery) + '&output=embed&hl=id';
function mapLink(text, url) {
  return `<a class="btn secondary fit" href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(text)} ${icon('arrow')}</a>`;
}
function directoryPage() {
  const selected = ui.directoryLocation ?? '';
  const place = locationById(selected);
  const profile = data.directoryProfiles[selected];
  const verified = publishedProfile(selected);
  const isStaff = role === 'kader';
  return `${screenTitle('Puskesmas dan lokasi posyandu', 'Alamat fasilitas dan pilihan lokasi pelayanan di Desa Karangsatria.')}
    <div class="dash-grid">
      <section class="panel tinted stack">
        <div class="eyebrow">Puskesmas pembina</div><h2>${h(puskesmas.name)}</h2>
        <dl class="data-list">
          <div><dt>Alamat terdaftar</dt><dd>${h(puskesmas.address)}</dd></div>
          <div><dt>Cakupan yang ditampilkan</dt><dd>Desa Karangsatria</dd></div>
          <div><dt>Lokasi pelayanan aktif</dt><dd>${h(puskesmas.name)} ${pill('Perlu verifikasi', 'warn')}</dd></div>
          <div><dt>Jenis layanan</dt><dd>Kesehatan ibu dan anak, pemantauan tumbuh kembang</dd></div>
          <div><dt>Jam layanan</dt><dd>Jadwal layanan dikonfirmasi oleh Puskesmas</dd></div>
          <div><dt>Kontak layanan</dt><dd>Belum ditetapkan</dd></div>
        </dl>
        <div class="row">${mapLink('Cari di Google Maps', puskesmasMapSearch())}${mapLink('Sumber alamat Pemkab Bekasi', puskesmas.source)}</div>
      </section>
      <section class="panel stack"><div class="panel-heading"><h2>18 Posyandu Karangsatria</h2></div>
        ${locationField('directory-location', { required: false, empty: 'Semua lokasi', value: selected, change: 'directory-location' })}
        ${place ? `<div class="stack-tight"><div class="row">${icon('pin')}<h3>${h(place.name)}</h3>${pill(verified ? 'Menunggu konfirmasi pengelola' : 'Perlu verifikasi', 'warn')}</div>
          <p>${h(fullLocationAddress(place.id))}</p>
          ${verified ? `<p class="small muted">Status verifikasi perlu dikonfirmasi pengelola · ${dateLabel(verified.verifiedOn)}</p>` : '<p class="small muted">Alamat belum dikonfirmasi pengelola.</p>'}
          ${mapLink(verified ? 'Buka di Google Maps' : 'Cari area di Google Maps', verified ? verified.mapUrl : mapSearch(place.address + ', Karangsatria, Tambun Utara'))}</div>
          ${isStaff ? `<details${profile?.status === 'Perlu verifikasi' ? ' open' : ''}><summary>Kelola alamat dan peta</summary>
            <p class="small muted section-gap">Masukkan alamat dan pin yang disediakan tim posyandu untuk melengkapi dan memverifikasi data lokasi.</p>
            ${profile?.status === 'Perlu verifikasi' ? `<p class="section-gap">${pill('Perlu verifikasi', 'warn')}</p>` : ''}
            <form data-form="save-directory">
              <input type="hidden" name="location" value="${h(place.id)}">
              <label class="field">Alamat lengkap<input name="address" value="${h(profile?.address ?? '')}" maxlength="230" required></label>
              <label class="field">Tautan Google Maps<input name="map-url" type="url" value="${h(profile?.mapUrl ?? '')}" required></label>
              ${inlineError}<div class="actions">${submitButton('Simpan untuk verifikasi')}${profile?.status === 'Perlu verifikasi' ? action('Verifikasi data', 'verify-directory', 'secondary', `data-location="${place.id}" data-revision="${h(profile.revision)}"`) : ''}</div>
            </form></details>` : ''}`
         : `<ul class="list location-list">${locations.map(item => `<li><div class="row">${icon('pin')}<div>${locationDetail(item.id)}</div></div>
          ${action('Lihat lokasi', 'open-directory', 'plain', `data-location="${item.id}" aria-label="Lihat lokasi ${h(item.name)}"`)}</li>`).join('')}</ul>`}
      </section>
    </div>`;
}

function participantsPage() {
  const query = ui.participantSearch ?? '';
  const children = staffChildren().filter(person => atLocation(person, staffLocation()));
  const matched = children.filter(person => (person.name + ' ' + householdById(person.familyId).kk.slice(-4)).toLowerCase().includes(query.toLowerCase()));
  return `${screenTitle('Data ibu dan balita', 'Bedakan nama yang sama melalui akhiran KK dan tanggal lahir.')}
    <div class="dash-grid">
      <section class="panel stack">
        <form data-form="search" class="row"><label class="field">Cari nama atau akhiran KK<input name="query" type="search" placeholder="Alya atau 0001" value="${h(query)}"></label><button type="submit" class="btn secondary">Cari</button></form>
        ${table(['Balita', 'Tanggal lahir', 'Nomor KK', 'Posyandu terdaftar', 'Tindakan'], matched.map(person => [
          h(person.name), dateLabel(person.born), h(maskedKK(person.familyId)), locationDetail(person.location),
          action('Lihat perincian', 'child-detail', 'secondary', `data-child="${h(person.id)}" aria-label="Lihat perincian ${h(person.name)} KK ${householdById(person.familyId).kk.slice(-4)}"`),
        ]), 'Data balita', true)}
      </section>
      <section class="panel"><details><summary>Tambah peserta</summary>
        <form data-form="register-child"><div class="form-grid">
          <label class="field">Nama anak<input name="name" maxlength="60" required></label>
          <label class="field">Tanggal lahir<input name="born" type="date" max="${today}" required></label>
          <label class="field">Keluarga berdasarkan KK<select name="family" required>${options([['', 'Pilih keluarga'], ...households.map(item => [item.id, item.name + ' · KK ' + item.kk.slice(-4)])], '')}</select></label>
          <label class="field">Hubungan dengan wali<select name="relation"><option>Orang tua</option><option>Wali</option></select></label>
          ${locationField('location', { value: staffLocation(), list: staffLocations() })}
        </div>${inlineError}<div class="actions">${submitButton('Simpan peserta')}</div></form>
      </details></section>
    </div>`;
}

const isAppleMobile = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
function phoneNotificationState() {
  if (window.self !== window.top) {
    return { key: 'embedded', label: 'Buka situs di tab sendiri', detail: 'Browser dapat memblokir permintaan izin dari pratinjau yang ditanam di halaman lain.' };
  }
  if (isAppleMobile() && !(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone)) {
    return { key: 'apple', label: 'Buka dari Layar Utama', detail: 'Di iPhone atau iPad yang mendukung, pilih Bagikan → Tambah ke Layar Utama. Buka Posyandu dari ikonnya, lalu aktifkan notifikasi.' };
  }
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || typeof Notification.requestPermission !== 'function') {
    return { key: 'unsupported', label: 'Tes notifikasi belum tersedia di browser ini', detail: 'Buka tautan situs HTTPS di browser yang mendukung notifikasi. Jadwal tetap bisa dibaca di halaman ini.' };
  }
  if (Notification.permission === 'denied') {
    const detail = isAppleMobile()
      ? 'Buka Pengaturan → Notifikasi → Posyandu Karangsatria, lalu izinkan pemberitahuan jika ada. Kembali ke halaman ini dan periksa izin lagi.'
      : 'Buka ikon Info halaman di sebelah alamat situs → Izin → Notifikasi → Izinkan. Jika masih terblokir di HP, periksa juga izin notifikasi untuk aplikasi browser.';
    return { key: 'denied', label: 'Notifikasi diblokir oleh browser', detail };
  }
  if (Notification.permission === 'granted') {
    return { key: 'granted', label: 'Izin notifikasi sudah diberikan', detail: 'Pilih Tes notifikasi untuk memeriksa apakah pemberitahuan tampil di perangkat ini.' };
  }
  return { key: 'default', label: 'Izin notifikasi belum diberikan', detail: 'Ketuk Aktifkan notifikasi HP, lalu pilih Izinkan pada pesan yang muncul dari browser.' };
}

function phoneNotificationControls() {
  const entry = phoneNotificationState();
  let buttons = '';
  if (entry.key === 'embedded') {
    buttons = `<a class="btn secondary" href="${h(location.href)}" target="_blank" rel="noopener noreferrer">Buka situs di tab baru ${icon('arrow')}</a>`;
  } else if (entry.key === 'denied') {
    buttons = action('Periksa izin lagi', 'refresh-phone-notification');
  } else if (entry.key === 'default') {
    buttons = action('Aktifkan notifikasi HP', 'enable-phone-notification');
  } else if (entry.key === 'granted') {
    buttons = action('Tes notifikasi', 'test-phone-notification');
  }
  return `<div class="stack-tight section-gap" id="phone-notification" aria-labelledby="phone-notification-title">
    <h3 id="phone-notification-title" tabindex="-1">Notifikasi di HP</h3>
    <p class="small strong">${h(entry.label)}</p>
    <p class="small muted">${h(entry.detail)}</p>
    ${buttons ? `<div class="row">${buttons}</div>` : ''}
    <p class="small muted">Pengiriman H-1 otomatis masih menunggu integrasi layanan pengiriman.</p>
  </div>`;
}

function refreshPhoneNotification() {
  const current = $('#phone-notification');
  if (!current) return;
  const focusWasInside = current.contains(document.activeElement);
  current.outerHTML = phoneNotificationControls();
  if (focusWasInside) $('#phone-notification-title')?.focus({ preventScroll: true });
}

async function testPhoneNotification(enable = false) {
  if (role !== 'keluarga') return;
  try {
    const state = phoneNotificationState();
    if (enable && state.key === 'default') {
      const permission = await Notification.requestPermission();
      refreshPhoneNotification();
      say(permission === 'granted' ? 'Izin diberikan. Pilih Tes notifikasi.' : phoneNotificationState().label);
      return;
    }
    if (enable || state.key !== 'granted') {
      refreshPhoneNotification();
      say(state.label);
      return;
    }
    const registration = await navigator.serviceWorker.register('./reminder-sw.js');
    const active = registration.active?.state === 'activated' ? registration : await navigator.serviceWorker.ready;
    await active.showNotification('Pengingat Posyandu Karangsatria · Tes', {
      body: 'Notifikasi uji dari portal Posyandu Karangsatria.',
      data: { route: '#keluarga/notifikasi' }, tag: 'posyandu-notifikasi-uji',
    });
    say('Notifikasi tes diminta. Periksa panel notifikasi perangkat.');
  } catch {
    refreshPhoneNotification();
    say('Notifikasi belum bisa ditampilkan. Periksa izin situs dan setelan notifikasi perangkat.');
  }
}

window.addEventListener('focus', refreshPhoneNotification);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshPhoneNotification();
});

function schedulePage(notifications = false) {
  const isStaff = role === 'kader';
  const location = isStaff ? staffLocation() : (ui.familyScheduleLocation ?? householdById(session.familyId).location);
  const reminder = data.reminders[session.familyId] ?? 1;
  const list = notifications ? currentEvents(location).filter(event => event.date >= DAY)
    : data.events.filter(event => atLocation(event, location)).sort((a, b) => a.date.localeCompare(b.date));
  return `${screenTitle(notifications ? 'Notifikasi' : 'Jadwal posyandu', 'Periksa tanggal, lokasi, dan layanan pada jadwal layanan.')}
  <div class="dash-grid">
    ${isStaff ? `<section class="panel"><details><summary>Tambah jadwal</summary><form data-form="event">
      <div class="form-grid">
        <label class="field">Nama kegiatan<input name="name" value="Posyandu balita" maxlength="65" required></label>
        ${locationField('location', { value: location, list: staffLocations() })}
        <label class="field">Tanggal<input name="date" type="date" min="${DAY}" required></label>
        <label class="field">Waktu WIB<input name="time" type="time" value="08:00" required></label>
      </div>
      <fieldset class="section-gap"><legend>Imunisasi pada jadwal</legend><div class="row">
        ${vaccines.map(([id, name]) => `<label class="check"><input type="checkbox" name="vaccines" value="${id}"> ${h(name)}</label>`).join('')}
      </div></fieldset><label class="check section-gap"><input type="checkbox" name="vitamin-a"> Cantumkan agenda vitamin A</label>${inlineError}<div class="actions">${submitButton('Simpan jadwal')}</div>
    </form></details></section>` : ''}
    <section class="panel stack">
      <h2>${notifications ? 'Kegiatan dengan pengingat' : 'Daftar kegiatan'}</h2>
      ${isStaff ? '' : locationField('schedule-location', { label: 'Lokasi jadwal', value: location, required: false, empty: 'Semua lokasi', change: 'family-schedule-location' })}
      ${notifications ? `<p class="small muted">Pengingat diatur ${reminder} hari sebelum kegiatan.</p>` : ''}
      ${list.length ? `<ul class="list">${list.map(event => `<li>
        <div class="stack-tight">${eventSummary(event)}${event.vaccines.length ? `<p class="small muted">Imunisasi · ${h(event.vaccines.map(vaccineName).join(', '))}</p>` : ''}${event.vitaminA ? '<p class="small muted">Agenda vitamin A · Jadwal perlu dikonfirmasi pengelola</p>' : ''}</div>
        <div class="row">${pill(event.status, event.status === 'Dibatalkan' ? 'warn' : 'good')}
        ${isStaff && event.status === 'Terjadwal' ? action('Batalkan jadwal', 'cancel-event', 'plain', `data-event="${h(event.id)}"`) : ''}</div>
      </li>`).join('')}</ul>` : '<p class="empty">Belum ada kegiatan pada pilihan ini.</p>'}
      ${!isStaff && !notifications ? link('Atur pengingat', 'keluarga/notifikasi', 'secondary') : ''}
    </section>
    ${notifications ? `<section class="panel"><h2>Atur pengingat</h2><form data-form="reminder">
      <label class="field">Tampilkan pengingat sebelum kegiatan<select name="days">${options([[1, '1 hari'], [3, '3 hari'], [7, '7 hari'], [14, '14 hari']], reminder)}</select></label>
      <div class="actions">${submitButton('Simpan pengingat')}</div></form>
      ${phoneNotificationControls()}</section>` : ''}
  </div>`;
}

function immunizationPage() {
  const isStaff = role === 'kader';
  const people = isStaff ? staffChildren() : familyChildren();
  const active = isStaff ? ui.kaderChild : ui.familyChild;
  const child = people.some(item => item.id === active) ? active : people[0]?.id;
  const location = isStaff ? staffLocation() : (ui.vaccineLocation ?? '');
  const day = today < DAY ? today : DAY;
  const schedule = currentEvents(location).filter(event => event.vaccines.length);
  const history = data.vaccinations.filter(item => item.child === child && atLocation(item, location)).sort((a, b) => b.date.localeCompare(a.date));
  return `${screenTitle('Imunisasi', 'Lihat jenis imunisasi, agenda per lokasi, dan catatan anak.')}
  <div class="dash-grid">
    <div class="cols"><section class="panel"><h2>Katalog imunisasi</h2><div class="row">${vaccines.map(([, name]) => pill(name, 'good')).join('')}</div></section>
      <section class="panel stack-tight"><h2>Agenda imunisasi</h2>
        ${schedule.length ? `<ul class="list">${schedule.map(event => `<li><div>${eventSummary(event)}<p class="small muted">${h(event.vaccines.map(vaccineName).join(', '))}</p></div></li>`).join('')}</ul>` : '<p class="empty">Belum ada agenda imunisasi untuk lokasi ini.</p>'}
      </section>
    </div>
    ${isStaff ? `<section class="panel"><h2>Catat imunisasi</h2><form data-form="vaccination"><div class="form-grid">
      <label class="field">Anak<select name="child" required>${selection(people, child, true)}</select></label>
      <label class="field">Jenis imunisasi<select name="vaccine" required>${options([['', 'Pilih imunisasi'], ...vaccines], '')}</select></label>
      <label class="field">Seri tercatat<select name="series">${options(vaccineSeries.map(value => [value, value]), '1')}</select></label>
      <label class="field">Tanggal pemberian<input name="date" type="date" value="${day}" max="${today}" required></label>
      ${locationField('location', { value: location, list: staffLocations() })}
      <label class="field">Asal catatan<select name="source" data-change="vaccine-source"><option>Posyandu</option><option>Fasilitas lain</option></select></label>
      <label class="field" data-facility hidden>Nama fasilitas asal<input name="facility" maxlength="75"></label>
    </div>${inlineError}<div class="actions">${submitButton('Simpan imunisasi')}</div></form></section>` : ''}
    <section class="panel stack"><h2>Riwayat imunisasi</h2><div class="form-grid">
      <label class="field">Pilih anak<select data-change="${isStaff ? 'kader-child' : 'family-child'}">${selection(people, child, isStaff)}</select></label>
      ${isStaff ? '' : locationField('vaccine-location', { label: 'Lokasi', value: location, required: false, empty: 'Semua lokasi', change: 'vaccine-location' })}
      </div>
      ${table(['Tanggal', 'Imunisasi', 'Seri', 'Lokasi Posyandu', 'Asal catatan'], history.map(item => [
        dateLabel(item.date), h(vaccineName(item.vaccine)), h(item.series), locationDetail(item.location),
        h(item.source) + (item.facility ? ' · ' + h(item.facility) : ''),
      ]), 'Riwayat imunisasi', true)}
    </section>
  </div>`;
}

const queueServiceName = id => queueServices.find(([key]) => key === id)?.[1] ?? 'Layanan umum';
function nextQueueLabel(status) {
  return { Menunggu: 'Panggil', Dipanggil: 'Mulai layanan', Dilayani: 'Selesaikan' }[status] ?? '';
}
const queueTone = status => ['Menunggu', 'Perlu tindak lanjut'].includes(status) ? 'warn' : status === 'Dibatalkan' ? 'bad' : 'good';
const screeningStatus = status => status === 'Menunggu' ? 'Perlu ditinjau' : status === 'Ditinjau' ? 'Sudah ditinjau' : status === 'Perlu tindak lanjut' ? 'Perlu tindak lanjut' : status === 'Selesai' ? 'Selesai' : status;
function queueRows(rows, screening = false) {
  return rows.length ? `<ul class="queue-list">${rows.map(row => `<li>
    <button type="button" class="queue-row" data-action="${screening ? 'screening-detail' : 'queue-detail'}" data-id="${h(row.id)}" aria-label="Lihat perincian ${h(row.code)}">
      <span class="queue-code">${h(row.code)}</span><span class="queue-place">
        <span class="strong">${h(screening ? (row.respondentName || householdById(row.familyId)?.name || 'Responden belum dicatat') : personName(row.child))}</span>
        <small>${h(screening ? ((householdById(row.familyId)?.name ?? 'Keluarga') + ' · ' + (row.respondentRelation ?? '')) : ((householdById(row.familyId)?.name ?? 'Keluarga belum tercatat') + ' · ' + locationName(row.location)))}</small>
        <small>${h(screening ? (dateLabel(row.date) + ' · ' + timeLabel(row.time)) : (dateLabel(row.date) + ' · ' + timeLabel(row.time) + ' · ' + queueServiceName(row.service)))}</small>
      </span>
      ${pill(screening ? screeningStatus(row.status) : row.status, queueTone(row.status))}
      <span class="queue-details">Lihat perincian ${icon('arrow')}</span>
    </button>
  </li>`).join('')}</ul>` : `<p class="empty">${screening ? 'Belum ada hasil skrining pada pilihan ini.' : 'Belum ada pendaftaran layanan pada pilihan ini.'}</p>`;
}
function queuePage() {
  const isStaff = role === 'kader';
  const location = normalizeLocationId(ui.queueLocation || householdById(session.familyId)?.location || '');
  const events = isStaff ? [] : currentEvents(location);
  const event = events.find(item => item.id === ui.queueEvent);
  const services = event ? queueServices.filter(([id]) => id !== 'imunisasi' || event.vaccines.length) : [];
  const children = familyChildren();
  const records = data.queues.filter(item => isStaff
    ? atLocation(item, staffLocation()) && (!ui.queueDate || item.date === ui.queueDate) && (!ui.queueStatus || item.status === ui.queueStatus)
    : item.familyId === session.familyId);
  return `${screenTitle('Daftar Pelayanan', isStaff ? 'Panggil dan perbarui status pelayanan per lokasi.' : 'Ambil nomor dan pantau status kunjungan keluarga.', action('Muat ulang jadwal & antrean', 'refresh-queues', 'secondary'))}
  <div class="dash-grid">
    ${isStaff ? '' : `<section class="panel"><h2>Ambil nomor layanan</h2>
      <form data-form="queue"><div class="form-grid">
        <label class="field">Pilih anak<select name="child" required>${selection(children, ui.queueChild || ui.familyChild)}</select></label>
        ${locationField('location', { value: location, change: 'queue-location' })}
        <label class="field">Pilih jadwal<select name="event" data-change="queue-event" required>${options([['', events.length ? 'Pilih jadwal' : 'Jadwal belum tersedia'], ...events.map(item => [item.id, dateLabel(item.date) + ' · ' + item.name])], event?.id)}</select></label>
        <label class="field">Pilih layanan<select name="service" required>${options([['', event ? 'Pilih layanan' : 'Pilih jadwal terlebih dahulu'], ...services], '')}</select></label>
      </div>
      ${events.length ? '' : '<p class="small muted section-gap">Jadwal untuk lokasi keluarga belum termuat. Tekan “Muat ulang jadwal & antrean” di atas. Jika tetap kosong, lokasi pada data keluarga dan jadwal perlu dicocokkan.</p>'}
      ${inlineError}<div class="actions">${submitButton('Ambil nomor layanan')}</div></form>
    </section>`}
    <section class="panel stack">
      <h2>${isStaff ? 'Daftar pendaftaran layanan' : 'Pendaftaran layanan keluarga'}</h2>
      ${isStaff ? `<div class="form-grid">
        <label class="field">Tanggal<input type="date" data-change="queue-date" value="${h(ui.queueDate ?? '')}"></label>
        <label class="field">Status<select data-change="queue-status">${options([['', 'Semua status'], ...[...queueSteps, 'Dibatalkan'].map(step => [step, step])], ui.queueStatus ?? '')}</select></label>
      </div>` : ''}
      ${queueRows(records)}
    </section>
  </div>`;
}
function openQueueDetail(id, screening, trigger) {
  const list = screening ? data.screenings : data.queues;
  const item = list.find(row => row.id === id);
  if (!item || (role === 'keluarga' && item.familyId !== session.familyId)) return;
  const screeningActions = screening ? ({
    Menunggu: [['Ditinjau', 'Tandai ditinjau'], ['Perlu tindak lanjut', 'Perlu tindak lanjut'], ['Selesai', 'Tandai selesai']],
    Ditinjau: [['Perlu tindak lanjut', 'Perlu tindak lanjut'], ['Selesai', 'Tandai selesai']],
    'Perlu tindak lanjut': [['Ditinjau', 'Tandai ditinjau'], ['Selesai', 'Tandai selesai']],
    Selesai: [],
  }[item.status] || []) : [];
  const buttonLabel = screening ? '' : nextQueueLabel(item.status);
  const canUpdate = role === 'kader' && (screening ? screeningActions.length : Boolean(buttonLabel));
  const nextAction = screening ? 'screening-step' : 'queue-step';
  showDetails((screening ? ('Hasil skrining · ' + (item.respondentName ?? item.code)) : 'Pelayanan ' + item.code), `
    <dl class="data-list">
      <div><dt>Lokasi Posyandu</dt><dd>${locationDetail(item.location)}</dd></div>
      <div><dt>Jadwal</dt><dd>${dateLabel(item.date)} · ${timeLabel(item.time)}</dd></div>
      ${screening ? '' : `<div><dt>Nomor antrean</dt><dd>${h(item.code)}</dd></div><div><dt>Nama anak</dt><dd>${h(personName(item.child))}</dd></div><div><dt>Orang tua / wali</dt><dd>${h(householdById(item.familyId)?.name ?? 'Keluarga belum tercatat')}</dd></div><div><dt>Layanan</dt><dd>${h(queueServiceName(item.service))}</dd></div>`}
      ${screening ? `<div><dt>Keluarga</dt><dd>${h(householdById(item.familyId)?.name ?? 'Keluarga belum tercatat')}</dd></div><div><dt>Responden</dt><dd>${h(item.respondentName ?? 'Belum dicatat')}${item.respondentRelation ? ' · ' + h(item.respondentRelation) : ''}</dd></div><div><dt>Diisi oleh</dt><dd>${h(item.answeredBy ?? householdById(item.familyId)?.name ?? 'Wali keluarga')}</dd></div>` : ''}
      <div><dt>Status ${screening ? 'tindak lanjut' : 'layanan'}</dt><dd>${pill(screening ? screeningStatus(item.status) : item.status, queueTone(item.status))}</dd></div>
    </dl>
    ${screening && role === 'kader' ? (item.answers?.length ? `<section class="stack-tight"><h3>Pertanyaan dan jawaban responden</h3><ol class="review-answers">${item.answers.map((answer, index) => `<li><span>${h(item.questions?.[index] ?? screeningQuestions[index] ?? ('Pertanyaan ' + (index + 1)))}</span><strong>${h(answer)}</strong></li>`).join('')}</ol></section>` : '<p class="empty">Belum ada jawaban yang tersimpan untuk kiriman ini.</p>') : ''}
    ${canUpdate ? `<div class="actions">${screening ? screeningActions.map(([nextStatus, label], index) => action(label, nextAction, index === screeningActions.length - 1 ? 'primary' : 'secondary', `data-id="${h(id)}" data-status="${h(item.status)}" data-next-status="${h(nextStatus)}"`)).join('') : action(buttonLabel, nextAction, 'primary', `data-id="${h(id)}" data-status="${h(item.status)}"`)}</div>` : ''}
    ${!screening && role === 'keluarga' && item.status === 'Menunggu' ? `<div class="actions">${action('Batalkan pendaftaran', 'queue-cancel', 'secondary', `data-id="${h(id)}"`)}</div>` : ''}
  `, trigger);
}
async function updateQueueStep(button, screening) {
  if (role !== 'kader') return;
  const list = screening ? data.screenings : data.queues;
  const item = list.find(row => row.id === button.dataset.id);
  if (!item || button.dataset.status !== item.status || (screening ? item.status === 'Selesai' : !nextQueueLabel(item.status))) {
    render();
    say('Status sudah berubah. Buka kembali perincian.');
    return;
  }
  if (screening) {
    const allowedNext = {
      Menunggu: ['Ditinjau', 'Perlu tindak lanjut', 'Selesai'],
      Ditinjau: ['Perlu tindak lanjut', 'Selesai'],
      'Perlu tindak lanjut': ['Ditinjau', 'Selesai'],
      Selesai: [],
    };
    const nextStatus = button.dataset.nextStatus;
    if (!allowedNext[item.status]?.includes(nextStatus)) {
      render(true);
      say('Perubahan status tidak sesuai dengan status terakhir. Muat ulang hasil.');
      return;
    }
    try {
      const { error } = await supabaseClient().from('screening_sessions').update({ status: nextStatus }).eq('id', item.id);
      if (error) throw error;
      item.status = nextStatus;
      render(true);
      say('Status tindak lanjut diperbarui menjadi: ' + nextStatus + '.');
      const rowButton = document.querySelector(`[data-action="screening-detail"][data-id="${item.id}"]`);
      if (rowButton) openQueueDetail(item.id, true, rowButton);
    } catch (error) {
      say(error.message || 'Status skrining belum berhasil diperbarui.');
    }
    return;
  }
  const previousStatus = item.status;
  const nextStatus = queueSteps[queueSteps.indexOf(previousStatus) + 1];
  try {
    if (window.posyanduSupabaseConfigured) {
      const { data: row, error } = await supabaseClient().from('posyandu_queues')
        .update({ status: nextStatus }).eq('id', item.id).eq('status', previousStatus).select('*').single();
      if (error) throw error;
      const mapped = mapRemoteQueue(row);
      data.queues = data.queues.map(entry => entry.id === mapped.id ? mapped : entry);
    } else {
      item.status = nextStatus;
      save();
    }
    render(true);
    say('Antrean ' + item.code + ' diperbarui menjadi: ' + nextStatus + '.');
    const rowButton = document.querySelector(`[data-action="queue-detail"][data-id="${item.id}"]`);
    if (rowButton) openQueueDetail(item.id, false, rowButton);
  } catch (error) {
    say('Status antrean belum berhasil diperbarui: ' + (error.message || 'Periksa koneksi dan izin database.'));
  }
}


function screeningQuestionAdminPanel() {
  if (!isAdministrator()) return '';
  return `<section class="panel stack">
    <h2>Pengaturan pertanyaan skrining</h2>
    <p class="small muted">Admin dapat menambah, mengaktifkan, atau menonaktifkan pertanyaan. Pertanyaan awal hanya untuk pencatatan keluhan dan kebutuhan konsultasi, bukan diagnosis. Gunakan instrumen resmi yang telah disetujui Puskesmas untuk skrining klinis.</p>
    <div class="stack-tight">${screeningQuestionBank.map(question => `<div class="row between question-admin-row">
      <div class="stack-tight"><strong>${h(question.question_text)}</strong><span class="small muted">${h(question.code)} · ${question.choices.length} pilihan jawaban</span></div>
      ${action(question.is_active ? 'Nonaktifkan' : 'Aktifkan', 'toggle-screening-question', question.is_active ? 'secondary' : 'primary', `data-question="${h(question.id)}" data-active="${question.is_active ? 'true' : 'false'}"`)}
    </div>`).join('') || '<p class="empty">Belum ada pertanyaan tersimpan.</p>'}</div>
    <details><summary>Tambah pertanyaan baru</summary>
      <form data-form="admin-add-question" class="stack section-gap">
        <label class="field">Pertanyaan<textarea name="question" rows="3" maxlength="500" required></textarea></label>
        <label class="field">Pilihan jawaban (satu pilihan per baris)<textarea name="choices" rows="4" maxlength="1200" required placeholder="Ya\nTidak\nTidak tahu"></textarea></label>
        ${inlineError}<div class="actions">${submitButton('Simpan pertanyaan')}</div>
      </form>
    </details>
  </section>`;
}

function screeningPage() {
  const isStaff = role === 'kader';
  const screeningLocation = staffLocation() || ui.screeningLocation || '';
  const records = (data.screenings || []).filter(item => isStaff
    ? atLocation(item, screeningLocation) && (!ui.screeningDate || item.date === ui.screeningDate)
    : item.familyId === session.familyId);
  if (isStaff) {
    return `${screenTitle('Hasil skrining per anggota keluarga', 'Buka setiap responden untuk melihat pertanyaan, jawaban, dan tindak lanjutnya.')}
      <section class="panel stack"><div class="row between"><h2>Daftar hasil skrining</h2>${action('Muat ulang hasil', 'refresh-screenings', 'secondary')}</div><p class="small muted">Setiap baris mewakili satu anggota keluarga. Pilih nama untuk membaca seluruh pertanyaan dan jawaban yang tersimpan di database.</p><div class="form-grid">
        <label class="field">Tanggal<input type="date" data-change="screening-date" value="${h(ui.screeningDate ?? '')}"></label>
        ${locationField('screening-location', { label: 'Tempat Posyandu', value: screeningLocation, required: false, empty: 'Semua Posyandu', change: 'screening-location', list: staffLocation() ? staffLocations().filter(item => item.id === staffLocation()) : staffLocations() })}
      </div>${queueRows(records, true)}</section>
      ${screeningQuestionAdminPanel()}`;
  }
  const draft = ui.screeningDraft;
  const count = activeScreeningQuestions.length;
  let form;
  if (!count) {
    form = '<p class="empty">Belum ada pertanyaan skrining aktif. Hubungi administrator Posyandu.</p>';
  } else if (!draft || draft.step < 0) {
    const family = householdById(session.familyId);
    form = `<h2>Mulai skrining anggota keluarga</h2><p class="muted small">Pilih anggota yang akan mengisi. Setiap jawaban akan dicatat atas nama responden yang dipilih.</p>
      <form data-form="screening-start" class="stack">
        <label class="field">Lokasi Posyandu<input type="text" value="${h(locationName(family?.location))}" readonly><input type="hidden" name="location" value="${h(family?.location || '')}"></label>
        <label class="field">Anggota keluarga yang menjadi responden<select name="member" required>${options(familyMembersFor(session.familyId).filter(member => member.selectedForExam !== false).map(member => [member.id, member.name + ' · ' + member.relation]), draft?.personId ?? '')}</select></label>
        <label class="check"><input type="checkbox" name="agree" required${draft ? ' checked' : ''}> Saya menyetujui pengisian formulir dan menyatakan jawaban mewakili responden yang dipilih.</label>
        ${inlineError}<div class="row">${submitButton('Mulai skrining')}</div>
      </form>`;
  } else if (draft.step === count) {
    form = `<h2>Tinjau jawaban sebelum dikirim</h2><p class="small muted">${h(locationName(draft.location))} · ${h(memberById(draft.personId)?.name ?? 'Anggota keluarga')} · ${count} pertanyaan terjawab</p>
      <ol class="review-answers">${activeScreeningQuestions.map((question, index) => `<li><span>${h(question.question_text)}</span><strong>${h(draft.answers[index])}</strong></li>`).join('')}</ol>
      <form data-form="screening-finish" class="stack-tight">
        <label class="field">Waktu yang diinginkan untuk dihubungi (opsional)<select name="contact-time"><option value="">Tidak perlu dihubungi</option><option>Pagi</option><option>Siang</option><option>Sore</option></select></label>
        ${inlineError}<div class="actions">${action('Kembali', 'screening-back', 'secondary')}${submitButton('Kirim jawaban skrining')}</div>
      </form>`;
  } else {
    const number = draft.step + 1;
    const question = activeScreeningQuestions[draft.step];
    form = `<div class="row between"><p class="strong small">Pertanyaan ${number} dari ${count}</p><p class="small muted">${h(locationName(draft.location))}</p></div>
      <progress max="${count}" value="${number}" aria-label="Kemajuan pengisian"></progress>
      <form data-form="screening-answer"><fieldset class="stack-tight">
        <legend>${h(question.question_text)}</legend>
        ${question.choices.map((choice, i) => `<label class="check choice"><input type="radio" name="answer" value="${i}" required${draft.answers[draft.step] === choice ? ' checked' : ''}> ${h(choice)}</label>`).join('')}
      </fieldset>${inlineError}
      <div class="actions">${action('Kembali', 'screening-back', 'secondary')}${submitButton(number === count ? 'Tinjau jawaban' : 'Lanjut')}</div></form>`;
  }
  return `${screenTitle('Skrining anggota keluarga', 'Isi pertanyaan untuk satu orang pada satu waktu. Pertanyaan awal mencatat keluhan dan kebutuhan konsultasi, bukan diagnosis medis. Riwayat setiap responden dapat dilihat kembali setelah dikirim.')}
    <div class="dash-grid">
      <section class="panel stack-tight">${form}</section>
      <section class="panel stack"><h2>Riwayat skrining keluarga</h2>${queueRows(records, true)}</section>
    </div>`;
}

const stockLotOptions = rows => [['', 'Pilih barang dan lot'], ...rows.map(lot => [lot.id, lot.item + ' · ' + lot.lot + ' · ' + lot.count + ' ' + lot.unit])];
const stockCategories = ['Vitamin dan suplemen', 'Alat kesehatan', 'Bahan habis pakai', 'PMT dan gizi', 'ATK', 'Imunisasi', 'Lainnya'];
function stockPage() {
  const assigned = staffLocations();
  const preferred = ui.stockLocation && assigned.some(item => item.id === ui.stockLocation) ? ui.stockLocation : '';
  const location = preferred || (staffLocation() && assigned.some(item => item.id === staffLocation()) ? staffLocation() : assigned[0]?.id || '');
  ui.stockLocation = location;
  const tab = ui.stockTab ?? 'inventory';
  const activeLots = data.lots.filter(lot => normalizeLocationId(lot.location) === location && lot.active !== false);
  const lowLots = activeLots.filter(lot => lot.count <= lot.min);
  const expiredLots = activeLots.filter(lot => lot.expiry && lot.expiry < today);
  const soonLots = activeLots.filter(lot => lot.expiry && lot.expiry >= today && (dateObject(lot.expiry) - dateObject(today)) / 86400000 <= 60);
  const tabs = `<div class="tabs" aria-label="Fitur manajemen stok">
    ${tabButton('Persediaan barang', 'stock-tab', 'inventory', tab)}
    ${tabButton('Transaksi masuk / keluar', 'stock-tab', 'transactions', tab)}
    ${tabButton('Distribusi ke kegiatan', 'stock-tab', 'dispatch', tab)}
    ${tabButton('Arsip barang', 'stock-tab', 'archive', tab)}
  </div>`;
  const intro = screenTitle('Manajemen stok', 'Kelola barang per lokasi, pantau batas minimum dan kedaluwarsa, catat transaksi, serta distribusi untuk kegiatan Posyandu.', action('Muat ulang data', 'refresh-stock', 'secondary'));
  if (!assigned.length) return intro + `<section class="panel"><p class="callout">Akun kader belum memiliki lokasi tugas. Minta administrator menetapkan wilayah di menu Manajemen akun.</p></section>`;
  const locationFilter = `<section class="panel row between"><div class="stack-tight"><strong>Lokasi pengelolaan</strong><span class="small muted">Data yang terlihat dibatasi sesuai wilayah tugas akun.</span></div><div style="min-width:min(100%,340px)">${locationField('stock-location-filter', { value: location, change: 'stock-page-location', list: assigned })}</div></section>`;
  const introWithTabs = intro + locationFilter + tabs;
  if (window.posyanduSupabaseConfigured && ui.stockMigrationError) {
    return introWithTabs + `<section class="panel stack"><p class="callout"><strong>Database manajemen stok belum siap.</strong><br>Jalankan file MIGRASI_MANAJEMEN_STOK.sql di Supabase SQL Editor, lalu tekan Muat ulang data. Pesan database: ${h(ui.stockMigrationError)}</p>${action('Coba muat ulang', 'refresh-stock', 'primary')}</section>`;
  }
  if (tab === 'archive') {
    const archivedLots = data.lots.filter(lot => normalizeLocationId(lot.location) === location && lot.active === false);
    return introWithTabs + `<section class="panel stack"><h2>Arsip barang</h2>
      <p class="small muted">Barang yang diarsipkan tidak muncul pada pilihan transaksi baru. Saldo dan riwayat lamanya tetap disimpan. Barang dapat dipulihkan kembali jika dibutuhkan.</p>
      ${table(['Barang', 'Kategori', 'Nomor lot', 'Saldo terakhir', 'Satuan', 'Terakhir diperbarui', 'Tindakan'], archivedLots.map(item => [
        h(item.item), h(item.category), h(item.lot), item.count, h(item.unit), item.updatedAt ? safeDateJakarta(item.updatedAt) : '—',
        action('Pulihkan', 'restore-stock-lot', 'secondary', `data-lot-id="${h(item.id)}"`),
      ]), 'Arsip barang', true)}</section>`;
  }
  if (tab === 'transactions') {
    const transactions = data.transactions.filter(item => normalizeLocationId(item.location) === location);
    return introWithTabs + `<div class="dash-grid">
      <section class="panel stack"><h2>Catat transaksi stok</h2><p class="small muted">Gunakan Masuk untuk barang diterima dan Keluar untuk barang yang digunakan atau dikeluarkan. Saldo diperbarui otomatis di database.</p>
        <form data-form="stock" class="stack"><input type="hidden" name="location" value="${h(location)}"><div class="form-grid">
          <label class="field">Barang dan nomor lot<select name="lot" required>${options(stockLotOptions(activeLots), '')}</select></label>
          <label class="field">Jenis transaksi<select name="direction"><option value="Masuk">Stok masuk</option><option value="Keluar">Stok keluar</option></select></label>
          <label class="field">Jumlah<input name="amount" type="number" min="1" max="999999" step="1" required></label>
          <label class="field">Sumber / tujuan (opsional)<input name="reference" maxlength="120" placeholder="Contoh: bantuan Puskesmas"></label>
        </div><label class="field">Catatan (opsional)<textarea name="notes" rows="2" maxlength="500" placeholder="Keterangan transaksi"></textarea></label>
        ${inlineError}<div class="actions">${submitButton('Simpan transaksi')}</div></form>
      </section>
      <section class="panel stack"><h2>Ringkasan saldo</h2><div class="metrics">
        <article class="metric"><span class="icon">${icon('box')}</span><p>Lot aktif</p><div class="value">${activeLots.length}</div></article>
        <article class="metric"><span class="icon">${icon('bell')}</span><p>Stok minimum</p><div class="value">${lowLots.length}</div></article>
      </div><p class="small muted">Saldo saat ini dihitung dari jumlah pada masing-masing lot. Riwayat transaksi di bawah dapat digunakan untuk penelusuran.</p></section>
    </div>
    <section class="panel stack"><div class="row between"><h2>Riwayat transaksi stok</h2><span class="small muted">Maksimal 500 catatan terbaru</span></div>
      ${table(['Waktu', 'Barang / lot', 'Jenis', 'Jumlah', 'Saldo setelah transaksi', 'Sumber / tujuan', 'Catatan'], transactions.map(item => [
        item.createdAt ? safeDateJakarta(item.createdAt) + ' ' + safeTimeJakarta(item.createdAt) : '—', h(item.item) + '<small class="location-caption">' + h(item.lot) + '</small>',
        pill(item.direction, item.direction === 'Keluar' || item.direction === 'Distribusi keluar' ? 'warn' : 'good'), item.amount + ' ' + h(item.unit || ''),
        item.balanceAfter, h(item.reference || '—'), h(item.notes || '—'),
      ]), 'Riwayat transaksi stok', true)}</section>`;
  }
  if (tab === 'dispatch') {
    const carried = data.dispatches.filter(item => item.origin === location || item.location === location);
    const destinationOptions = assigned.map(item => [item.id, item.name]);
    return introWithTabs + `<div class="dash-grid">
      <section class="panel stack"><h2>Catat barang dibawa ke kegiatan</h2><p class="small muted">Catat barang yang dibawa dari gudang/lokasi asal ke Posyandu tujuan. Saldo sumber akan berkurang sesuai barang yang tidak dikembalikan.</p>
        <form data-form="dispatch" class="stack"><input type="hidden" name="origin" value="${h(location)}"><div class="form-grid">
          <label class="field">Posyandu tujuan<select name="location" required>${options([['', 'Pilih lokasi tujuan'], ...destinationOptions], location)}</select></label>
          <label class="field">Tanggal kegiatan<input name="date" type="date" value="${today}" required></label>
          <label class="field">Barang dan lot<select name="lot" required>${options(stockLotOptions(activeLots), '')}</select></label>
          <label class="field">Jumlah dibawa<input name="issued" type="number" min="1" max="999999" step="1" required></label>
          <label class="field">Jumlah dipakai<input name="used" type="number" min="0" max="999999" step="1" value="0" required></label>
          <label class="field">Jumlah dikembalikan<input name="returned" type="number" min="0" max="999999" step="1" value="0" required></label>
        </div><label class="field">Catatan (opsional)<textarea name="notes" rows="2" maxlength="500" placeholder="Contoh: dibawa untuk kegiatan Posyandu balita"></textarea></label>
        <p class="small muted">Barang habis pakai: jumlah dipakai + dikembalikan tidak boleh melebihi jumlah dibawa. Peralatan yang dapat digunakan kembali dapat dicatat kembali setelah dipakai.</p>
        ${inlineError}<div class="actions">${submitButton('Simpan distribusi')}</div></form>
      </section>
      <section class="panel stack"><h2>Petunjuk saldo distribusi</h2><ul class="service-items">
        <li><span class="service-icon">${icon('box')}</span><span><strong>Asal</strong><p>Persediaan asal berkurang ketika barang dibawa, dikurangi barang yang kembali.</p></span></li>
        <li><span class="service-icon">${icon('check')}</span><span><strong>Tujuan</strong><p>Jumlah tersisa dicatat agar kader mengetahui barang yang masih berada di lokasi kegiatan.</p></span></li>
      </ul></section>
    </div>
    <section class="panel stack"><h2>Riwayat distribusi barang</h2>${table(['Tanggal', 'Barang / lot', 'Dari', 'Ke', 'Dibawa', 'Dipakai', 'Kembali', 'Tersisa di tujuan', 'Catatan'], carried.map(item => [
      dateLabel(item.date), h(item.item) + '<small class="location-caption">' + h(item.lot) + '</small>', h(locationName(item.origin)), h(locationName(item.location)),
      item.issued + ' ' + h(item.unit), item.used + ' ' + h(item.unit), item.returned + ' ' + h(item.unit), item.remaining + ' ' + h(item.unit), h(item.notes || '—'),
    ]), 'Riwayat distribusi', true)}</section>`;
  }
  return introWithTabs + `<div class="metrics">
    <article class="metric"><span class="icon">${icon('box')}</span><p>Barang / lot aktif</p><div class="value">${activeLots.length}</div></article>
    <article class="metric"><span class="icon">${icon('bell')}</span><p>Stok minimum</p><div class="value">${lowLots.length}</div></article>
    <article class="metric"><span class="icon">${icon('calendar')}</span><p>Kedaluwarsa</p><div class="value">${expiredLots.length}</div></article>
    <article class="metric"><span class="icon">${icon('clock')}</span><p>Segera kedaluwarsa</p><div class="value">${soonLots.length}</div></article>
  </div>
  <div class="dash-grid">
    <section class="panel stack"><h2>Tambah barang / lot persediaan</h2><p class="small muted">Setiap nomor lot disimpan terpisah agar tanggal kedaluwarsa dan saldonya dapat dilacak.</p>
      <form data-form="stock-lot" class="stack"><input type="hidden" name="location" value="${h(location)}"><div class="form-grid">
        <label class="field">Nama barang<input name="item" maxlength="120" placeholder="Contoh: Vitamin A" required></label>
        <label class="field">Kategori<select name="category">${options(stockCategories.map(value => [value, value]), 'Lainnya')}</select></label>
        <label class="field">Nomor lot / batch<input name="lot-number" maxlength="80" placeholder="Contoh: VA-1126"></label>
        <label class="field">Satuan<input name="unit" maxlength="30" placeholder="kapsul, lembar, botol, pcs" required></label>
        <label class="field">Jenis barang<select name="stock-type"><option value="Habis pakai">Habis pakai</option><option value="Dikembalikan">Dapat digunakan kembali</option></select></label>
        <label class="field">Stok awal<input name="quantity" type="number" min="0" max="999999" step="1" value="0" required></label>
        <label class="field">Batas minimum stok<input name="min-quantity" type="number" min="0" max="999999" step="1" value="5" required></label>
        <label class="field">Tanggal kedaluwarsa (bila ada)<input name="expiry" type="date"></label>
      </div><label class="field">Catatan (opsional)<textarea name="notes" rows="2" maxlength="500"></textarea></label>
      ${inlineError}<div class="actions">${submitButton('Simpan barang')}</div></form>
    </section>
    <section class="panel stack"><h2>Perhatian stok</h2>
      ${lowLots.length ? `<p class="callout">${lowLots.length} lot berada pada atau di bawah batas minimum. Periksa dan rencanakan pengadaan.</p>` : '<p class="small muted">Tidak ada lot yang berada di bawah batas minimum.</p>'}
      ${expiredLots.length ? `<p class="callout">${expiredLots.length} lot sudah melewati tanggal kedaluwarsa. Jangan gunakan sebelum diverifikasi petugas berwenang.</p>` : ''}
      ${soonLots.length ? `<p class="small muted">${soonLots.length} lot akan kedaluwarsa dalam 60 hari.</p>` : ''}
      <p class="small muted">Saldo hanya berubah melalui transaksi masuk/keluar atau distribusi. Mengubah nama/kategori/nomor lot tidak mengubah riwayat transaksi.</p>
    </section>
  </div>
  <section class="panel stack"><div class="row between"><h2>Daftar persediaan per lot</h2><span class="small muted">${h(locationName(location))}</span></div>
    ${table(['Barang', 'Kategori', 'Nomor lot', 'Jenis', 'Saldo', 'Batas minimum', 'Kedaluwarsa', 'Status', 'Pengelolaan'], activeLots.map(item => {
      const expired = item.expiry && item.expiry < today;
      const near = item.expiry && !expired && (dateObject(item.expiry) - dateObject(today)) / 86400000 <= 60;
      const status = expired ? pill('Kedaluwarsa', 'bad') : item.count <= item.min ? pill('Stok minimum', 'warn') : near ? pill('Segera kedaluwarsa', 'warn') : pill('Tersedia', 'good');
      return [h(item.item), h(item.category), h(item.lot), h(item.kind === 'Dikembalikan' ? 'Dapat digunakan kembali' : 'Habis pakai'), item.count + ' ' + h(item.unit), item.min + ' ' + h(item.unit), item.expiry ? dateLabel(item.expiry) : '—', status,
        `<div class="row">${action('Ubah', 'edit-stock-lot', 'secondary', `data-lot-id="${h(item.id)}"`)}${item.count === 0 ? action('Arsipkan', 'archive-stock-lot', 'plain', `data-lot-id="${h(item.id)}"`) : ''}</div>`];
    }), 'Daftar persediaan', true)}
  </section>`;
}

const pointsForFamily = id => data.points.filter(item => item.familyId === id).reduce((sum, item) => sum + item.points, 0);
const activeClaim = id => data.claims.find(item => item.familyId === id && item.period === data.reward.period);
const claimCount = () => data.claims.filter(item => item.period === data.reward.period).length;
const remainingRewards = () => data.reward.quota - claimCount();
function pointsPage() {
  const isStaff = role === 'kader';
  const familyId = isStaff ? (ui.pointFamily || households[0].id) : session.familyId;
  const total = pointsForFamily(familyId);
  const entries = data.points.filter(item => item.familyId === familyId).sort((a, b) => b.date.localeCompare(a.date));
  const certificate = data.certificates[familyId];
  const claim = activeClaim(familyId);
  const rewardStatus = claim?.status ?? (total < 100 ? 'Tersedia mulai 100 poin' : remainingRewards() > 0 && data.reward.active ? 'Dapat diajukan' : 'Kuota selesai');
  return `${screenTitle('Bunda Teladan', 'Pantau poin partisipasi, penghargaan, dan klaim kupon keluarga.')}
  <div class="dash-grid">
    <section class="panel family-card stack-tight">
      <div class="row between"><h2>Poin partisipasi</h2>${isStaff
        ? `<label class="field">Pilih keluarga<select data-change="point-family">${options(households.map(item => [item.id, item.name + ' · KK ' + item.kk.slice(-4)]), familyId)}</select></label>`
        : pill(householdById(familyId).name, 'good')}</div>
      <div class="reading">${total} poin</div>
      <progress max="100" value="${Math.min(total, 100)}" aria-label="Progres menuju 100 poin"></progress>
    </section>
    <section class="panel"><h2>Penghargaan Bunda Teladan</h2><ul class="list">
      <li><span><strong>20 poin</strong> · Badge Rajin Hadir</span>${pill(total >= 20 ? 'Diraih' : 'Dalam progres', total >= 20 ? 'good' : '')}</li>
      <li><span><strong>50 poin</strong> · Sertifikat Keluarga Aktif</span>
      <span class="row">${pill(certificate ? 'Terbit' : total >= 50 ? 'Memenuhi syarat' : 'Dalam progres', certificate ? 'good' : '')}
      ${certificate ? action('Lihat sertifikat', 'certificate', 'secondary', `data-family="${familyId}"`) : isStaff && total >= 50 ? action('Terbitkan sertifikat', 'issue-certificate', 'secondary', `data-family="${familyId}"`) : ''}</span></li>
      <li><span><strong>100 poin</strong> · Kupon suvenir edukatif</span><span class="row">
        ${pill(rewardStatus, claim ? 'good' : '')}
        ${!isStaff && !claim && total >= 100 && data.reward.active && remainingRewards() > 0 ? action('Ajukan kupon', 'reward-claim', 'primary') : ''}
        ${isStaff && claim && claim.status !== 'Diambil' ? action(claim.status === 'Diajukan' ? 'Setujui kupon' : 'Tandai diambil', 'reward-step', 'secondary', `data-family="${familyId}" data-status="${claim.status}"`) : ''}
      </span></li>
    </ul></section>
    ${isStaff ? `<section class="panel"><h2>Verifikasi aktivitas</h2><form data-form="points"><input type="hidden" name="family" value="${familyId}">
      <label class="field">Bukti partisipasi<select name="activity" required>${options([['', 'Pilih aktivitas'], ...participationEvents.map(event => {
        const rule = participationRules.find(item => item.id === event.ruleId);
        return [event.id, event.name + ' · +' + (data.pointRules[rule.id] ?? rule.points) + ' poin'];
      })], 'kuis-nov')}</select></label>
      ${inlineError}<div class="actions">${submitButton('Verifikasi aktivitas')}</div></form></section>` : ''}
    <div class="cols">
      <section class="panel"><h2>Riwayat poin</h2>
      ${table(['Aktivitas', 'Tanggal', 'Poin'], entries.map(item => [h(item.name), dateLabel(item.date), '+' + item.points]), 'Riwayat poin')}</section>
      <section class="panel"><h2>Cara mendapatkan poin</h2><ul class="list">${participationRules.map(rule => `<li><span>${h(rule.label)}</span><strong>+${data.pointRules[rule.id] ?? rule.points}</strong></li>`).join('')}</ul></section>
    </div>
    ${isStaff ? `<section class="panel"><details><summary>Atur poin dan kupon</summary><form data-form="point-settings">
      <div class="form-grid">${participationRules.map(rule => `<label class="field">${h(rule.label)}<input name="${rule.id}" type="number" min="0" max="100" step="1" required value="${data.pointRules[rule.id] ?? rule.points}"></label>`).join('')}
      <label class="field">Kuota kupon<input name="quota" type="number" min="${claimCount()}" max="100" step="1" value="${data.reward.quota}" required></label></div>
      <label class="check"><input type="checkbox" name="active"${data.reward.active ? ' checked' : ''}> Aktifkan pengajuan kupon</label>
      ${inlineError}<div class="actions">${submitButton('Simpan aturan poin')}</div></form></details></section>` : ''}
  </div>`;
}

const articles = [
  { title: 'Cara membuka riwayat KMS', category: 'Tumbuh kembang', description: 'Pilih nama anak dari daftar tertaut, lalu buka Riwayat kesehatan. Setiap baris menampilkan tanggal, satuan, dan lokasi pemeriksaan.' },
  { title: 'Menyiapkan kunjungan Posyandu', category: 'Jadwal', description: 'Periksa waktu dan lokasi di menu Jadwal posyandu. Ambil nomor layanan untuk jenis layanan yang tertera pada jadwal.' },
  { title: 'Menemukan catatan imunisasi', category: 'Riwayat', description: 'Buka Imunisasi dan pilih nama anak untuk melihat jenis, seri yang tercatat, serta lokasi pelayanan.' },
];
const newsItems = [
  { id: 'lansia-2023', title: 'Layanan kesehatan lansia di Karangsatria', date: '2023-09-27',
    place: 'Posbindu RW 032 · Desa Karangsatria', summary: 'UPTD Puskesmas Karang Satria membuka layanan kesehatan untuk pralansia dan lansia di Posbindu RW 032.',
    source: 'Pemkab Bekasi', url: 'https://www.bekasikab.go.id/uptd-puskesmas-karang-satria-buka-layanan-kesehatan-untuk-lansia', label: 'Arsip' },
  ];
function educationPage() {
  const tab = ui.educationTab ?? 'articles';
  const intro = screenTitle('Edukasi dan berita', 'Baca panduan layanan dan kabar dari Karangsatria.');
  return intro + `<div class="tabs" aria-label="Jenis bacaan">
    ${tabButton('Edukasi Kesehatan', 'education-tab', 'articles', tab)}
    ${tabButton('Berita Karangsatria', 'education-tab', 'news', tab)}
    </div>` + (tab === 'articles' ? `<section class="panel stack-tight"><h2>Panduan layanan</h2>
      ${articles.map(item => `<details><summary>${h(item.title)}</summary><p class="small muted">${h(item.description)}</p></details>`).join('')}</section>`
    : `<section class="panel stack"><h2>Berita Karangsatria</h2>
      ${locationField('news-location', { label: 'Lokasi berita', value: ui.newsLocation, required: false, empty: 'Seluruh desa', change: 'news-location' })}
      ${newsItems.filter(item => atLocation(item, ui.newsLocation)).map(item => `<article class="news-entry stack-tight">
        <div class="row">${pill(item.label, item.url ? 'good' : 'warn')}<span class="small muted">${dateLabel(item.date)}</span></div>
        <h3>${h(item.title)}</h3><p class="small muted">${h(item.place ?? locationName(item.location))} · ${h(item.source)}</p>
        <p>${h(item.summary)}</p><div>${action('Baca selengkapnya', 'news-detail', 'secondary', `data-news="${item.id}" aria-label="Baca selengkapnya ${h(item.title)}"`)}</div>
      </article>`).join('') || '<p class="empty">Belum ada berita untuk pilihan ini.</p>'}
    </section>`);
}


function activateRemoteFamily(household, remoteMembers, remoteScreenings = []) {
  const family = {
    id: household.id,
    kk: '',
    kk_last4: household.kk_last4 || '',
    name: household.head_name,
    location: household.location_id,
    email: household.email,
    phone: household.phone,
    address: household.address,
    rt: household.rt,
    rw: household.rw,
    createdAt: household.created_at,
  };
  const mappedMembers = (remoteMembers || []).map(member => {
    const born = String(member.birth_date || '');
    const ageMs = born ? Date.now() - new Date(born + 'T12:00:00+07:00').getTime() : Infinity;
    const isUnderFive = ageMs >= 0 && ageMs < 5 * 365.25 * 24 * 60 * 60 * 1000;
    return {
      id: member.id, familyId: household.id, name: member.full_name, born,
      sex: member.sex, relation: member.relation, location: household.location_id,
      selectedForExam: member.selected_for_exam, childId: isUnderFive ? member.id : '',
    };
  });
  const mappedChildren = mappedMembers.filter(member => member.childId).map(member => ({
    id: member.childId, name: member.name, born: member.born, familyId: household.id,
    location: household.location_id, relation: 'Orang tua',
  }));
  data.households = [...(data.households || []).filter(item => item.id !== family.id), family];
  data.familyMembers = [...(data.familyMembers || []).filter(item => item.familyId !== family.id), ...mappedMembers];
  data.children = [...(data.children || []).filter(item => item.familyId !== family.id), ...mappedChildren];
  data.screenings = (remoteScreenings || []).map(row => mapRemoteScreening(row, mappedMembers, [family]));
  syncHouseholdList();
  authProfileRole = 'keluarga';
  session = { role: 'keluarga', familyId: family.id, issuedAt: Date.now(), lastActivity: Date.now() };
  writeStorage('sessionStorage', ACTIVITY_KEY, String(session.lastActivity));
  role = 'keluarga';
  if (!window.posyanduSupabaseConfigured) writeStorage('sessionStorage', SESSION_KEY, JSON.stringify(session));
  ui.familyChild = mappedChildren[0]?.id || '';
  ui.pendingRoute = '';
  navigate('keluarga/dashboard');
}

async function fetchAndActivateRemoteFamily(client, userId) {
  const { data: profile, error: profileError } = await client.from('profiles').select('id,full_name,role,is_active').eq('id', userId).single();
  if (profileError) throw profileError;
  if (profile.is_active === false) throw new Error('Akun dinonaktifkan oleh administrator. Hubungi pengelola Posyandu.');
  if (profile.role !== 'keluarga') throw new Error('Akun ini bukan akun keluarga. Gunakan akses kader/admin yang diberikan pengelola.');
  const { data: household, error: householdError } = await client.from('households').select('*').eq('owner_user_id', userId).single();
  if (householdError) throw new Error('Akun sudah terverifikasi, tetapi data keluarga belum ditemukan. Pendaftaran keluarga belum selesai atau perlu bantuan admin.');
  const { data: members, error: membersError } = await client.from('family_members').select('*').eq('household_id', household.id).order('created_at');
  if (membersError) throw membersError;
  const { data: screenings, error: screeningError } = await client.from('screening_sessions').select('*').eq('household_id', household.id).order('submitted_at', { ascending: false });
  if (screeningError) throw screeningError;
  await loadRemoteQuestionBank(client);
  await loadRemoteEvents(client);
  await loadRemoteQueues(client, { householdId: household.id });
  activateRemoteFamily(household, members || [], screenings || []);
}

async function fetchAndActivateRemoteStaff(client, userId, profileRole) {
  if (!['kader', 'admin'].includes(profileRole)) throw new Error('Akun ini tidak memiliki akses kader.');
  let assignedLocations = locations.map(item => item.id);
  if (profileRole !== 'admin') {
    const { data: assignments, error: assignmentError } = await client.from('kader_locations').select('location_id').eq('user_id', userId);
    if (assignmentError) throw assignmentError;
    assignedLocations = (assignments || []).map(item => item.location_id);
    if (!assignedLocations.length) throw new Error('Akun kader belum memiliki penugasan Posyandu. Hubungi administrator.');
  }
  const { data: remoteHouseholds, error: householdError } = await client.from('households').select('*').in('location_id', assignedLocations);
  if (householdError) throw householdError;
  const householdIds = (remoteHouseholds || []).map(item => item.id);
  let remoteMembers = [];
  if (householdIds.length) {
    const { data: members, error: membersError } = await client.from('family_members').select('*').in('household_id', householdIds).order('created_at');
    if (membersError) throw membersError;
    remoteMembers = members || [];
  }
  const mappedFamilies = (remoteHouseholds || []).map(household => ({
    id: household.id, kk: '', kk_last4: household.kk_last4 || '', name: household.head_name,
    location: household.location_id, email: household.email, phone: household.phone,
    address: household.address, rt: household.rt, rw: household.rw, createdAt: household.created_at,
  }));
  const mappedMembers = remoteMembers.map(member => ({
    id: member.id, familyId: member.household_id, name: member.full_name, born: member.birth_date,
    sex: member.sex, relation: member.relation,
    location: mappedFamilies.find(item => item.id === member.household_id)?.location || '',
    selectedForExam: member.selected_for_exam, childId: '',
  }));
  const mappedChildren = mappedMembers.filter(member => {
    const ageMs = member.born ? Date.now() - new Date(member.born + 'T12:00:00+07:00').getTime() : Infinity;
    return ageMs >= 0 && ageMs < 5 * 365.25 * 24 * 60 * 60 * 1000;
  }).map(member => {
    member.childId = member.id;
    return { id: member.id, name: member.name, born: member.born, familyId: member.familyId, location: member.location, relation: 'Orang tua' };
  });
  data.households = mappedFamilies;
  data.familyMembers = mappedMembers;
  data.children = mappedChildren;
  data.screenings = [];
  syncHouseholdList();
  await loadRemoteQuestionBank(client);
  await Promise.all([
    fetchRemoteScreenings(client, { locationIds: assignedLocations }),
    loadRemoteEvents(client, assignedLocations),
    loadRemoteQueues(client, { locationIds: assignedLocations }),
  ]);
  try {
    await loadRemoteStock(client, assignedLocations);
    ui.stockMigrationError = '';
  } catch (stockError) {
    data.lots = []; data.transactions = []; data.dispatches = [];
    ui.stockMigrationError = stockError.message || 'Tabel manajemen stok belum tersedia.';
    console.warn('Manajemen stok belum dimigrasikan:', stockError);
  }
  if (profileRole === 'admin') await loadAdminAccounts(client);
  kaderAccount.locations = assignedLocations;
  authProfileRole = profileRole;
  session = { role: 'kader', familyId: '', issuedAt: Date.now(), lastActivity: Date.now() };
  writeStorage('sessionStorage', ACTIVITY_KEY, String(session.lastActivity));
  role = 'kader';
  if (!window.posyanduSupabaseConfigured) writeStorage('sessionStorage', SESSION_KEY, JSON.stringify(session));
  navigate('kader/dashboard');
}

async function completePendingFamilyRegistration(form) {
  const registration = pendingFamilyRegistration;
  if (!registration) throw new Error('Data pendaftaran sementara tidak ditemukan. Silakan mulai pendaftaran kembali.');
  const client = supabaseClient();
  const householdData = {
    kk: registration.kk,
    head_name: registration.headName,
    email: registration.email,
    phone: registration.phone,
    address: registration.address,
    rt: registration.rt,
    rw: registration.rw,
    location_id: registration.location,
  };
  const membersData = registration.members.map(member => ({
    full_name: member.name,
    birth_date: member.born,
    sex: member.sex,
    relation: member.relation,
    selected_for_exam: member.selected,
  }));
  const { data: householdId, error } = await client.rpc('register_household_and_members', {
    household_data: householdData,
    members_data: membersData,
  });
  if (error) throw error;
  const { data: household, error: householdError } = await client.from('households').select('*').eq('id', householdId).single();
  if (householdError) throw householdError;
  const { data: members, error: membersError } = await client.from('family_members').select('*').eq('household_id', householdId).order('created_at');
  if (membersError) throw membersError;
  const { data: screenings, error: screeningError } = await client.from('screening_sessions').select('*').eq('household_id', householdId).order('submitted_at', { ascending: false });
  if (screeningError) throw screeningError;
  await loadRemoteQuestionBank(client);
  await loadRemoteEvents(client);
  await loadRemoteQueues(client, { householdId: household.id });
  pendingFamilyRegistration = null;
  ui.registrationStep = 'done';
  ui.registrationDone = true;
  ui.pendingEmail = registration.email;
  activateRemoteFamily(household, members || [], screenings || []);
  say('Email terverifikasi dan data keluarga berhasil disimpan.');
}

Object.assign(actions, {
  'login-role'(button) {
    ui.loginRole = button.dataset.tab;
    render();
    $(`[data-action="login-role"][data-tab="${ui.loginRole}"]`)?.focus();
  },
  async 'resend-family-signup-otp'() {
    try {
      if (!ui.pendingEmail) throw new Error('Alamat email pendaftaran tidak ditemukan.');
      const { error } = await supabaseClient().auth.resend({ type: 'signup', email: ui.pendingEmail });
      if (error) throw error;
      say('Permintaan pengiriman ulang OTP berhasil. Periksa kotak masuk dan folder spam.');
    } catch (error) { say(error.message || 'OTP belum dapat dikirim ulang.'); }
  },
  async 'cancel-family-signup'() {
    try { if (window.posyanduSupabase) await window.posyanduSupabase.auth.signOut(); } catch { /* Continue clearing local pending form. */ }
    pendingFamilyRegistration = null;
    ui.registrationStep = 'form';
    ui.registrationDone = false;
    ui.pendingEmail = '';
    render();
  },
  'add-member-row'(button) {
    const list = $('[data-member-list]');
    if (!list || list.children.length >= 8) { say('Maksimal 8 anggota tambahan dalam satu pendaftaran.'); return; }
    list.insertAdjacentHTML('beforeend', memberRow(list.children.length + 1));
    list.lastElementChild.querySelector('input')?.focus();
  },
  'remove-member-row'(button) { button.closest('[data-member-row]')?.remove(); },
  'family-detail'(button) {
    if (role !== 'kader') return;
    const family = householdById(button.dataset.family);
    if (!family || (staffLocation() && family.location !== staffLocation())) return;
    const members = familyMembersFor(family.id);
    showDetails('Anggota keluarga · ' + family.name, `<dl class="data-list"><div><dt>Nomor KK</dt><dd>${h(maskedKK(family.id))}</dd></div><div><dt>Alamat</dt><dd>${h(family.address ?? locationById(family.location)?.address ?? 'Belum dicatat')}</dd></div><div><dt>Jumlah anggota</dt><dd>${members.length} orang</dd></div></dl>${table(['Nama', 'Tanggal lahir', 'Jenis kelamin', 'Hubungan', 'Pemeriksaan'], members.map(member => [h(member.name), member.born ? dateLabel(member.born) : '—', h(member.sex ?? '—'), h(member.relation), member.selectedForExam === false ? pill('Tidak dipilih') : pill('Dipilih', 'good')]), 'Anggota keluarga')}`, button);
  },
  'open-directory'(button) {
    setFilter('directoryLocation', button.dataset.location, 'directory-location');
  },
  'verify-directory'(button) {
    const profile = data.directoryProfiles[button.dataset.location];
    if (role !== 'kader' || !staffLocations().some(place => place.id === button.dataset.location)
      || profile?.status !== 'Perlu verifikasi' || profile.revision !== button.dataset.revision) return;
    const { address, mapUrl, revision } = profile;
    data.directoryProfiles[button.dataset.location] = { address, mapUrl, revision, status: 'Terverifikasi', verifiedOn: today };
    changed('Alamat dan peta diperbarui. Verifikasi lapangan tetap diperlukan.');
  },
  'enable-phone-notification'() { return testPhoneNotification(true); },
  'test-phone-notification'() { return testPhoneNotification(); },
  'refresh-phone-notification'() { refreshPhoneNotification(); },
  'child-detail'(button) {
    const child = staffChildren().find(item => item.id === button.dataset.child);
    if (!child) return;
    showDetails(child.name + ' · ' + maskedKK(child.familyId), `
      <dl class="data-list">
        <div><dt>Nomor KK</dt><dd>${h(maskedKK(child.familyId))}</dd></div>
        <div><dt>Tanggal lahir</dt><dd>${dateLabel(child.born)}</dd></div>
        <div><dt>Wali tertaut</dt><dd>${h(householdById(child.familyId).name)} · ${h(child.relation)}</dd></div>
        <div><dt>Posyandu terdaftar</dt><dd>${locationDetail(child.location)}</dd></div>
      </dl><div class="actions">${action('Catat KMS', 'choose-kms', 'primary', `data-child="${h(child.id)}"`)}</div>`, button);
  },
  async 'cancel-event'(button) {
    const found = data.events.find(item => item.id === button.dataset.event);
    if (role !== 'kader' || found?.status !== 'Terjadwal') return;
    try {
      if (window.posyanduSupabaseConfigured) {
        const client = supabaseClient();
        await cancelRemoteEvent(client, found.id);
        const { error: queueError } = await client.from('posyandu_queues')
          .update({ status: 'Dibatalkan' }).eq('event_id', found.id).in('status', ['Menunggu', 'Dipanggil']);
        if (queueError) throw queueError;
        await loadRemoteQueues(client, { locationIds: kaderAccount.locations });
      } else found.status = 'Dibatalkan';
      for (const row of data.queues) {
        if (row.eventId === found.id && ['Menunggu', 'Dipanggil'].includes(row.status)) row.status = 'Dibatalkan';
      }
      save(); render(true); say('Jadwal berhasil dibatalkan.');
    } catch (error) {
      say('Jadwal belum berhasil dibatalkan: ' + (error.message || 'Periksa koneksi dan izin database.'));
    }
  },
  async 'refresh-queues'() {
    if (!window.posyanduSupabaseConfigured) {
      render(true);
      say('Daftar antrean lokal sudah diperbarui pada perangkat ini.');
      return;
    }
    try {
      const client = supabaseClient();
      if (role === 'keluarga') {
        await loadRemoteEvents(client);
        await loadRemoteQueues(client, { householdId: session.familyId });
      } else {
        await Promise.all([
          loadRemoteEvents(client, kaderAccount.locations),
          loadRemoteQueues(client, { locationIds: kaderAccount.locations }),
        ]);
      }
      render(true);
      say('Jadwal dan daftar antrean berhasil dimuat ulang dari database.');
    } catch (error) {
      say('Daftar antrean belum dapat dimuat: ' + (error.message || 'Periksa koneksi dan izin database.'));
    }
  },
  'queue-detail'(button) { openQueueDetail(button.dataset.id, false, button); },
  'screening-detail'(button) { openQueueDetail(button.dataset.id, true, button); },
  'queue-step'(button) { updateQueueStep(button, false); },
  'screening-step'(button) { updateQueueStep(button, true); },
  async 'queue-cancel'(button) {
    const item = data.queues.find(row => row.id === button.dataset.id && row.familyId === session.familyId);
    if (item?.status !== 'Menunggu') {
      render();
      say('Pendaftaran layanan sudah berubah. Periksa status terbaru.');
      return;
    }
    try {
      if (window.posyanduSupabaseConfigured) {
        const { data: row, error } = await supabaseClient().from('posyandu_queues')
          .update({ status: 'Dibatalkan' }).eq('id', item.id).eq('status', 'Menunggu').select('*').single();
        if (error) throw error;
        const mapped = mapRemoteQueue(row);
        data.queues = data.queues.map(entry => entry.id === mapped.id ? mapped : entry);
      } else {
        item.status = 'Dibatalkan';
        save();
      }
      render(true);
      say('Pendaftaran layanan ' + item.code + ' berhasil dibatalkan.');
    } catch (error) {
      say('Pendaftaran belum berhasil dibatalkan: ' + (error.message || 'Periksa koneksi dan izin database.'));
    }
  },
  'screening-back'() {
    if (!ui.screeningDraft) return;
    ui.screeningDraft.step = Math.max(-1, ui.screeningDraft.step - 1);
    render();
    $('.dash legend, .dash form select')?.focus();
  },
  'stock-tab'(button) {
    ui.stockTab = button.dataset.tab;
    render();
    $(`[data-action="stock-tab"][data-tab="${ui.stockTab}"]`)?.focus();
  },
  'education-tab'(button) {
    ui.educationTab = button.dataset.tab;
    render();
    $(`[data-action="education-tab"][data-tab="${ui.educationTab}"]`)?.focus();
  },
  'news-detail'(button) {
    const item = newsItems.find(row => row.id === button.dataset.news);
    if (!item) return;
    showDetails(item.title, `<div class="row">${pill(item.label, item.url ? 'good' : 'warn')}<span class="small muted">${dateLabel(item.date)}</span></div>
      <p class="small muted">${h(item.place ?? locationName(item.location))} · ${h(item.source)}</p><p>${h(item.summary)}</p>
      ${item.url ? `<a class="btn secondary fit" href="${h(item.url)}" target="_blank" rel="noopener noreferrer">Buka artikel Pemkab Bekasi ${icon('arrow')}</a>` : ''}`, button);
  },
  certificate(button) {
    const familyId = button.dataset.family;
    const certificate = data.certificates[familyId];
    if ((role !== 'kader' && session.familyId !== familyId) || !certificate) return;
    showDetails('Sertifikat Keluarga Aktif', `<div class="certificate-card stack-tight">
      <div class="eyebrow">Posyandu Karangsatria</div>${pill('Sertifikat digital', 'good')}<h3>${h(certificate.name)}</h3>
      <p>Meraih penghargaan Keluarga Aktif atas partisipasi dalam program Bunda Teladan.</p>
      <dl class="data-list">
        <div><dt>Nomor</dt><dd>${h(certificate.number)}</dd></div>
        <div><dt>Tanggal terbit</dt><dd>${dateLabel(certificate.issuedOn)}</dd></div>
        <div><dt>Lokasi</dt><dd>${h(locationName(certificate.location))}</dd></div>
        <div><dt>Poin terverifikasi</dt><dd>${fmt(certificate.points)}</dd></div>
        <div><dt>Penerbit dan penandatangan</dt><dd>${h(certificate.issuer)}</dd></div>
      </dl></div>`, button);
  },
  'issue-certificate'(button) {
    const family = householdById(button.dataset.family);
    if (role !== 'kader' || !family || data.certificates[family.id]) return;
    const points = pointsForFamily(family.id);
    if (points < 50) return;
    data.certificates[family.id] = {
      number: 'SKA-AWAL-' + family.kk.slice(-4), name: family.name, location: family.location,
      points, issuedOn: today, issuer: 'Koordinator Posyandu',
    };
    changed('Sertifikat tersimpan pada perangkat ini.');
  },
  'reward-claim'() {
    const familyId = session.familyId;
    if (role !== 'keluarga' || pointsForFamily(familyId) < 100 || activeClaim(familyId) || !data.reward.active || remainingRewards() < 1) {
      render();
      say('Kupon belum tersedia untuk pengajuan ini.');
      return;
    }
    data.claims.push({ familyId, period: data.reward.period, status: 'Diajukan' });
    changed('Kupon diajukan. Status bisa dilihat di Bunda Teladan.');
  },
  'reward-step'(button) {
    const claim = activeClaim(button.dataset.family);
    if (role !== 'kader' || claim?.status !== button.dataset.status || claim.status === 'Diambil') return;
    claim.status = claim.status === 'Diajukan' ? 'Disetujui' : 'Diambil';
    changed('Status kupon · ' + claim.status);
  },
});

Object.assign(forms, {
  async 'staff-login'(form, fields) {
    const email = normalizeContact(fields.get('email'));
    const password = String(fields.get('password') || '');
    try {
      const client = supabaseClient();
      const { data: authData, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: profile, error: profileError } = await client.from('profiles').select('role,is_active').eq('id', authData.user.id).single();
      if (profileError) throw profileError;
      if (profile.is_active === false) throw new Error('Akun dinonaktifkan oleh administrator. Hubungi pengelola Posyandu.');
      await fetchAndActivateRemoteStaff(client, authData.user.id, profile.role);
      say(profile.role === 'admin' ? 'Berhasil masuk sebagai administrator.' : 'Berhasil masuk sebagai kader.');
    } catch (error) {
      try { await supabaseClient().auth.signOut(); } catch { /* Clear partial sign-in if role loading failed. */ }
      authProfileRole = '';
      formError(form, 'email', error.message || 'Email atau kata sandi tidak sesuai.');
    }
  },
  async 'parent-login'(form, fields) {
    const email = normalizeContact(fields.get('email'));
    const password = String(fields.get('password') || '');
    if (!email || !password) { formError(form, null, 'Isi email dan kata sandi.'); return; }
    try {
      const client = supabaseClient();
      const { data: authData, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await fetchAndActivateRemoteFamily(client, authData.user.id);
      say('Berhasil masuk ke akun keluarga.');
    } catch (error) {
      try { await supabaseClient().auth.signOut(); } catch { /* Clear partial sign-in if profile loading failed. */ }
      authProfileRole = '';
      formError(form, 'email', error.message || 'Email atau kata sandi tidak sesuai.');
    }
  },
  'save-directory'(form, fields) {
    const location = fields.get('location');
    const address = String(fields.get('address')).trim();
    let mapUrl;
    try {
      mapUrl = new URL(fields.get('map-url'));
    } catch {
      formError(form, 'map-url', 'Tempel tautan Google Maps yang valid.');
      return;
    }
    if (role !== 'kader' || !staffLocations().some(place => place.id === location)) return;
    if (!address || mapUrl.protocol !== 'https:' || mapUrl.username || mapUrl.password
      || !['www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl'].includes(mapUrl.hostname)
      || (mapUrl.hostname === 'www.google.com' && !mapUrl.pathname.startsWith('/maps'))
      || (mapUrl.hostname === 'goo.gl' && !mapUrl.pathname.startsWith('/maps/'))) {
      formError(form, 'map-url', 'Isi alamat dan gunakan tautan HTTPS Google Maps.');
      return;
    }
    const existing = data.directoryProfiles[location];
    const profile = { address, mapUrl: mapUrl.href, status: 'Perlu verifikasi', revision: crypto.randomUUID() };
    if (existing?.status === 'Terverifikasi') profile.published = existing;
    else if (existing?.published) profile.published = existing.published;
    data.directoryProfiles[location] = profile;
    changed('Alamat disimpan dan menunggu pengecekan kader.');
  },
  search(_form, fields) {
    ui.participantSearch = String(fields.get('query')).trim();
    render();
    $('input[name="query"]')?.focus();
  },
  async 'register-family'(form, fields) {
    const kk = String(fields.get('kk') ?? '').trim();
    const headName = String(fields.get('head-name') ?? '').trim();
    const email = normalizeContact(fields.get('email'));
    const rawPhone = String(fields.get('phone') ?? '').replace(/[^0-9+]/g, '');
    const phone = rawPhone.replace(/^\+?62/, '0');
    const location = fields.get('location');
    const password = String(fields.get('password') ?? '');
    const rawMembers = fields.getAll('member-name').map((value, index) => ({
      name: String(value).trim(), born: fields.getAll('member-born')[index], sex: fields.getAll('member-sex')[index],
      relation: fields.getAll('member-relation')[index], key: fields.getAll('member-key')[index],
      selected: fields.getAll('member-screen').includes(fields.getAll('member-key')[index]),
    }));
    const additionsInput = rawMembers.filter(member => member.name || member.born || member.sex || member.relation);
    if (!/^\d{16}$/.test(kk) || !headName || !/^\S+@\S+\.\S+$/.test(email) || phone.replace(/\D/g, '').length < 9
      || !locationById(location) || !fields.get('head-born') || fields.get('head-born') > today || !fields.get('head-sex')
      || !String(fields.get('address') ?? '').trim() || !String(fields.get('rt') ?? '').trim() || !String(fields.get('rw') ?? '').trim() || !fields.get('consent')) {
      formError(form, null, 'Periksa nomor KK, identitas kepala keluarga, kontak, tanggal lahir, wilayah, dan persetujuan.'); return;
    }
    if (password.length < 12 || password !== fields.get('confirm-password')) {
      formError(form, 'password', 'Kata sandi harus minimal 12 karakter dan kedua isian harus sama.'); return;
    }
    if (additionsInput.some(member => !member.name || !member.born || member.born > today || !member.sex || !member.relation)) {
      formError(form, null, 'Lengkapi semua kolom pada baris anggota tambahan, atau hapus baris yang tidak digunakan.'); return;
    }
    try {
      const client = supabaseClient();
      pendingFamilyRegistration = {
        kk, headName, email, phone, location,
        address: String(fields.get('address')).trim(), rt: String(fields.get('rt')).trim(), rw: String(fields.get('rw')).trim(),
        members: [
          { name: headName, born: fields.get('head-born'), sex: fields.get('head-sex'), relation: 'Kepala keluarga', selected: true },
          ...additionsInput.map(member => ({ name: member.name, born: member.born, sex: member.sex, relation: member.relation, selected: member.selected })),
        ],
      };
      const { data: authData, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { full_name: headName } },
      });
      if (error) throw error;
      if (authData.session) {
        await client.auth.signOut();
        throw new Error('Verifikasi email belum diwajibkan pada Supabase. Aktifkan Email Confirmations agar OTP wajib dikirim sebelum pendaftaran.');
      }
      ui.pendingEmail = email;
      ui.registrationStep = 'otp';
      ui.registrationDone = false;
      render();
      say('Permintaan pendaftaran dikirim. Masukkan OTP dari email Anda.');
    } catch (error) {
      pendingFamilyRegistration = null;
      formError(form, null, error.message || 'Pendaftaran belum berhasil. Periksa pengaturan Supabase dan coba kembali.');
    }
  },
  async 'verify-family-signup'(form, fields) {
    const token = String(fields.get('otp') || '').trim();
    if (!/^\d{8}$/.test(token)) { formError(form, 'otp', 'Masukkan kode OTP 8 digit dari email.'); return; }
    try {
      const client = supabaseClient();
      const { data: verified, error } = await client.auth.verifyOtp({ email: ui.pendingEmail, token, type: 'email' });
      if (error) throw error;
      if (!verified.user || !verified.session) throw new Error('Email belum terverifikasi. Periksa kode OTP dan coba lagi.');
      ui.registrationStep = 'save';
      render();
      await completePendingFamilyRegistration(form);
    } catch (error) {
      if (ui.registrationStep === 'save') {
        render();
        say('Email telah diverifikasi, tetapi penyimpanan data belum selesai: ' + (error.message || 'Coba tekan Simpan Data Keluarga.'));
      } else {
        formError(form, 'otp', error.message || 'Kode OTP tidak sesuai atau sudah kedaluwarsa.');
      }
    }
  },
  async 'complete-family-registration'(form) {
    try {
      await completePendingFamilyRegistration(form);
    } catch (error) {
      formError(form, null, error.message || 'Data belum berhasil disimpan. Coba kembali atau hubungi admin.');
    }
  },
  async 'update-exam-members'(form, fields) {
    const members = familyMembersFor(session.familyId);
    if (!members.length) return;
    const selected = new Set(fields.getAll('exam-member'));
    const selectedIds = members.filter(member => selected.has(member.id)).map(member => member.id);
    try {
      const { error } = await supabaseClient().rpc('update_household_exam_members', {
        p_selected_member_ids: selectedIds,
      });
      if (error) throw error;
      for (const member of members) member.selectedForExam = selected.has(member.id);
      render(true);
      say('Pilihan pemeriksaan tersimpan di database.');
    } catch (error) {
      formError(form, null, error.message || 'Pilihan pemeriksaan belum berhasil disimpan.');
    }
  },
  async 'family-add-member'(form, fields) {
    const name = String(fields.get('name') ?? '').trim();
    const born = fields.get('born');
    const relation = fields.get('relation');
    const family = householdById(session.familyId);
    if (!name || !born || born > today || !fields.get('sex') || !relation || !family) {
      formError(form, null, 'Lengkapi nama, tanggal lahir, jenis kelamin, dan hubungan anggota.'); return;
    }
    if (data.familyMembers.some(member => member.familyId === family.id && member.born === born && member.name.toLowerCase() === name.toLowerCase())) {
      formError(form, 'name', 'Anggota dengan nama dan tanggal lahir tersebut sudah tercatat.'); return;
    }
    try {
      const row = {
        household_id: family.id,
        full_name: name,
        birth_date: born,
        sex: fields.get('sex'),
        relation,
        selected_for_exam: fields.has('selected'),
      };
      const { data: inserted, error } = await supabaseClient().from('family_members').insert(row).select('*').single();
      if (error) throw error;
      const member = { id: inserted.id, familyId: family.id, name: inserted.full_name, born: inserted.birth_date,
        sex: inserted.sex, relation: inserted.relation, location: family.location,
        selectedForExam: inserted.selected_for_exam, childId: '' };
      const ageMs = Date.now() - new Date(born + 'T12:00:00+07:00').getTime();
      if (ageMs >= 0 && ageMs < 5 * 365.25 * 24 * 60 * 60 * 1000 && relation === 'Anak') {
        const child = { id: inserted.id, name, born, familyId: family.id, location: family.location, relation: 'Orang tua' };
        member.childId = child.id;
        data.children.push(child);
      }
      data.familyMembers.push(member);
      render(true);
      say('Anggota keluarga berhasil ditambahkan ke database.');
    } catch (error) {
      formError(form, null, error.message || 'Anggota keluarga belum berhasil ditambahkan.');
    }
  },
  'register-child'(form, fields) {
    const name = String(fields.get('name')).trim();
    const familyId = fields.get('family');
    const born = fields.get('born');
    const location = fields.get('location');
    if (!name || !householdById(familyId) || !staffLocations().some(item => item.id === location) || !born || born > today) {
      formError(form, null, 'Lengkapi nama, tanggal lahir, keluarga, dan lokasi peserta.');
      return;
    }
    if (data.children.some(item => item.familyId === familyId && item.born === born && item.name.toLowerCase() === name.toLowerCase())) {
      formError(form, 'name', 'Data anak dengan tanggal lahir dan KK ini sudah ada.');
      return;
    }
    const childId = crypto.randomUUID();
    data.children.push({ id: childId, name, born, familyId, location, relation: fields.get('relation') });
    data.familyMembers ??= [];
    data.familyMembers.push({ id: 'member-' + childId, familyId, name, born, sex: 'Tidak disebutkan', relation: 'Anak', location, selectedForExam: true, childId });
    ui.participantSearch = '';
    if (staffLocation() && staffLocation() !== location) ui.kaderLocation = location;
    changed('Peserta tersimpan dan tertaut ke keluarga.');
  },
  async event(form, fields) {
    const name = String(fields.get('name')).trim();
    const location = fields.get('location');
    const date = fields.get('date');
    const time = fields.get('time');
    if (!name || !date || !time || !staffLocations().some(item => item.id === location)) {
      formError(form, null, 'Lengkapi nama kegiatan, lokasi, tanggal, dan waktu.');
      return;
    }
    const selected = fields.getAll('vaccines');
    const event = { id: crypto.randomUUID(), name, location, date, time, status: 'Terjadwal',
      vitaminA: fields.has('vitamin-a'), vaccines: vaccines.filter(([id]) => selected.includes(id)).map(([id]) => id) };
    try {
      if (window.posyanduSupabaseConfigured) {
        await saveRemoteEvent(supabaseClient(), event);
        say('Jadwal berhasil disimpan ke database Posyandu.');
      } else {
        data.events.push(event);
        say('Jadwal tersimpan pada perangkat ini (mode lokal).');
      }
      save(); render(true);
    } catch (error) {
      formError(form, null, 'Jadwal belum tersimpan: ' + (error.message || 'Periksa koneksi dan izin database.'));
    }
  },
  reminder(_form, fields) {
    if (!householdById(session.familyId)) return;
    data.reminders[session.familyId] = Number(fields.get('days'));
    changed('Pengingat diperbarui.');
  },
  vaccination(form, fields) {
    const child = staffChildren().find(item => item.id === fields.get('child'));
    const location = fields.get('location');
    const date = fields.get('date');
    const vaccine = fields.get('vaccine');
    const series = fields.get('series');
    const source = fields.get('source');
    const facility = source === 'Fasilitas lain' ? String(fields.get('facility')).trim() : '';
    if (!child || !date || date < child.born || date > today || !staffLocations().some(item => item.id === location)
      || !vaccines.some(([id]) => id === vaccine) || !vaccineSeries.includes(series)) {
      formError(form, null, 'Pilih anak, imunisasi, seri, tanggal yang sesuai, dan lokasi.');
      return;
    }
    if (source === 'Fasilitas lain' && !facility) {
      formError(form, 'facility', 'Isi nama fasilitas untuk catatan dari luar Posyandu.');
      return;
    }
    if (data.vaccinations.some(item => item.child === child.id && item.date === date && item.vaccine === vaccine && item.series === series)) {
      formError(form, 'vaccine', 'Seri imunisasi ini sudah tercatat pada tanggal yang sama.');
      return;
    }
    data.vaccinations.push({ id: crypto.randomUUID(), child: child.id, location, date, vaccine, series, source, facility });
    ui.kaderChild = child.id;
    changed('Catatan imunisasi tersimpan.');
  },
  async queue(form, fields) {
    const child = familyChildren().find(item => item.id === fields.get('child'));
    const event = currentEvents(fields.get('location')).find(item => item.id === fields.get('event'));
    const service = fields.get('service');
    if (!child || !event || !queueServices.some(([id]) => id === service) || (service === 'imunisasi' && !event.vaccines.length)) {
      formError(form, null, 'Pilih anak, lokasi, jadwal aktif, dan layanan yang tersedia.');
      return;
    }
    try {
      if (window.posyanduSupabaseConfigured) {
        const { data: row, error } = await supabaseClient().rpc('take_posyandu_queue_number', {
          p_child_id: child.id,
          p_event_id: event.id,
          p_service_type: service,
        });
        if (error) throw error;
        if (!row || !row.id) throw new Error('Nomor antrean belum diterima dari database. Silakan muat ulang dan coba lagi.');
        const mapped = mapRemoteQueue(row);
        data.queues = [mapped, ...data.queues.filter(item => item.id !== mapped.id)];
        ui.queueChild = child.id;
        render(true);
        say('Nomor antrean ' + mapped.code + ' berhasil diambil dan tersimpan.');
        return;
      }
      if (data.queues.some(item => item.child === child.id && item.eventId === event.id && item.service === service && item.status !== 'Dibatalkan')) {
        formError(form, 'service', 'Pendaftaran anak untuk jadwal dan layanan ini sudah tercatat.');
        return;
      }
      const code = 'A-' + String(data.queues.length + 1).padStart(3, '0');
      data.queues.push({ id: crypto.randomUUID(), code, child: child.id, familyId: session.familyId, eventId: event.id,
        location: event.location, date: event.date, time: event.time, service, status: 'Menunggu' });
      ui.queueChild = child.id;
      changed('Nomor layanan ' + code + ' berhasil diambil pada perangkat ini.');
    } catch (error) {
      const message = error.code === '23505'
        ? 'Anak ini sudah memiliki nomor antrean untuk layanan tersebut pada jadwal yang dipilih.'
        : (error.message || 'Nomor antrean belum berhasil disimpan. Periksa koneksi dan pengaturan database.');
      formError(form, null, message);
    }
  },

  'screening-start'(form, fields) {
    const family = householdById(session.familyId);
    const location = fields.get('location');
    const personId = fields.get('member');
    const person = familyMembersFor(session.familyId).find(member => member.id === personId && member.selectedForExam !== false);
    if (!family || location !== family.location || !fields.get('agree') || !person || !activeScreeningQuestions.length) {
      formError(form, 'member', 'Pilih anggota keluarga yang sudah terdaftar untuk pemeriksaan dan setujui pengisian.');
      return;
    }
    ui.screeningDraft = { location: family.location, personId, answers: ui.screeningDraft?.personId === personId ? ui.screeningDraft.answers : [], step: 0 };
    render();
    $('.dash input[name="answer"]')?.focus();
  },
  'screening-answer'(form, fields) {
    const draft = ui.screeningDraft;
    const question = draft ? activeScreeningQuestions[draft.step] : null;
    const choiceIndex = Number(fields.get('answer'));
    const answer = Number.isInteger(choiceIndex) ? question?.choices?.[choiceIndex] : null;
    if (!draft || draft.step < 0 || draft.step >= activeScreeningQuestions.length || !answer) {
      formError(form, null, 'Pilih satu jawaban untuk melanjutkan.');
      return;
    }
    draft.answers[draft.step] = answer;
    draft.step++;
    render();
    ($('.dash input[name="answer"]') ?? $('.dash select[name="contact-time"]'))?.focus();
  },
  async 'screening-finish'(form, fields) {
    const draft = ui.screeningDraft;
    const count = activeScreeningQuestions.length;
    if (role !== 'keluarga' || !draft || draft.step !== count || draft.answers.length !== count) return;
    const respondent = familyMembersFor(session.familyId).find(member => member.id === draft.personId && member.selectedForExam !== false);
    if (!respondent) { formError(form, null, 'Anggota keluarga tidak ditemukan atau tidak lagi dipilih untuk pemeriksaan. Mulai kembali skrining.'); return; }
    try {
      const client = supabaseClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw authError;
      if (!authData?.user?.id) throw new Error('Sesi masuk tidak ditemukan. Silakan masuk kembali.');
      const answers = activeScreeningQuestions.map((question, index) => ({
        question_code: question.code,
        question_text: question.question_text,
        question_version: question.version || 1,
        answer: draft.answers[index],
      }));
      const payload = {
        household_id: session.familyId,
        respondent_member_id: respondent.id,
        submitted_by: authData.user.id,
        location_id: draft.location,
        form_type: 'skrining_awal',
        form_version: Math.max(1, ...activeScreeningQuestions.map(question => Number(question.version) || 1)),
        answers,
        contact_time: fields.get('contact-time') || null,
        status: 'Menunggu',
      };
      const { data: inserted, error } = await client.from('screening_sessions').insert(payload).select('*').single();
      if (error) throw error;
      data.screenings.unshift(mapRemoteScreening(inserted, data.familyMembers, data.households));
      ui.screeningDraft = null;
      render(true);
      say('Jawaban skrining berhasil dikirim dan tersimpan.');
    } catch (error) {
      formError(form, null, error.message || 'Jawaban belum berhasil disimpan. Periksa koneksi dan coba kembali.');
    }
  },
  stock(form, fields) {
    const lot = data.lots.find(item => item.id === fields.get('lot') && item.location === fields.get('location'));
    const amount = Number(fields.get('amount'));
    const direction = fields.get('direction');
    if (!lot || !Number.isSafeInteger(amount) || amount <= 0 || !['Masuk', 'Keluar'].includes(direction)) {
      formError(form, null, 'Pilih lokasi, lot, dan jumlah yang valid.');
      return;
    }
    if (direction === 'Keluar' && lot.count < amount) {
      formError(form, 'amount', 'Jumlah keluar melebihi saldo lot.');
      return;
    }
    lot.count += direction === 'Keluar' ? -amount : amount;
    data.transactions.unshift({ item: lot.item, location: lot.location, direction, amount });
    changed('Transaksi stok tersimpan.');
  },
  dispatch(form, fields) {
    const location = fields.get('location');
    const origin = fields.get('origin');
    const lot = data.lots.find(item => item.id === fields.get('lot') && item.location === origin);
    const date = fields.get('date');
    const issued = Number(fields.get('issued'));
    const used = Number(fields.get('used'));
    const returned = Number(fields.get('returned'));
    if (!locationById(location) || !lot || !date || ![issued, used, returned].every(Number.isSafeInteger) || issued < 1 || used < 0 || returned < 0) {
      formError(form, null, 'Lengkapi tujuan, asal, lot, tanggal, dan jumlah barang.');
      return;
    }
    if (issued > lot.count) {
      formError(form, 'issued', 'Jumlah dibawa melebihi saldo lot.');
      return;
    }
    const reusable = lot.kind === 'Dikembalikan';
    if (used > issued || returned > issued || (!reusable && used + returned > issued)) {
      formError(form, 'returned', 'Jumlah pakai dan kembali melebihi barang yang dibawa.');
      return;
    }
    lot.count -= issued - returned;
    const sessions = data.events.filter(item => item.location === location && item.date === date && item.status !== 'Dibatalkan');
    const eventId = sessions.length === 1 ? sessions[0].id : undefined;
    data.dispatches.unshift({ id: crypto.randomUUID(), eventId, location, origin, date, item: lot.item, lot: lot.lot, expiry: lot.expiry,
      kind: lot.kind, unit: lot.unit, issued, used, returned, remaining: issued - returned - (reusable ? 0 : used) });
    if (staffLocation() && staffLocation() !== location) ui.kaderLocation = location;
    changed('Barang dibawa tercatat dan saldo diperbarui.');
  },
  points(form, fields) {
    const id = fields.get('activity');
    const familyId = fields.get('family');
    const event = participationEvents.find(item => item.id === id);
    if (!event || !householdById(familyId)) return;
    if (data.points.some(item => item.familyId === familyId && item.id === id)) {
      formError(form, 'activity', 'Aktivitas ini sudah dihitung untuk keluarga tersebut.');
      return;
    }
    const credit = participationCredit(event, familyId, data.pointRules);
    data.points.push(credit);
    changed('Aktivitas terverifikasi. +' + credit.points + ' poin.');
  },
  'point-settings'(form, fields) {
    if (role !== 'kader') return;
    const rules = participationRules.map(rule => [rule.id, Number(fields.get(rule.id))]);
    const quota = Number(fields.get('quota'));
    if (rules.some(([, points]) => !Number.isSafeInteger(points) || points < 0 || points > 100)) {
      formError(form, null, 'Isi angka poin antara 0 dan 100.');
      return;
    }
    if (!Number.isSafeInteger(quota) || quota < claimCount() || quota > 100) {
      formError(form, 'quota', 'Kuota harus menampung kupon yang sudah diajukan.');
      return;
    }
    data.pointRules = Object.fromEntries(rules);
    data.reward = { ...data.reward, quota, active: Boolean(fields.get('active')) };
    changed('Aturan poin dan kupon disimpan.');
  },
});

Object.assign(actions, {
  async 'refresh-admin-accounts'() {
    if (!isAdministrator()) return;
    try {
      await loadAdminAccounts(supabaseClient());
      render(true);
      say('Daftar akun diperbarui.');
    } catch (error) { say(error.message || 'Daftar akun belum dapat dimuat.'); }
  },
  async logout() {
    try {
      if (window.posyanduSupabase) {
        const { error } = await window.posyanduSupabase.auth.signOut();
        if (error) throw error;
      }
      authProfileRole = '';
      pendingFamilyRegistration = null;
      try { window.sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* Browser storage may be unavailable. */ }
      chooseRole('');
      say('Anda sudah keluar dari akun.');
    } catch (error) {
      say(error.message || 'Belum berhasil keluar. Coba kembali.');
    }
  },
  async 'refresh-screenings'() {
    try {
      const filters = role === 'keluarga' ? { householdId: session.familyId } : { locationIds: kaderAccount.locations };
      await fetchRemoteScreenings(supabaseClient(), filters);
      render(true);
      say('Daftar hasil skrining diperbarui dari database.');
    } catch (error) { say(error.message || 'Hasil skrining belum dapat dimuat ulang.'); }
  },
  async 'toggle-screening-question'(button) {
    if (!isAdministrator()) return;
    const question = screeningQuestionBank.find(item => item.id === button.dataset.question);
    if (!question || !question.id || String(question.id).startsWith('local-')) return;
    const nextActive = button.dataset.active !== 'true';
    try {
      const { error } = await supabaseClient().from('screening_questions').update({ is_active: nextActive, version: (question.version || 1) + 1 }).eq('id', question.id);
      if (error) throw error;
      await loadRemoteQuestionBank(supabaseClient());
      render(true);
      say(nextActive ? 'Pertanyaan diaktifkan.' : 'Pertanyaan dinonaktifkan. Jawaban lama tetap tersimpan.');
    } catch (error) { say(error.message || 'Status pertanyaan belum berhasil diubah.'); }
  },
});
mutatingActions.add('toggle-screening-question');
mutatingActions.add('refresh-screenings');
// These actions persist directly to Supabase. Do not reload the browser's legacy localStorage snapshot before running them.
for (const name of ['screening-step', 'toggle-screening-question', 'refresh-screenings', 'refresh-admin-accounts']) mutatingActions.delete(name);
for (const name of ['register-family', 'update-exam-members', 'family-add-member', 'screening-finish', 'admin-update-account', 'admin-add-question', 'request-password-reset', 'save-new-password']) mutatingForms.delete(name);

Object.assign(forms, {
  async 'admin-update-account'(form, fields) {
    if (!isAdministrator()) { formError(form, null, 'Hanya administrator yang dapat mengelola akun.'); return; }
    const userId = form.dataset.userId;
    const account = adminAccounts.find(item => item.id === userId);
    const nextRole = fields.get('role');
    const isActive = fields.has('active');
    const locationIds = fields.getAll('location');
    if (!account || account.role === 'admin' || !['keluarga', 'kader'].includes(nextRole)) {
      formError(form, null, 'Akun atau peran tidak valid.'); return;
    }
    if (nextRole === 'kader' && !locationIds.length) {
      formError(form, null, 'Pilih minimal satu wilayah tugas untuk akun kader.'); return;
    }
    try {
      const { error } = await supabaseClient().rpc('admin_update_account', {
        p_user_id: userId,
        p_role: nextRole,
        p_is_active: isActive,
        p_location_ids: nextRole === 'kader' ? locationIds : [],
      });
      if (error) throw error;
      await loadAdminAccounts(supabaseClient());
      render(true);
      say('Peran, status, dan penugasan akun berhasil diperbarui.');
    } catch (error) { formError(form, null, error.message || 'Pengaturan akun belum berhasil disimpan.'); }
  },
  async 'admin-add-question'(form, fields) {
    if (!isAdministrator()) { formError(form, null, 'Hanya administrator yang dapat mengelola pertanyaan.'); return; }
    const question = String(fields.get('question') || '').trim();
    const choices = [...new Set(String(fields.get('choices') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
    if (question.length < 8 || choices.length < 2 || choices.length > 12 || choices.some(choice => choice.length > 100)) {
      formError(form, null, 'Isi pertanyaan yang jelas dan minimal 2, maksimal 12 pilihan jawaban (satu per baris).'); return;
    }
    try {
      const code = 'custom-' + crypto.randomUUID().slice(0, 12);
      const { error } = await supabaseClient().from('screening_questions').insert({ code, question_text: question, choices, version: 1, is_active: true });
      if (error) throw error;
      await loadRemoteQuestionBank(supabaseClient());
      render(true);
      say('Pertanyaan baru berhasil ditambahkan.');
    } catch (error) { formError(form, null, error.message || 'Pertanyaan belum berhasil disimpan.'); }
  },
  async 'request-password-reset'(form, fields) {
    const email = normalizeContact(fields.get('email'));
    if (!/^\S+@\S+\.\S+$/.test(email)) { formError(form, 'email', 'Masukkan alamat email yang valid.'); return; }
    try {
      const redirectTo = window.location.origin + window.location.pathname + '#masuk/ubah-sandi';
      const { error } = await supabaseClient().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      render();
      say('Jika alamat terdaftar, tautan pemulihan akan dikirim ke email tersebut. Periksa kotak masuk dan folder spam.');
    } catch (error) { formError(form, 'email', error.message || 'Tautan pemulihan belum dapat dikirim.'); }
  },
  async 'save-new-password'(form, fields) {
    const password = String(fields.get('password') || '');
    if (password.length < 12 || password !== fields.get('confirm-password')) {
      formError(form, 'password', 'Kata sandi minimal 12 karakter dan kedua isian harus sama.'); return;
    }
    try {
      const { data: authData, error: sessionError } = await supabaseClient().auth.getUser();
      if (sessionError) throw sessionError;
      if (!authData?.user) throw new Error('Tautan pemulihan tidak valid atau sudah kedaluwarsa. Minta tautan baru.');
      const { error } = await supabaseClient().auth.updateUser({ password });
      if (error) throw error;
      await supabaseClient().auth.signOut();
      try { window.sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* Browser storage may be unavailable. */ }
      authProfileRole = '';
      navigate('masuk/orang-tua');
      say('Kata sandi berhasil diperbarui. Silakan masuk kembali.');
    } catch (error) { formError(form, 'password', error.message || 'Kata sandi belum berhasil diperbarui.'); }
  },
});

Object.assign(actions, {
  async 'refresh-stock'() {
    if (role !== 'kader') return;
    try {
      await loadRemoteStock(supabaseClient(), kaderAccount.locations);
      ui.stockMigrationError = '';
      render(true);
      say('Persediaan, transaksi, dan distribusi berhasil dimuat ulang.');
    } catch (error) { say(error.message || 'Data stok belum dapat dimuat. Periksa migrasi database dan koneksi.'); }
  },
  'edit-stock-lot'(button) {
    if (role !== 'kader') return;
    const lot = data.lots.find(item => item.id === button.dataset.lotId && staffLocations().some(place => place.id === item.location));
    if (!lot) { say('Barang tidak ditemukan atau bukan wilayah tugas akun ini.'); return; }
    const categoryOptions = options(stockCategories.map(value => [value, value]), lot.category);
    showDetails('Ubah data barang · ' + lot.item, `<form data-form="stock-edit" data-lot-id="${h(lot.id)}" class="stack">
      <div class="form-grid">
        <label class="field">Nama barang<input name="item" maxlength="120" value="${h(lot.item)}" required></label>
        <label class="field">Kategori<select name="category">${categoryOptions}</select></label>
        <label class="field">Nomor lot / batch<input name="lot-number" maxlength="80" value="${h(lot.lot)}" required></label>
        <label class="field">Satuan<input name="unit" maxlength="30" value="${h(lot.unit)}" required></label>
        <label class="field">Jenis barang<select name="stock-type"><option value="Habis pakai"${lot.kind !== 'Dikembalikan' ? ' selected' : ''}>Habis pakai</option><option value="Dikembalikan"${lot.kind === 'Dikembalikan' ? ' selected' : ''}>Dapat digunakan kembali</option></select></label>
        <label class="field">Batas minimum stok<input name="min-quantity" type="number" min="0" max="999999" step="1" value="${lot.min}" required></label>
        <label class="field">Tanggal kedaluwarsa<input name="expiry" type="date" value="${h(lot.expiry || '')}"></label>
      </div><label class="field">Catatan<textarea name="notes" rows="2" maxlength="500">${h(lot.notes || '')}</textarea></label>
      ${inlineError}<div class="actions">${submitButton('Simpan perubahan')}${action('Batal', 'close-dialog', 'secondary')}</div>
    </form>`, button);
  },
  async 'archive-stock-lot'(button) {
    const lot = data.lots.find(item => item.id === button.dataset.lotId && staffLocations().some(place => place.id === item.location));
    if (!lot || lot.count !== 0) { say('Lot hanya dapat diarsipkan setelah saldonya nol.'); return; }
    if (!window.confirm('Arsipkan ' + lot.item + ' · ' + lot.lot + '? Riwayat transaksi tetap tersimpan.')) return;
    try {
      const { error } = await supabaseClient().rpc('archive_posyandu_stock_lot', { p_stock_lot_id: lot.id });
      if (error) throw error;
      await loadRemoteStock(supabaseClient(), kaderAccount.locations);
      ui.stockTab = 'archive';
      render(true);
      say('Barang berhasil diarsipkan. Riwayat transaksi tidak dihapus.');
    } catch (error) { say(error.message || 'Barang belum berhasil diarsipkan.'); }
  },
  async 'restore-stock-lot'(button) {
    const lot = data.lots.find(item => item.id === button.dataset.lotId && item.active === false && staffLocations().some(place => place.id === item.location));
    if (!lot) { say('Barang arsip tidak ditemukan.'); return; }
    if (!window.confirm('Pulihkan ' + lot.item + ' · ' + lot.lot + ' ke daftar persediaan aktif?')) return;
    try {
      const { error } = await supabaseClient().rpc('restore_posyandu_stock_lot', { p_stock_lot_id: lot.id });
      if (error) throw error;
      await loadRemoteStock(supabaseClient(), kaderAccount.locations);
      ui.stockTab = 'inventory';
      ui.stockLocation = lot.location;
      render(true);
      say('Barang berhasil dipulihkan. Riwayat transaksi tetap tersimpan.');
    } catch (error) { say(error.message || 'Barang belum berhasil dipulihkan.'); }
  },
});

Object.assign(forms, {
  async 'stock-lot'(form, fields) {
    if (role !== 'kader') return;
    const location = fields.get('location');
    const item = String(fields.get('item') || '').trim();
    const category = String(fields.get('category') || 'Lainnya');
    const lotNumber = String(fields.get('lot-number') || '').trim() || 'UMUM';
    const unit = String(fields.get('unit') || '').trim();
    const stockType = fields.get('stock-type');
    const quantity = Number(fields.get('quantity'));
    const minQuantity = Number(fields.get('min-quantity'));
    const expiry = fields.get('expiry') || null;
    const notes = String(fields.get('notes') || '').trim();
    if (!staffLocations().some(place => place.id === location) || !item || !unit || !Number.isSafeInteger(quantity) || quantity < 0
      || !Number.isSafeInteger(minQuantity) || minQuantity < 0 || !['Habis pakai', 'Dikembalikan'].includes(stockType)
      || (expiry && expiry < today)) {
      formError(form, null, 'Periksa lokasi, nama barang, satuan, stok, batas minimum, jenis barang, dan tanggal kedaluwarsa.'); return;
    }
    try {
      if (window.posyanduSupabaseConfigured) {
        const { data: row, error } = await supabaseClient().rpc('create_posyandu_stock_lot', {
          p_location_id: location, p_item_name: item, p_category: category, p_lot_number: lotNumber,
          p_stock_type: stockType, p_unit: unit, p_quantity: quantity, p_min_quantity: minQuantity,
          p_expiry_date: expiry, p_notes: notes,
        });
        if (error) throw error;
        data.lots.unshift(mapRemoteStockLot(row));
        await loadRemoteStock(supabaseClient(), kaderAccount.locations);
      } else {
        const lot = { id: crypto.randomUUID(), location, item, category, lot: lotNumber, kind: stockType, unit, count: quantity, min: minQuantity, expiry: expiry || '', notes, active: true };
        data.lots.unshift(lot);
        if (quantity > 0) data.transactions.unshift({ id: crypto.randomUUID(), lotId: lot.id, item, lot: lotNumber, location, direction: 'Stok awal', amount: quantity, balanceAfter: quantity, reference: 'Stok awal', notes, createdAt: new Date().toISOString() });
      }
      ui.stockLocation = location;
      render(true);
      say('Barang dan lot persediaan berhasil ditambahkan.');
    } catch (error) { formError(form, null, error.message || 'Barang belum berhasil disimpan.'); }
  },
  async 'stock-edit'(form, fields) {
    if (role !== 'kader') return;
    const lot = data.lots.find(item => item.id === form.dataset.lotId && staffLocations().some(place => place.id === item.location));
    const item = String(fields.get('item') || '').trim();
    const category = String(fields.get('category') || 'Lainnya');
    const lotNumber = String(fields.get('lot-number') || '').trim() || 'UMUM';
    const unit = String(fields.get('unit') || '').trim();
    const stockType = fields.get('stock-type');
    const minQuantity = Number(fields.get('min-quantity'));
    const expiry = fields.get('expiry') || null;
    const notes = String(fields.get('notes') || '').trim();
    if (!lot || !item || !unit || !Number.isSafeInteger(minQuantity) || minQuantity < 0
      || !['Habis pakai', 'Dikembalikan'].includes(stockType) || (expiry && expiry < today)) {
      formError(form, null, 'Periksa kembali nama, satuan, jenis barang, batas minimum, dan tanggal kedaluwarsa.'); return;
    }
    try {
      const payload = { item_name: item, category, lot_number: lotNumber, unit, stock_type: stockType, min_quantity: minQuantity, expiry_date: expiry, notes, updated_at: new Date().toISOString() };
      if (window.posyanduSupabaseConfigured) {
        const { data: row, error } = await supabaseClient().from('posyandu_stock_lots').update(payload).eq('id', lot.id).eq('location_id', lot.location).select('*').single();
        if (error) throw error;
        const mapped = mapRemoteStockLot(row);
        data.lots = data.lots.map(entry => entry.id === mapped.id ? mapped : entry);
        document.querySelector('dialog[open]')?.close();
      } else {
        Object.assign(lot, { item, category, lot: lotNumber, unit, kind: stockType, min: minQuantity, expiry: expiry || '', notes });
        document.querySelector('dialog[open]')?.close();
      }
      render(true);
      say('Data barang berhasil diperbarui. Saldo dan riwayat transaksi tetap utuh.');
    } catch (error) { formError(form, null, error.message || 'Perubahan barang belum berhasil disimpan.'); }
  },
  async stock(form, fields) {
    if (role !== 'kader') return;
    const location = fields.get('location');
    const lotId = fields.get('lot');
    const amount = Number(fields.get('amount'));
    const direction = fields.get('direction');
    const reference = String(fields.get('reference') || '').trim();
    const notes = String(fields.get('notes') || '').trim();
    const lot = data.lots.find(item => item.id === lotId && item.location === location && item.active !== false);
    if (!lot || !staffLocations().some(place => place.id === location) || !Number.isSafeInteger(amount) || amount <= 0 || !['Masuk', 'Keluar'].includes(direction)) {
      formError(form, null, 'Pilih barang dan jenis transaksi serta isi jumlah yang valid.'); return;
    }
    if (direction === 'Keluar' && lot.count < amount) { formError(form, 'amount', 'Jumlah keluar melebihi saldo lot yang tersedia.'); return; }
    try {
      if (window.posyanduSupabaseConfigured) {
        const { data: row, error } = await supabaseClient().rpc('adjust_posyandu_stock', {
          p_stock_lot_id: lot.id, p_direction: direction, p_quantity: amount, p_reference_text: reference, p_notes: notes,
        });
        if (error) throw error;
        const mapped = mapRemoteStockLot(row);
        data.lots = data.lots.map(entry => entry.id === mapped.id ? mapped : entry);
        await loadRemoteStock(supabaseClient(), kaderAccount.locations);
      } else {
        lot.count += direction === 'Keluar' ? -amount : amount;
        data.transactions.unshift({ id: crypto.randomUUID(), lotId: lot.id, item: lot.item, lot: lot.lot, location, direction, amount, balanceAfter: lot.count, reference, notes, createdAt: new Date().toISOString() });
      }
      render(true);
      say('Transaksi ' + direction.toLowerCase() + ' berhasil dicatat dan saldo diperbarui.');
    } catch (error) { formError(form, null, error.message || 'Transaksi belum berhasil disimpan.'); }
  },
  async dispatch(form, fields) {
    if (role !== 'kader') return;
    const location = fields.get('location');
    const origin = fields.get('origin');
    const lotId = fields.get('lot');
    const date = fields.get('date');
    const issued = Number(fields.get('issued'));
    const used = Number(fields.get('used'));
    const returned = Number(fields.get('returned'));
    const notes = String(fields.get('notes') || '').trim();
    const lot = data.lots.find(item => item.id === lotId && item.location === origin && item.active !== false);
    if (!staffLocations().some(place => place.id === location) || !staffLocations().some(place => place.id === origin) || !lot || !date
      || ![issued, used, returned].every(Number.isSafeInteger) || issued < 1 || used < 0 || returned < 0) {
      formError(form, null, 'Lengkapi lokasi asal dan tujuan, barang, tanggal, serta jumlah barang.'); return;
    }
    if (issued > lot.count) { formError(form, 'issued', 'Jumlah dibawa melebihi saldo lot yang tersedia.'); return; }
    const reusable = lot.kind === 'Dikembalikan';
    if (used > issued || returned > issued || (!reusable && used + returned > issued)) {
      formError(form, 'returned', 'Jumlah pakai dan kembali melebihi barang yang dibawa. Periksa jenis barang.'); return;
    }
    const matchedEvents = data.events.filter(item => item.location === location && item.date === date && item.status !== 'Dibatalkan');
    const selectedEvent = matchedEvents.length === 1 ? matchedEvents[0] : null;
    try {
      if (window.posyanduSupabaseConfigured) {
        const { data: row, error } = await supabaseClient().rpc('dispatch_posyandu_stock', {
          p_stock_lot_id: lot.id, p_origin_location_id: origin, p_destination_location_id: location,
          p_service_date: date, p_event_id: selectedEvent?.id || null,
          p_quantity_issued: issued, p_quantity_used: used, p_quantity_returned: returned, p_notes: notes,
        });
        if (error) throw error;
        data.dispatches.unshift(mapRemoteStockDispatch(row));
        await loadRemoteStock(supabaseClient(), kaderAccount.locations);
      } else {
        lot.count -= issued - returned;
        data.dispatches.unshift({ id: crypto.randomUUID(), eventId: selectedEvent?.id || '', location, origin, date, item: lot.item, lot: lot.lot, expiry: lot.expiry, kind: lot.kind, unit: lot.unit, issued, used, returned, remaining: issued - returned - (reusable ? 0 : used), notes });
        if (issued - returned > 0) data.transactions.unshift({ id: crypto.randomUUID(), lotId: lot.id, item: lot.item, lot: lot.lot, location: origin, direction: 'Distribusi keluar', amount: issued - returned, balanceAfter: lot.count, reference: locationName(location), notes, createdAt: new Date().toISOString() });
      }
      ui.stockLocation = origin;
      render(true);
      say('Distribusi barang berhasil dicatat dan saldo lokasi asal diperbarui.');
    } catch (error) { formError(form, null, error.message || 'Distribusi belum berhasil disimpan.'); }
  },
});

for (const name of ['stock-lot', 'stock-edit', 'stock', 'dispatch']) mutatingForms.add(name);
mutatingActions.add('refresh-stock');
mutatingActions.add('archive-stock-lot');
mutatingActions.add('restore-stock-lot');
// Stock actions/forms persist directly to Supabase; do not reload the empty browser cache before them.
for (const name of ['refresh-stock', 'archive-stock-lot', 'restore-stock-lot']) mutatingActions.delete(name);

Object.assign(selectHandlers, {
  'directory-location': control => setFilter('directoryLocation', control.value, 'directory-location'),
  'screening-date': control => setFilter('screeningDate', control.value, 'screening-date'),
  'screening-location': control => setFilter('screeningLocation', control.value, 'screening-location'),
  'family-schedule-location': control => setFilter('familyScheduleLocation', control.value, 'family-schedule-location'),
  'vaccine-location': control => setFilter('vaccineLocation', control.value, 'vaccine-location'),
  'vaccine-source'(control) {
    const field = $('[data-facility]', control.closest('form'));
    field.hidden = control.value !== 'Fasilitas lain';
    $('input', field).required = !field.hidden;
  },
  'queue-location'(control) {
    ui.queueChild = control.closest('form').elements.child.value;
    ui.queueEvent = '';
    setFilter('queueLocation', control.value, 'queue-location');
  },
  'queue-event'(control) {
    ui.queueChild = control.closest('form').elements.child.value;
    setFilter('queueEvent', control.value, 'queue-event');
  },
  'queue-date': control => setFilter('queueDate', control.value, 'queue-date'),
  'queue-status': control => setFilter('queueStatus', control.value, 'queue-status'),
  'stock-location'(control) {
    ui.stockLocation = control.value;
    render();
  },
  'stock-page-location'(control) {
    ui.stockLocation = control.value;
    render();
    $('[data-change="stock-page-location"]')?.focus({ preventScroll: true });
  },
  'point-family': control => setFilter('pointFamily', control.value, 'point-family'),
  'news-location': control => setFilter('newsLocation', control.value, 'news-location'),
});
Object.assign(kaderPages, {
  peserta: participantsPage, keluarga: familiesPage, jadwal: schedulePage, poin: pointsPage, skrining: screeningPage, akun: adminAccountsPage, edukasi: educationPage,
  stok: stockPage, imunisasi: immunizationPage, antrean: queuePage, lokasi: directoryPage,
});
Object.assign(familyPages, {
  anggota: familyMembersPage, jadwal: schedulePage, notifikasi: () => schedulePage(true), poin: pointsPage, skrining: screeningPage,
  edukasi: educationPage, imunisasi: immunizationPage, antrean: queuePage, lokasi: directoryPage,
});

async function bootPosyandu() {
  const client = window.posyanduSupabase;
  if (client) {
    try {
      const { data: authData } = await client.auth.getSession();
      const authSession = authData?.session;
      if (authSession?.user?.id) {
        const lastActivity = Number(readStorage('sessionStorage', ACTIVITY_KEY) || 0);
        if (lastActivity && Date.now() - lastActivity >= 30 * 60 * 1000) {
          await client.auth.signOut();
          try { window.sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* Browser storage may be unavailable. */ }
          say('Sesi berakhir karena tidak ada aktivitas selama 30 menit. Silakan masuk kembali.');
          render();
          return;
        }
        if (!lastActivity) writeStorage('sessionStorage', ACTIVITY_KEY, String(Date.now()));
        const { data: profile, error: profileError } = await client.from('profiles').select('role,is_active').eq('id', authSession.user.id).maybeSingle();
        if (profileError) throw profileError;
        if (!profile) {
          await client.auth.signOut();
          try { window.sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* Browser storage may be unavailable. */ }
          say('Profil akun belum tersedia. Hubungi administrator Posyandu.');
          render();
          return;
        }
        if (profile.is_active === false) {
          await client.auth.signOut();
          try { window.sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* Browser storage may be unavailable. */ }
          say('Akun dinonaktifkan oleh administrator. Hubungi pengelola Posyandu.');
          render();
          return;
        }
        if (profile?.role === 'keluarga') {
          try {
            await fetchAndActivateRemoteFamily(client, authSession.user.id);
            return;
          } catch (error) {
            say(error.message || 'Akun ditemukan, tetapi data keluarga belum dapat dimuat.');
          }
        } else if (profile?.role === 'kader' || profile?.role === 'admin') {
          try {
            await fetchAndActivateRemoteStaff(client, authSession.user.id, profile.role);
            return;
          } catch (error) {
            say(error.message || 'Akun kader ditemukan, tetapi data penugasan belum dapat dimuat.');
          }
        }
      }
    } catch { /* Public pages remain available if Supabase cannot be reached. */ }
  }
  render();
}
bootPosyandu();
