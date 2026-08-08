/* ---------------- Supabase Credentials Setup ---------------- */
const SUPABASE_URL = "https://ypdzkmjdpjqjkhplnfgd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hHW0L04cexjhsUHLKu_QjA_o41djmit";

let supabaseClient;

// Safe Initialization
try {
  if (window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    document.getElementById('app').innerHTML = `<div style="padding:40px; text-align:center; color:red;"><h3>Failed to load Supabase SDK.</h3></div>`;
  }
} catch (e) {
  console.error("Initialization Error:", e);
}

/* ---------------- Config ---------------- */
const RESPONSIBILITIES = [
  "Obtaining Informed Consent", "Medical History & Physical Exam", "Eligibility Screening (I/E criteria)",
  "IP (Study Drug) Administration", "PK Blood Sample Collection", "Sample Processing, Labeling & Storage",
  "Vital Signs / Safety Monitoring", "AE / SAE Assessment & Reporting", "Source Document Completion",
  "CRF / eCRF Completion", "IP Accountability & Storage", "Randomization Code Access",
  "Bioanalytical Sample Analysis", "Protocol Deviation Reporting", "Data Management / Entry", "QA / QC Review"
];

const ROLES = [
  { id: "PI", label: "Principal Investigator", canCreateStudy: true, canDelegate: true, canApprove: true, readOnly: false },
  { id: "SUBI", label: "Sub-Investigator", canCreateStudy: false, canDelegate: false, canApprove: false, readOnly: false },
  { id: "CRC", label: "Clinical Research Coordinator", canCreateStudy: false, canDelegate: false, canApprove: false, readOnly: false },
  { id: "PHARM", label: "Pharmacist", canCreateStudy: false, canDelegate: false, canApprove: false, readOnly: false },
  { id: "NURSE", label: "Study Nurse", canCreateStudy: false, canDelegate: false, canApprove: false, readOnly: false },
  { id: "QA", label: "Quality Assurance", canCreateStudy: false, canDelegate: false, canApprove: false, readOnly: true },
  { id: "MONITOR", label: "Monitor", canCreateStudy: false, canDelegate: false, canApprove: false, readOnly: true },
  { id: "SPONSOR", label: "Sponsor", canCreateStudy: false, canDelegate: false, canApprove: false, readOnly: true },
  { id: "ADMIN", label: "Administrator", canCreateStudy: true, canDelegate: true, canApprove: true, readOnly: false },
];

function getRole(id) { return ROLES.find(r => r.id === id) || ROLES[2]; }

/* ---------------- Application State ---------------- */
let state = { studies: [], entries: [], auditLog: [] };
let currentUser = null;
let screen = "login";
let authMode = "login";
let activeStudyId = null;
let dashSearch = "";
let dashStatusFilter = "all";
let dashSort = "newest";
let auditOpen = false;

function nowIso() { return new Date().toISOString(); }
function fmtTime(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }); }
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : str; return d.innerHTML; }

/* ---------------- Database & Auth API Layer ---------------- */
async function loadAllData() {
  if (!supabaseClient) return;
  const appEl = document.getElementById('app');

  try {
    const { data: { session }, error: authErr } = await supabaseClient.auth.getSession();
    if (authErr) throw authErr;

    if (session && session.user) {
      const u = session.user;
      currentUser = {
        id: u.id,
        email: u.email,
        name: u.user_metadata?.full_name || u.email,
        roleId: u.user_metadata?.role_id || "CRC"
      };
      screen = "dashboard";
    } else {
      currentUser = null;
      screen = "login";
    }

    const { data: studies, error: errStudies } = await supabaseClient.from('studies').select('*');
    if (errStudies) throw errStudies;
    state.studies = studies || [];

    const { data: logs, error: errLogs } = await supabaseClient.from('audit_log').select('*').order('created_at', { ascending: false });
    if (!errLogs) state.auditLog = logs || [];

    render();
  } catch (e) {
    console.error("Database connection failure:", e);
    if (appEl) {
      appEl.innerHTML = `<div style="padding:40px; text-align:center; color:#A8402F;">
        <h3>Database Connection Issue</h3>
        <p>${e.message || 'Could not fetch data from Supabase.'}</p>
      </div>`;
    }
  }
}

async function loadStudyEntries(studyId) {
  const { data: entries, error } = await supabaseClient
    .from('delegation_entries')
    .select('*')
    .eq('study_id', studyId);

  if (error) console.error("Error loading entries:", error);
  else state.entries = entries || [];
}

async function logAudit(studyId, action, detail) {
  const role = currentUser ? getRole(currentUser.roleId) : null;
  const newLog = {
    study_id: studyId,
    user_name: currentUser ? currentUser.name : "Unknown",
    user_role: role ? role.label : "—",
    action: action,
    detail: detail
  };

  const { data, error } = await supabaseClient.from('audit_log').insert([newLog]).select();
  if (!error && data) state.auditLog.unshift(data[0]);
}

/* ---------------- UI Render Engines ---------------- */
function render() {
  const app = document.getElementById('app');
  if (!app) return;
  
  if (screen === 'login') { app.innerHTML = loginHtml(); bindLogin(); return; }
  if (screen === 'dashboard') { app.innerHTML = topbarHtml() + dashboardHtml(); bindTopbar(); bindDashboard(); return; }
  if (screen === 'study') { app.innerHTML = topbarHtml() + studyHtml(); bindTopbar(); bindStudy(); return; }
}

/* ---------------- Auth Module ---------------- */
function loginHtml() {
  const options = ROLES.map(r => `<option value="${r.id}">${r.label}</option>`).join('');
  const isReg = authMode === 'register';

  return `
  <div class="wrap">
    <div class="login-screen">
      <div class="kicker">Delegation of Authority System</div>
      <h1>${isReg ? 'Create Account' : 'Sign In'}</h1>
      <div class="sub">Clinical Bioequivalence Center Portal</div>
      
      <div class="auth-tabs">
        <button class="auth-tab ${!isReg ? 'active' : ''}" id="tab-login">Sign In</button>
        <button class="auth-tab ${isReg ? 'active' : ''}" id="tab-register">Register</button>
      </div>

      ${isReg ? `<div class="field" style="margin-bottom:14px;"><label>Full Name</label><input id="auth-name" placeholder="e.g. Dr. Mona Farid"></div>` : ''}
      
      <div class="field" style="margin-bottom:14px;"><label>Email Address</label><input id="auth-email" type="email" placeholder="name@center.com"></div>
      <div class="field" style="margin-bottom:14px;"><label>Password</label><input id="auth-pass" type="password" placeholder="••••••••"></div>
      
      ${isReg ? `<div class="field" style="margin-bottom:20px;"><label>Role</label><select id="auth-role">${options}</select></div>` : ''}

      <button class="btn" id="auth-submit" style="width:100%; margin-top:10px;">${isReg ? 'Register Account' : 'Sign In'}</button>
    </div>
  </div>`;
}

function bindLogin() {
  document.getElementById('tab-login')?.addEventListener('click', () => { authMode = 'login'; render(); });
  document.getElementById('tab-register')?.addEventListener('click', () => { authMode = 'register'; render(); });

  document.getElementById('auth-submit')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-pass').value.trim();

    if (!email || !password) { alert('Please enter both email and password.'); return; }

    if (authMode === 'register') {
      const name = document.getElementById('auth-name').value.trim();
      const roleId = document.getElementById('auth-role').value;
      if (!name) { alert('Full name is required.'); return; }

      const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: { full_name: name, role_id: roleId } }
      });

      if (error) {
        alert("Registration failed: " + error.message);
      } else {
        alert("Registration successful! You can now sign in.");
        authMode = 'login';
        render();
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) {
        alert("Sign in failed: " + error.message);
      } else {
        await loadAllData();
      }
    }
  });
}

/* ---------------- Topbar Module ---------------- */
function topbarHtml() {
  const role = getRole(currentUser.roleId);
  return `<div class="wrap" style="padding-bottom:0;">
    <div class="topbar">
      <div>
        <div class="kicker">Delegation of Authority System</div>
        <h1 style="font-size:22px;">Bioequivalence Center</h1>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="who">Signed in as <b>${escapeHtml(currentUser.name)}</b> (${escapeHtml(currentUser.email)})</div>
        <span class="role-badge">${role.label}</span>
        <button class="btn ghost small no-print" id="signOutBtn">Sign Out</button>
      </div>
    </div>
  </div>`;
}

function bindTopbar() {
  document.getElementById('signOutBtn')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    currentUser = null;
    screen = 'login';
    render();
  });
}

/* ---------------- Dashboard Module ---------------- */
function dashboardHtml() {
  const role = getRole(currentUser.roleId);
  let studies = state.studies.filter(s => {
    const q = dashSearch.toLowerCase();
    const matchQ = !q || [s.title, s.protocol, s.sponsor, s.pi].some(v => (v || '').toLowerCase().includes(q));
    const matchStatus = dashStatusFilter === 'all' || (s.status || 'Planning') === dashStatusFilter;
    return matchQ && matchStatus;
  });

  studies = studies.slice().sort((a, b) => dashSort === 'oldest'
    ? new Date(a.created_at || 0) - new Date(b.created_at || 0)
    : new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const cards = studies.map(s => `
    <div class="study-card" onclick="openStudy('${s.id}')">
      <div class="top-row">
        <span class="proto-chip">${escapeHtml(s.protocol || 'NO CODE')}</span>
        <span class="status-pill status-${statusClass(s.status)}">${escapeHtml(s.status || 'Planning')}</span>
      </div>
      <h3 style="margin-top:8px;">${escapeHtml(s.title)}</h3>
      <div class="meta">
        <div><b>Sponsor:</b> ${escapeHtml(s.sponsor || '—')}</div>
        <div><b>PI:</b> ${escapeHtml(s.pi || '—')}</div>
        ${s.site ? `<div><b>Site:</b> ${escapeHtml(s.site)}</div>` : ''}
        ${s.start_date ? `<div><b>Start:</b> ${fmtDate(s.start_date)}</div>` : ''}
      </div>
    </div>
  `).join('');

  return `
  <div class="wrap">
    <div class="section-head">
      <h2>Studies <span class="count">(${studies.length})</span></h2>
      <div class="toolbar no-print">
        ${role.canCreateStudy ? `<button class="btn" id="newStudyBtn">+ New Study</button>` : ''}
      </div>
    </div>
    <div class="dash-toolbar no-print">
      <input id="dashSearchInput" placeholder="Search by title, protocol, sponsor, or PI..." value="${escapeHtml(dashSearch)}">
      <select id="dashStatusInput">
        <option value="all">All statuses</option>
        <option value="Planning">Planning</option>
        <option value="Active">Active</option>
        <option value="Closed">Closed</option>
      </select>
      <select id="dashSortInput">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
    </div>
    ${studies.length === 0
      ? `<div class="empty-state">No studies found in Database. ${role.canCreateStudy ? 'Click "+ New Study" to add one.' : ''}</div>`
      : `<div class="study-grid">${cards}</div>`}
  </div>`;
}

function statusClass(status) {
  if (status === 'Active') return 'active';
  if (status === 'Closed') return 'inactive';
  return 'pending';
}

function bindDashboard() {
  const role = getRole(currentUser.roleId);
  document.getElementById('dashSearchInput')?.addEventListener('input', e => { dashSearch = e.target.value; render(); });
  if (document.getElementById('dashStatusInput')) {
    document.getElementById('dashStatusInput').value = dashStatusFilter;
    document.getElementById('dashStatusInput').addEventListener('change', e => { dashStatusFilter = e.target.value; render(); });
  }
  if (document.getElementById('dashSortInput')) {
    document.getElementById('dashSortInput').value = dashSort;
    document.getElementById('dashSortInput').addEventListener('change', e => { dashSort = e.target.value; render(); });
  }
  if (role.canCreateStudy) {
    document.getElementById('newStudyBtn')?.addEventListener('click', openNewStudyModal);
  }
}

function openNewStudyModal() {
  closeModal();
  const div = document.createElement('div'); div.id = 'modalRoot';
  document.body.appendChild(div);
  div.innerHTML = `
  <div class="overlay" id="ov-study">
    <div class="modal">
      <h3>New Study</h3>
      <div class="modal-sub">Add a study record to Database.</div>
      <div class="field"><label>Study Title</label><input id="ns-title" placeholder="e.g. BE Study of Drug X 100mg"></div>
      <div class="two-col">
        <div class="field"><label>Protocol Number</label><input id="ns-protocol" placeholder="e.g. BE-2026-014"></div>
        <div class="field"><label>Status</label>
          <select id="ns-status"><option>Planning</option><option>Active</option><option>Closed</option></select>
        </div>
      </div>
      <div class="two-col">
        <div class="field"><label>Sponsor / CRO</label><input id="ns-sponsor"></div>
        <div class="field"><label>Principal Investigator</label><input id="ns-pi"></div>
      </div>
      <div class="two-col">
        <div class="field"><label>Site / Facility</label><input id="ns-site"></div>
        <div class="field"><label>Start Date</label><input id="ns-start" type="date"></div>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="ns-cancel">Cancel</button>
        <button class="btn" id="ns-save">Add Study</button>
      </div>
    </div>
  </div>`;

  document.getElementById('ns-cancel').addEventListener('click', closeModal);
  document.getElementById('ns-save').addEventListener('click', async () => {
    const title = document.getElementById('ns-title').value.trim();
    if (!title) { alert('Study title is required.'); return; }

    const newStudy = {
      title,
      protocol: document.getElementById('ns-protocol').value.trim(),
      status: document.getElementById('ns-status').value,
      sponsor: document.getElementById('ns-sponsor').value.trim(),
      pi: document.getElementById('ns-pi').value.trim(),
      site: document.getElementById('ns-site').value.trim(),
      start_date: document.getElementById('ns-start').value || null
    };

    const { data, error } = await supabaseClient.from('studies').insert([newStudy]).select();
    if (error) {
      alert("Database error: " + error.message);
    } else {
      state.studies.push(data[0]);
      await logAudit(data[0].id, 'Study created', `${title} added by ${currentUser.name}`);
      closeModal();
      render();
    }
  });
}

async function openStudy(id) {
  activeStudyId = id;
  await loadStudyEntries(id);
  screen = 'study';
  auditOpen = false;
  render();
}

function backToDashboard() { activeStudyId = null; screen = 'dashboard'; render(); }
function closeModal() { document.getElementById('modalRoot')?.remove(); }

/* ---------------- Study Details View ---------------- */
function currentStudy() { return state.studies.find(s => s.id === activeStudyId); }

function computeStatus(entry) {
  if (entry.deactivated) return 'inactive';
  if (entry.end_date && new Date(entry.end_date) < new Date()) return 'inactive';
  if (entry.signature_name && entry.pi_approval_name) return 'active';
  return 'pending';
}

function studyHtml() {
  const study = currentStudy();
  const role = getRole(currentUser.roleId);
  if (!study) return `<div class="wrap"><div class="empty-state">Study not found.</div></div>`;

  const rows = state.entries.length === 0
    ? `<tr><td colspan="9"><div class="empty-state" style="border:none;">No team members delegated yet.</div></td></tr>`
    : state.entries.map(entry => {
      const status = computeStatus(entry);
      const statusLabel = status === 'active' ? 'Active' : status === 'pending' ? 'Pending Signatures' : 'Inactive';
      const isSelf = currentUser.name.trim().toLowerCase() === entry.name.trim().toLowerCase();

      const sigHtml = entry.signature_name
        ? `<div class="sig-block"><span class="sig-stamp">SIGNED</span><br>${escapeHtml(entry.signature_name)}<span class="sig-time">${fmtTime(entry.signature_timestamp)}</span></div>`
        : `<span class="sig-empty">Awaiting staff signature</span>`;

      const piHtml = entry.pi_approval_name
        ? `<div class="sig-block"><span class="sig-stamp">PI APPROVED</span><br>${escapeHtml(entry.pi_approval_name)}<span class="sig-time">${fmtTime(entry.pi_approval_timestamp)}</span></div>`
        : `<span class="sig-empty">Awaiting PI approval</span>`;

      const canStaffSign = !entry.signature_name && !role.readOnly && isSelf;
      const canPiApprove = entry.signature_name && !entry.pi_approval_name && role.canApprove;
      const canEnd = !entry.deactivated && role.canDelegate;

      let respList = [];
      if (Array.isArray(entry.responsibilities)) {
        respList = entry.responsibilities;
      } else if (typeof entry.responsibilities === 'string') {
        try { respList = JSON.parse(entry.responsibilities); } catch(e) { respList = [entry.responsibilities]; }
      }

      return `<tr>
        <td data-label="Name" class="name-cell">${escapeHtml(entry.name)}</td>
        <td data-label="Role" class="role-cell">${escapeHtml(entry.role)}</td>
        <td data-label="Delegated Tasks"><div class="tags">${respList.map(r => `<span class="tag">${escapeHtml(r)}</span>`).join('')}</div></td>
        <td data-label="Period">${fmtDate(entry.start_date)} → ${entry.end_date ? fmtDate(entry.end_date) : 'ongoing'}</td>
        <td data-label="Training / CV">${entry.training_date ? 'Trained ' + fmtDate(entry.training_date) : '—'}<br>${entry.cv_on_file ? 'CV on file' : 'CV pending'}</td>
        <td data-label="Staff Signature">${sigHtml}</td>
        <td data-label="PI Approval">${piHtml}</td>
        <td data-label="Status"><span class="status-pill status-${status}">${statusLabel}</span></td>
        <td data-label="Actions" class="no-print">
          <div class="row-actions">
            ${canStaffSign ? `<button class="btn ghost small" onclick="beginSign('${entry.id}','staff')">Sign (self)</button>` : ''}
            ${canPiApprove ? `<button class="btn ghost small" onclick="beginSign('${entry.id}','pi')">PI approve</button>` : ''}
            ${canEnd ? `<button class="btn ghost small" onclick="endDelegation('${entry.id}')">End delegation</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

  const studyAudit = state.auditLog.filter(a => a.study_id === activeStudyId);
  const auditHtml = studyAudit.length === 0
    ? `<li>No changes recorded yet.</li>`
    : studyAudit.map(a => `<li>${fmtTime(a.created_at)} — <b>${escapeHtml(a.user_name)}</b> (${escapeHtml(a.user_role)}): ${escapeHtml(a.action)} ${escapeHtml(a.detail || '')}</li>`).join('');

  return `
  <div class="wrap">
    <div class="study-header">
      <button class="back-link no-print" onclick="backToDashboard()">← All Studies</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <h1>${escapeHtml(study.title)}</h1>
        <span class="status-pill status-${statusClass(study.status)}">${escapeHtml(study.status || 'Planning')}</span>
      </div>
      <div class="grid">
        <div><b>${escapeHtml(study.protocol || '—')}</b>Protocol Number</div>
        <div><b>${escapeHtml(study.sponsor || '—')}</b>Sponsor / CRO</div>
        <div><b>${escapeHtml(study.pi || '—')}</b>Principal Investigator</div>
        <div><b>${escapeHtml(study.site || '—')}</b>Site</div>
      </div>
    </div>

    <div class="section-head">
      <h2>Study Team Roster <span class="count">(${state.entries.length})</span></h2>
      <div class="toolbar no-print">
        <button class="btn secondary" onclick="window.print()">Print / Export</button>
        ${role.canDelegate ? `<button class="btn" onclick="openAddModal()">+ Delegate Team Member</button>` : ''}
      </div>
    </div>

    <table class="roster">
      <thead><tr>
        <th>Name</th><th>Role</th><th>Delegated Tasks</th><th>Period</th>
        <th>Training / CV</th><th>Staff Signature</th><th>PI Approval</th><th>Status</th><th class="no-print">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="section-head"><h2>Audit Trail</h2></div>
    <div class="audit-panel">
      <button class="audit-toggle no-print" id="auditToggleBtn">${auditOpen ? 'Hide' : 'Show'} full change history (${studyAudit.length})</button>
      <ul class="audit-list" id="auditListEl" style="display:${auditOpen ? 'block' : 'none'};">${auditHtml}</ul>
    </div>
  </div>`;
}

function bindStudy() {
  document.getElementById('auditToggleBtn')?.addEventListener('click', () => {
    auditOpen = !auditOpen;
    render();
  });
}

function openAddModal() {
  closeModal();
  const div = document.createElement('div'); div.id = 'modalRoot';
  document.body.appendChild(div);
  div.innerHTML = `
  <div class="overlay" id="ov-add">
    <div class="modal">
      <h3>Delegate Team Member</h3>
      <div class="modal-sub">Assign GCP responsibilities to staff members.</div>
      <div class="two-col">
        <div class="field"><label>Full Name</label><input id="m-name" placeholder="e.g. Dr. Mona Farid"></div>
        <div class="field"><label>Role / Position</label><input id="m-role" placeholder="e.g. Sub-Investigator"></div>
      </div>
      <div class="field"><label>Delegated Responsibilities</label>
        <div class="checklist">${RESPONSIBILITIES.map((r, i) => `<label><input type="checkbox" value="${escapeHtml(r)}" id="resp-${i}"> ${r}</label>`).join('')}</div>
      </div>
      <div class="two-col">
        <div class="field"><label>Delegation Start Date</label><input id="m-start" type="date"></div>
        <div class="field"><label>GCP / Training Date</label><input id="m-training" type="date"></div>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="add-cancel">Cancel</button>
        <button class="btn" id="add-save">Add to Roster</button>
      </div>
    </div>
  </div>`;

  document.getElementById('add-cancel').addEventListener('click', closeModal);
  document.getElementById('add-save').addEventListener('click', async () => {
    const name = document.getElementById('m-name').value.trim();
    const roleTxt = document.getElementById('m-role').value.trim();
    if (!name || !roleTxt) { alert('Name and role are required.'); return; }
    const responsibilities = RESPONSIBILITIES.filter((r, i) => document.getElementById(`resp-${i}`).checked);
    if (responsibilities.length === 0) { alert('Select at least one delegated responsibility.'); return; }

    const entry = {
      study_id: activeStudyId,
      name,
      role: roleTxt,
      responsibilities,
      start_date: document.getElementById('m-start').value || new Date().toISOString().slice(0, 10),
      training_date: document.getElementById('m-training').value || null,
      cv_on_file: true,
      deactivated: false
    };

    const { data, error } = await supabaseClient.from('delegation_entries').insert([entry]).select();
    if (error) {
      alert("Database error: " + error.message);
    } else {
      state.entries.push(data[0]);
      await logAudit(activeStudyId, 'Team member delegated', `${name} (${roleTxt})`);
      closeModal();
      render();
    }
  });
}

async function beginSign(entryId, kind) {
  const isPi = kind === 'pi';
  const sigName = prompt(`Type full name to confirm ${isPi ? 'PI approval' : 'signature'}:`, currentUser.name);

  if (sigName) {
    const updateData = isPi ? {
      pi_approval_name: sigName,
      pi_approval_timestamp: nowIso()
    } : {
      signature_name: sigName,
      signature_timestamp: nowIso()
    };

    const { error } = await supabaseClient
      .from('delegation_entries')
      .update(updateData)
      .eq('id', entryId);

    if (error) {
      alert("Database error: " + error.message);
    } else {
      await loadStudyEntries(activeStudyId);
      await logAudit(activeStudyId, isPi ? 'PI approval recorded' : 'Staff signature recorded', `By ${sigName}`);
      render();
    }
  }
}

async function endDelegation(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  if (!confirm(`End delegation for ${entry.name}?`)) return;

  const endDate = new Date().toISOString().slice(0, 10);
  const { error } = await supabaseClient
    .from('delegation_entries')
    .update({ deactivated: true, end_date: endDate })
    .eq('id', entryId);

  if (error) {
    alert("Database error: " + error.message);
  } else {
    await loadStudyEntries(activeStudyId);
    await logAudit(activeStudyId, 'Delegation ended', `${entry.name} deactivated`);
    render();
  }
}

// Initial Boot Loader
loadAllData();