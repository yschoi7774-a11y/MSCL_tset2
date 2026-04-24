// ── 로그인 ────────────────────────────────────────
async function doLogin() {
  const id = document.getElementById('loginId').value;
  const pw = document.getElementById('loginPw').value;
  if (id === 'mothersmile' && pw === '0544') {
    sessionStorage.setItem('auth', '1');
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('headerSub').textContent = `${state.year}년 연차 현황`;
    await loadData();
    renderSidebar();
    renderMain();
  } else {
    document.getElementById('loginError').classList.remove('hidden');
    document.getElementById('loginPw').value = '';
    document.getElementById('loginPw').focus();
  }
}

// ── 상태 ──────────────────────────────────────────
const state = {
  employees: [],
  allocations: [],
  usages: [],
  compLeaves: [],
  selectedId: null,
  year: new Date().getFullYear(),
  tab: 'usages',
  view: 'employees',
  sidebarSort: 'name',
  adminFilter: {
    year: new Date().getFullYear(),
    month: 0,
    department: '',
  },
};

// ── API ──────────────────────────────────────────
const api = {
  async get(url) {
    return (await fetch(url)).json();
  },
  async post(url, body) {
    return (await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })).json();
  },
  async put(url, body) {
    return (await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })).json();
  },
  async del(url) {
    return (await fetch(url, { method: 'DELETE' })).json();
  },
};

async function loadData() {
  [state.employees, state.allocations, state.usages, state.compLeaves] = await Promise.all([
    api.get('/api/employees'),
    api.get('/api/allocations'),
    api.get('/api/usages'),
    api.get('/api/comp-leaves'),
  ]);
}

// ── 유틸 ──────────────────────────────────────────
// 사용 내역이 year/month 필터와 겹치는지 확인 (종료일 기준 월 포함)
function overlapsMonth(u, year, month) {
  const start = u.startDate || '';
  const end = u.endDate || start;
  if (!start) return false;
  if (year && month) {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`;
    return start <= monthEnd && end >= monthStart;
  }
  if (year) return start.startsWith(String(year)) || end.startsWith(String(year));
  if (month) {
    return Number(start.slice(5, 7)) === month || Number(end.slice(5, 7)) === month ||
      (start.slice(5, 7) < String(month).padStart(2, '0') && end.slice(5, 7) > String(month).padStart(2, '0'));
  }
  return true;
}

function fmt(d) {
  if (!d) return '-';
  return d.slice(0, 10).replace(/-/g, '.');
}

function servicePeriod(joinDate) {
  const diff = Date.now() - new Date(joinDate);
  const years = Math.floor(diff / (365.25 * 86400000));
  const months = Math.floor(diff / (30.5 * 86400000)) % 12;
  if (years === 0) return `${months}개월`;
  return `${years}년 ${months}개월`;
}

function typeBadge(type) {
  const cls = {
    '연차': 'badge-annual',
    '오전반차': 'badge-half',
    '오후반차': 'badge-half',
    '병가': 'badge-sick',
    '특별휴가': 'badge-special',
    '대체휴가': 'badge-comp',
    '관리자조정': 'badge-admin',
  };
  return `<span class="badge ${cls[type] || 'badge-annual'}">${type}</span>`;
}

function addYears(dateStr, n) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr, n) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

const SCHEDULE_POINTS = [
  { months: 6,  days: 10 },
  { months: 18, days: 11 },
  { months: 30, days: 12 },
  { months: 42, days: 14 },
  { months: 54, days: 16 },
  { months: 66, days: 18 },
];
for (let m = 78; m <= 78 + 12 * 30; m += 12) SCHEDULE_POINTS.push({ months: m, days: 20 });

function getSchedule(joinDate) {
  return SCHEDULE_POINTS.map(s => {
    const date = addMonths(joinDate, s.months);
    return { ...s, date, expiryDate: addYears(date, 2) };
  });
}

function getNextAlloc(joinDate) {
  const today = new Date().toISOString().slice(0, 10);
  return getSchedule(joinDate).find(s => s.date > today);
}

function daysFromNow(dateStr) {
  return Math.ceil((new Date(dateStr) - Date.now()) / 86400000);
}

// 만료일 계산 (없으면 발생일 + 2년)
function expiryOf(alloc) {
  return alloc.expiryDate || addYears(alloc.generatedDate, 2);
}

// 만료까지 남은 일수
function daysUntilExpiry(expiryDate) {
  return Math.ceil((new Date(expiryDate) - Date.now()) / 86400000);
}

const COMP_TYPES = ['대체휴가', '특별휴가'];

// 잔여 연차 = 유효 발생 합계 - 전체 사용 합계 (신청 즉시 반영)
function calcValidRemaining(allocs, usages) {
  const today = new Date().toISOString().slice(0, 10);
  const totalValid = allocs
    .filter(a => expiryOf(a) >= today)
    .reduce((s, a) => s + (Number(a.totalDays) || 0), 0);
  const totalUsed = usages
    .filter(u => !COMP_TYPES.includes(u.type))
    .reduce((s, u) => s + (Number(u.days) || 0), 0);
  return Math.max(0, totalValid - totalUsed);
}

function getSummary() {
  if (!state.selectedId) return null;
  const today = new Date().toISOString().slice(0, 10);

  const allAllocs = state.allocations
    .filter(a => a.employeeId === state.selectedId)
    .map(a => ({ ...a, expiryDate: expiryOf(a) }));
  const allUsages = state.usages.filter(u => u.employeeId === state.selectedId);

  const annualAllocs = allAllocs.filter(a => !a.type || a.type === '연차' || a.type === '관리자조정');
  const specialAllocs = allAllocs.filter(a => a.type === '특별휴가');
  const specialUsages = allUsages.filter(u => u.type === '특별휴가');

  const totalValidAllocated = annualAllocs
    .filter(a => a.expiryDate >= today)
    .reduce((s, a) => s + (Number(a.totalDays) || 0), 0);
  const totalUsed = allUsages
    .filter(u => !COMP_TYPES.includes(u.type))
    .reduce((s, u) => s + (Number(u.days) || 0), 0);
  const validRemaining = calcValidRemaining(annualAllocs, allUsages);

  const specialTotal = specialAllocs.reduce((s, a) => s + (Number(a.totalDays) || 0), 0);
  const specialUsed  = specialUsages.reduce((s, u) => s + (Number(u.days) || 0), 0);
  const specialRemaining = specialTotal - specialUsed;

  // 연도별 상세 (탭 테이블용)
  const yearAllocs = allAllocs.filter(a => {
    if (a.type === '특별휴가') return (a.year || '') == state.year;
    return (a.generatedDate || '').startsWith(String(state.year));
  });
  const yearUsages = allUsages.filter(u =>
    (u.startDate || '').startsWith(String(state.year))
  );
  const yearAdminAdj = allUsages.filter(u =>
    u.type === '관리자조정' && (u.startDate || '').startsWith(String(state.year))
  );

  const empCompLeaves = state.compLeaves.filter(c => c.employeeId === state.selectedId);
  return { totalValidAllocated, totalUsed, validRemaining, allocs: yearAllocs, usages: yearUsages, adminAdj: yearAdminAdj, compLeaves: empCompLeaves, specialTotal, specialUsed, specialRemaining };
}

// ── 사이드바 렌더 ──────────────────────────────────
const POSITION_ORDER = ['이사', '부장', '차장', '과장', '팀장', '팀장보', '대리', '주임', '사원', ''];

function setSidebarSort(sort) {
  state.sidebarSort = sort;
  renderSidebar();
}

function sortEmployees(list) {
  const ko = (a, b) => a.localeCompare(b, 'ko');
  if (state.sidebarSort === 'dept') {
    return [...list].sort((a, b) =>
      ko(a.department || '', b.department || '') || ko(a.name, b.name)
    );
  }
  if (state.sidebarSort === 'position') {
    return [...list].sort((a, b) => {
      const ai = POSITION_ORDER.indexOf(a.position || '');
      const bi = POSITION_ORDER.indexOf(b.position || '');
      const pa = ai === -1 ? 99 : ai;
      const pb = bi === -1 ? 99 : bi;
      return pa - pb || ko(a.name, b.name);
    });
  }
  if (state.sidebarSort === 'joinDate') {
    return [...list].sort((a, b) => (a.joinDate || '').localeCompare(b.joinDate || ''));
  }
  // 기본: 가나다
  return [...list].sort((a, b) => ko(a.name, b.name));
}

function renderSidebar() {
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filtered = state.employees.filter(e =>
    e.name.includes(search) || (e.department || '').includes(search)
  );

  // 정렬 버튼 렌더
  const sorts = [
    { key: 'name',     label: '가나다' },
    { key: 'dept',     label: '부서' },
    { key: 'position', label: '직급' },
    { key: 'joinDate', label: '입사일' },
  ];
  document.getElementById('sortBar').innerHTML = sorts.map(s => `
    <button class="sort-btn ${state.sidebarSort === s.key ? 'active' : ''}"
            onclick="setSidebarSort('${s.key}')">${s.label}</button>
  `).join('');

  if (!filtered.length) {
    document.getElementById('employeeList').innerHTML =
      '<p style="padding:16px;color:#94A3B8;font-size:0.83rem;text-align:center;">직원이 없습니다.</p>';
    return;
  }

  const sorted = sortEmployees(filtered);

  document.getElementById('employeeList').innerHTML = sorted.map(emp => {
    let divider = '';
    const sub = state.sidebarSort === 'joinDate'
      ? fmt(emp.joinDate)
      : [emp.department, emp.position].filter(Boolean).join(' · ');

    return `${divider}
      <div class="employee-card ${state.selectedId === emp.id ? 'active' : ''}"
           onclick="selectEmployee(${emp.id})">
        <div class="emp-name">${emp.name}</div>
        ${sub ? `<div class="emp-meta">${sub}</div>` : ''}
      </div>`;
  }).join('');
}

// ── 메인 패널 렌더 ────────────────────────────────
function renderMain() {
  const panel = document.getElementById('mainPanel');
  if (!state.selectedId) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>좌측에서 직원을 선택하거나<br>새 직원을 추가하세요.</p></div>`;
    return;
  }

  const emp = state.employees.find(e => e.id === state.selectedId);
  if (!emp) return;

  const s = getSummary();
  const curYear = new Date().getFullYear();
  const yearOpts = [curYear - 2, curYear - 1, curYear, curYear + 1]
    .map(y => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}년</option>`).join('');

  const remainCard = s.validRemaining <= 0 ? 'card-remain-empty' : s.validRemaining <= 3 ? 'card-remain-warn' : 'card-remain';
  const remainSub  = s.validRemaining <= 0
    ? (s.totalValidAllocated === 0 ? '연차 발생 전' : '⚠️ 연차 소진')
    : s.validRemaining <= 3 ? '⚠️' : '정상 (유효기간 내)';
  const meta = [
    `입사일: ${fmt(emp.joinDate)}`,
    `근속: ${servicePeriod(emp.joinDate)}`,
    emp.department,
    emp.position,
  ].filter(Boolean).join('　|　');

  const next = getNextAlloc(emp.joinDate);
  const nextDays = next ? daysFromNow(next.date) : null;
  const nextLabel = next
    ? `<span class="next-alloc-badge">다음 발생 예정: ${fmt(next.date)} (${nextDays}일 후) · ${next.days}일</span>`
    : `<span class="next-alloc-badge done">최대 발생 단계 도달 (20일)</span>`;

  panel.innerHTML = `
    <div class="emp-detail-header">
      <div>
        <div class="emp-detail-name">${emp.name}</div>
        <div class="emp-detail-meta">${meta}</div>
        <div class="emp-detail-meta" style="margin-top:6px;">${nextLabel}</div>
        ${emp.memo ? `<div class="emp-detail-meta" style="margin-top:3px;color:#94A3B8;">${emp.memo}</div>` : ''}
      </div>
      <div class="emp-detail-actions">
        <button class="btn btn-outline btn-sm" onclick="showEmployeeModal(${emp.id})">✏️ 수정</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${emp.id})">🗑 삭제</button>
      </div>
    </div>

    <div class="summary-cards">
      <div class="summary-card card-allocated">
        <div class="summary-card-label">유효 발생 연차</div>
        <div class="summary-card-value">${s.totalValidAllocated}<span>일</span></div>
        <div class="summary-card-sub">만료되지 않은 발생 합계</div>
      </div>
      <div class="summary-card card-used">
        <div class="summary-card-label">총 사용 연차</div>
        <div class="summary-card-value">${s.totalUsed}<span>일</span></div>
        <div class="summary-card-sub">전체 사용 합계</div>
      </div>
      <div class="summary-card ${remainCard}">
        <div class="summary-card-label">잔여 연차
          <button class="btn-admin-adjust" onclick="showAdjustModal(${emp.id}, '${emp.name}', ${s.validRemaining})" title="관리자 수정">✏️</button>
        </div>
        <div class="summary-card-value">${s.validRemaining}<span>일</span></div>
        <div class="summary-card-sub">${remainSub}</div>
      </div>
      <div class="summary-card card-special">
        <div class="summary-card-label">특별휴가</div>
        <div class="summary-card-value">${s.specialRemaining}<span>일</span></div>
        <div class="summary-card-sub">발생 ${s.specialTotal}일 · 사용 ${s.specialUsed}일</div>
      </div>
      <div class="summary-card card-comp-leave" onclick="switchTab('comp')" style="cursor:pointer;">
        <div class="summary-card-label">대체휴가</div>
        <div class="summary-card-value">${s.compLeaves.filter(c => !c.used).length}<span>건</span></div>
        <div class="summary-card-sub">미사용 · 전체 ${s.compLeaves.length}건</div>
      </div>
    </div>

    ${renderSalaryNotice(emp.id)}

    <div class="year-bar">
      <label>상세 조회 연도</label>
      <select onchange="changeYear(this.value)">${yearOpts}</select>
      <span style="font-size:0.8rem;color:#94A3B8;">※ 아래 내역은 선택 연도 기준</span>
    </div>

    <div class="tabs">
      <div class="tab-header">
        <button class="tab-btn ${state.tab === 'usages' ? 'active' : ''}"
                onclick="switchTab('usages')">사용 내역 (${s.usages.length})</button>
        <button class="tab-btn ${state.tab === 'allocs' ? 'active' : ''}"
                onclick="switchTab('allocs')">발생 내역 (${s.allocs.length + s.adminAdj.length})</button>
        <button class="tab-btn ${state.tab === 'comp' ? 'active' : ''}"
                onclick="switchTab('comp')">대체휴가 (${s.compLeaves.filter(c => !c.used).length}건 미사용)</button>
      </div>
      <div class="tab-content">
        <div class="tab-pane ${state.tab === 'usages' ? 'active' : ''}">
          <div class="section-header">
            <h3>연차 사용 내역</h3>
            <button class="btn btn-success btn-sm" onclick="showUsageModal()">+ 사용 등록</button>
          </div>
          ${renderUsagesTable(s.usages)}
        </div>
        <div class="tab-pane ${state.tab === 'allocs' ? 'active' : ''}">
          <div class="section-header">
            <h3>발생 내역</h3>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-success btn-sm" onclick="autoAllocate()">⚡ 연차 자동 생성</button>
              <button class="btn btn-primary btn-sm" onclick="showAllocModal()">+ 직접 등록</button>
            </div>
          </div>
          ${renderAllocsTable(s.allocs, s.adminAdj)}
        </div>
        <div class="tab-pane ${state.tab === 'comp' ? 'active' : ''}">
          ${renderCompLeavesTab(s.compLeaves)}
        </div>
      </div>
    </div>
  `;
}

function renderSalaryNotice(employeeId) {
  const pending = state.usages.filter(u =>
    u.employeeId === employeeId &&
    u.deductionType === 'salary' &&
    !u.salaryProcessed
  );
  if (!pending.length) return '';

  const totalDays = pending.reduce((s, u) => s + (Number(u.excessDays) || 0), 0);
  const items = pending.map(u =>
    `${fmt(u.startDate)} · ${u.excessDays}일`
  ).join('，　');

  return `
    <div class="salary-notice">
      <div class="salary-notice-left">
        <div class="salary-notice-title">💰 급여 공제 반영 필요</div>
        <div class="salary-notice-body">
          초과 사용 <strong>${totalDays}일</strong>을 급여 산정 시 공제해야 합니다.<br>
          <span class="salary-notice-items">${items}</span>
        </div>
      </div>
      <button class="btn btn-sm salary-notice-btn" onclick="markSalaryProcessed(${employeeId})">
        급여 반영 완료
      </button>
    </div>`;
}

async function markSalaryProcessed(employeeId) {
  await api.post(`/api/employees/${employeeId}/salary-processed`, {});
  await loadData();
  renderMain();
}

function deductionBadge(u) {
  if (!u.deductionType) return '';
  if (u.deductionType === 'salary')
    return `<span class="badge badge-deduct-salary">급여공제 ${u.excessDays}일</span>`;
  if (u.deductionType === 'nextAlloc')
    return `<span class="badge badge-deduct-next">선공제 ${u.excessDays}일</span>`;
  return '';
}

function renderUsagesTable(usages) {
  usages = usages.filter(u => u.type !== '관리자조정');
  if (!usages.length) return '<p class="empty-table">사용 내역이 없습니다.</p>';
  const rows = [...usages]
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
    .map(u => `
      <tr>
        <td>${fmt(u.startDate)}</td>
        <td>${fmt(u.endDate || u.startDate)}</td>
        <td><strong>${u.days}일</strong> ${deductionBadge(u)}</td>
        <td>${typeBadge(u.type)}</td>
        <td class="col-reason"><div class="reason-text">${u.reason || '-'}</div></td>
        <td class="text-muted">${u.registeredAt ? u.registeredAt.slice(0, 10) : '-'}</td>
        <td>
          <div class="actions">
            <button class="btn btn-outline btn-sm" onclick="showUsageModal(${u.id})">수정</button>
            <button class="btn btn-danger btn-sm" onclick="deleteUsage(${u.id})">삭제</button>
          </div>
        </td>
      </tr>`).join('');
  return `
    <table class="data-table">
      <thead><tr>
        <th>시작일</th><th>종료일</th><th>일수</th><th>구분</th><th>사유</th><th>신청일</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAllocsTable(allocs, adminAdj = []) {
  if (!allocs.length && !adminAdj.length) return '<p class="empty-table">발생 내역이 없습니다.</p>';
  const today = new Date().toISOString().slice(0, 10);

  const allocRows = [...allocs]
    .sort((a, b) => (b.generatedDate || '').localeCompare(a.generatedDate || ''))
    .map(a => {
      const isSpecial = a.type === '특별휴가';
      const expiry = isSpecial ? null : expiryOf(a);
      const dLeft = expiry ? daysUntilExpiry(expiry) : null;
      const isExpired = expiry ? expiry < today : false;
      const expirySoon = expiry && !isExpired && dLeft <= 90;
      const expiryLabel = isExpired
        ? `<span class="expiry-tag expired">만료</span>`
        : expirySoon
        ? `<span class="expiry-tag soon">${dLeft}일 후 만료</span>`
        : '';
      const dateCell = isSpecial ? `${a.year}년` : fmt(a.generatedDate);
      const expiryCell = isSpecial ? '-' : `<span class="${isExpired ? 'expiry-expired' : expirySoon ? 'expiry-soon' : ''}">${fmt(expiry)} ${expiryLabel}</span>`;

      return `
        <tr class="${isExpired ? 'row-expired' : ''}">
          <td>${typeBadge(a.type || '연차')}</td>
          <td>${dateCell}</td>
          <td>${isSpecial ? '-' : a.legalDays + '일'}</td>
          <td>${isSpecial ? '-' : (a.additionalDays > 0 ? `<span style="color:#10B981;font-weight:700;">+${a.additionalDays}일</span>` : '-')}</td>
          <td><strong>${a.totalDays}일</strong></td>
          <td>${expiryCell}</td>
          <td>${a.note || '-'}</td>
          <td>
            <div class="actions">
              <button class="btn btn-outline btn-sm" onclick="showAllocModal(${a.id})">수정</button>
              <button class="btn btn-danger btn-sm" onclick="deleteAlloc(${a.id})">삭제</button>
            </div>
          </td>
        </tr>`;
    }).join('');

  const adjRows = [...adminAdj]
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
    .map(u => {
      const sign = u.days > 0 ? '-' : '+';
      const absDays = Math.abs(u.days);
      return `
        <tr>
          <td>${typeBadge('관리자조정')}</td>
          <td>${fmt(u.startDate)}</td>
          <td>-</td>
          <td>-</td>
          <td><strong style="color:${u.days > 0 ? '#EF4444' : '#10B981'}">${sign}${absDays}일</strong></td>
          <td>-</td>
          <td>${u.reason || '-'}</td>
          <td>
            <div class="actions">
              <button class="btn btn-danger btn-sm" onclick="deleteUsage(${u.id})">삭제</button>
            </div>
          </td>
        </tr>`;
    }).join('');

  return `
    <table class="data-table">
      <thead><tr>
        <th>유형</th><th>발생일</th><th>법정</th><th>추가</th><th>합계</th><th>만료일</th><th>비고</th><th></th>
      </tr></thead>
      <tbody>${allocRows}${adjRows}</tbody>
    </table>`;
}

function renderCompLeavesTab(compLeaves) {
  const header = `
    <div class="section-header">
      <h3>대체휴가 내역</h3>
      <button class="btn btn-success btn-sm" onclick="showCompLeaveModal()">+ 등록</button>
    </div>`;

  if (!compLeaves.length) return header + '<p class="empty-table">대체휴가 내역이 없습니다.</p>';

  const rows = [...compLeaves]
    .sort((a, b) => (b.generatedDate || '').localeCompare(a.generatedDate || ''))
    .map(c => {
      const linkedUsage = state.usages.find(u => u.compLeaveId === c.id);
      const usedLabel = linkedUsage
        ? `<span class="badge badge-comp-used">사용 (${fmt(linkedUsage.startDate)})</span>`
        : c.used
          ? `<span class="badge badge-comp-used">사용</span>`
          : `<label class="comp-check-label">
               <input type="checkbox" onchange="toggleCompLeaveUsed(${c.id}, this.checked)">
               <span class="badge badge-comp-unused">미사용</span>
             </label>`;
      return `
        <tr>
          <td>${fmt(c.generatedDate)}</td>
          <td>${c.workContent || '-'}</td>
          <td>${usedLabel}</td>
          <td>
            <div class="actions">
              <button class="btn btn-outline btn-sm" onclick="showCompLeaveModal(${c.id})">수정</button>
              <button class="btn btn-danger btn-sm" onclick="deleteCompLeave(${c.id})">삭제</button>
            </div>
          </td>
        </tr>`;
    }).join('');

  return header + `
    <table class="data-table">
      <thead><tr>
        <th>발생일</th><th>업무내용</th><th>사용여부</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── 모달 ─────────────────────────────────────────
function openModal() {
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

function showDeductionScreen(body, excessDays, currentRemaining) {
  window._pendingUsage = { body, excessDays }; // onclick 속성 내 JSON 파싱 오류 방지

  const next = getNextAlloc(
    state.employees.find(e => e.id === state.selectedId)?.joinDate || ''
  );
  const nextLabel = next ? `${fmt(next.date)} 발생 예정 (${next.days}일)` : '다음 발생 예정 없음';

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-title">⚠️ 잔여 연차 초과</div>
    <div class="deduction-info">
      <div class="deduction-row">
        <span>사용 신청</span><strong>${body.days}일</strong>
      </div>
      <div class="deduction-row">
        <span>현재 잔여</span><strong>${Math.max(0, currentRemaining)}일</strong>
      </div>
      <div class="deduction-row excess">
        <span>초과 사용</span><strong>${excessDays}일</strong>
      </div>
    </div>
    <p class="deduction-guide">초과 <strong>${excessDays}일</strong>을 어떻게 처리할까요?</p>
    <div class="deduction-options">
      <button class="deduction-btn" onclick="finalSaveUsage('salary')">
        <div class="deduction-opt-title">💰 급여 공제</div>
        <div class="deduction-opt-desc">초과 사용분을 급여에서 공제</div>
      </button>
      <button class="deduction-btn" onclick="finalSaveUsage('nextAlloc')">
        <div class="deduction-opt-title">📅 다음 연차 선공제</div>
        <div class="deduction-opt-desc">${nextLabel}에서 미리 공제</div>
      </button>
    </div>
    <div class="form-actions" style="margin-top:8px;">
      <button class="btn btn-outline" onclick="closeModal()">취소</button>
    </div>`;
}

async function finalSaveUsage(deductionType) {
  const { body, excessDays } = window._pendingUsage;
  body.deductionType = deductionType;
  body.excessDays = excessDays;
  await api.post('/api/usages', body);
  closeModal();
  await loadData();
  renderSidebar();
  renderMain();
}

const DEPARTMENTS = ['물류팀', '마케팅팀', '서포트팀', '기타'];

function autoFormatDate(el) {
  const digits = el.value.replace(/\D/g, '').slice(0, 8);
  let v = digits;
  if (digits.length > 6)      v = digits.slice(0,4) + '.' + digits.slice(4,6) + '.' + digits.slice(6);
  else if (digits.length > 4) v = digits.slice(0,4) + '.' + digits.slice(4);
  el.value = v;
}

function dateToISO(val) {
  // "20211210" 또는 "2021.12.10" 모두 YYYY-MM-DD로 변환
  const digits = val.replace(/\D/g, '');
  if (digits.length === 8) return `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;
  return val;
}

function showEmployeeModal(id = null) {
  const emp = id ? state.employees.find(e => e.id === id) : null;
  const deptOpts = DEPARTMENTS.map(d =>
    `<option value="${d}" ${emp?.department === d ? 'selected' : ''}>${d}</option>`
  ).join('');
  const joinDisplay = emp?.joinDate ? emp.joinDate.replace(/-/g, '.') : '';

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-title">${emp ? '직원 정보 수정' : '신규 직원 추가'}</div>
    <div class="form-group">
      <label>이름 *</label>
      <input type="text" id="f-name" value="${emp?.name || ''}" placeholder="홍길동">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>부서</label>
        <select id="f-dept">
          <option value="">선택</option>
          ${deptOpts}
        </select>
      </div>
      <div class="form-group">
        <label>직책</label>
        <input type="text" id="f-pos" value="${emp?.position || ''}" placeholder="사원">
      </div>
    </div>
    <div class="form-group">
      <label>입사일 * <span class="form-hint-inline">숫자 8자리 입력 (예: 20211210)</span></label>
      <input type="text" id="f-join" value="${joinDisplay}"
             placeholder="2021.12.10"
             maxlength="10"
             oninput="autoFormatDate(this)"
             inputmode="numeric">
    </div>
    <div class="form-group">
      <label>메모</label>
      <input type="text" id="f-memo" value="${emp?.memo || ''}" placeholder="추가 메모 (선택)">
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="saveEmployee(${id ?? 'null'})">저장</button>
    </div>`;
  openModal();
}

function showAllocModal(id = null) {
  const alloc = id ? state.allocations.find(a => a.id === id) : null;
  const emp = state.employees.find(e => e.id === state.selectedId);
  const allocType = alloc?.type || '연차';

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-title">${alloc ? '발생 내역 수정' : '발생 내역 등록'}</div>
    <div class="form-group">
      <label>유형 *</label>
      <select id="fa-type" onchange="onAllocTypeChange()">
        <option value="연차" ${allocType === '연차' ? 'selected' : ''}>연차</option>
        <option value="특별휴가" ${allocType === '특별휴가' ? 'selected' : ''}>특별휴가</option>
      </select>
    </div>
    <div id="alloc-annual-fields">
      <div class="form-row">
        <div class="form-group">
          <label>발생 연도 *</label>
          <input type="number" id="f-year" value="${alloc?.year || state.year}" min="2000" max="2100">
        </div>
        <div class="form-group">
          <label>발생일 *</label>
          <input type="date" id="f-gen" value="${alloc?.generatedDate || ''}" onchange="autoCalcLegal()">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>법정 연차 일수</label>
          <input type="number" id="f-legal" value="${alloc?.legalDays ?? 0}" min="0" max="25">
          <div class="form-hint" id="legalHint">발생일 입력 후 자동계산됩니다</div>
        </div>
        <div class="form-group">
          <label>추가 일수</label>
          <input type="number" id="f-add" value="${alloc?.additionalDays ?? 0}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label>비고</label>
        <input type="text" id="f-note" value="${alloc?.note || ''}" placeholder="예: 근속 가산, 포상 등">
      </div>
    </div>
    <div id="alloc-special-fields" style="display:none;">
      <div class="form-row">
        <div class="form-group">
          <label>발생 연도 *</label>
          <input type="number" id="fs-year" value="${alloc?.year || state.year}" min="2000" max="2100">
        </div>
        <div class="form-group">
          <label>일수 *</label>
          <input type="number" id="fs-days" value="${alloc?.totalDays ?? 1}" min="0.5" step="0.5">
        </div>
      </div>
      <div class="form-group">
        <label>비고</label>
        <input type="text" id="fs-note" value="${alloc?.note || ''}" placeholder="예: 결혼 특별휴가, 포상 등">
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="saveAlloc(${id ?? 'null'})">저장</button>
    </div>`;

  window._joinDate = emp?.joinDate;
  onAllocTypeChange();
  openModal();
}

function onAllocTypeChange() {
  const type = document.getElementById('fa-type')?.value;
  const annual  = document.getElementById('alloc-annual-fields');
  const special = document.getElementById('alloc-special-fields');
  if (!annual || !special) return;
  annual.style.display  = type === '연차' ? 'block' : 'none';
  special.style.display = type === '특별휴가' ? 'block' : 'none';
}

async function autoCalcLegal() {
  const genDate = document.getElementById('f-gen')?.value;
  if (!genDate || !window._joinDate) return;
  const res = await api.get(`/api/calc-legal-days?joinDate=${window._joinDate}&generatedDate=${genDate}`);
  document.getElementById('f-legal').value = res.days;
  const hint = res.days === 0
    ? '입사 후 6개월 미만 — 발생 없음'
    : `자동계산: ${res.days}일 (유효기간 2년, 만료일: ${addYears(genDate, 2)})`;
  document.getElementById('legalHint').textContent = hint;
}

function showUsageModal(id = null) {
  const u = id ? state.usages.find(x => x.id === id) : null;
  const types = ['연차', '오전반차', '오후반차', '병가', '대체휴가', '특별휴가'];
  const typeOpts = types.map(t => `<option value="${t}" ${u?.type === t ? 'selected' : ''}>${t}</option>`).join('');

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-title">${u ? '사용 내역 수정' : '연차 사용 등록'}</div>
    <div class="form-row">
      <div class="form-group">
        <label>시작일 *</label>
        <input type="date" id="f-start" value="${u?.startDate || ''}">
      </div>
      <div class="form-group">
        <label>종료일</label>
        <input type="date" id="f-end" value="${u?.endDate || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>사용 일수 *</label>
        <input type="number" id="f-days" value="${u?.days ?? 1}" min="0.5" step="0.5">
      </div>
      <div class="form-group">
        <label>구분</label>
        <select id="f-type" onchange="onUsageTypeChange()">${typeOpts}</select>
      </div>
    </div>
    <div id="comp-picker" class="form-group" style="display:none;">
      <label>풀에서 선택 *</label>
      <select id="f-comp-leave-id"></select>
      <div class="form-hint" id="comp-picker-hint"></div>
    </div>
    <div class="form-group">
      <label>사유</label>
      <input type="text" id="f-reason" value="${u?.reason || ''}" placeholder="개인 사정, 여행, 병원 등">
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" onclick="closeModal()">취소</button>
      <button class="btn btn-success" onclick="saveUsage(${id ?? 'null'})">저장</button>
    </div>`;

  window._currentCompLeaveId = u?.compLeaveId || null;
  onUsageTypeChange();
  openModal();
}

function onUsageTypeChange() {
  const type = document.getElementById('f-type')?.value;
  const picker = document.getElementById('comp-picker');
  if (!picker) return;

  const needsPicker = type === '대체휴가';
  picker.style.display = needsPicker ? 'block' : 'none';
  if (!needsPicker) return;

  const preId = window._currentCompLeaveId;
  const available = state.compLeaves.filter(c =>
    c.employeeId === state.selectedId &&
    (!c.used || c.id === preId)
  );

  const hint = document.getElementById('comp-picker-hint');
  if (!available.length) {
    document.getElementById('f-comp-leave-id').innerHTML = '<option value="">— 미사용 항목 없음 —</option>';
    if (hint) hint.textContent = '대체휴가 탭에서 먼저 발생 내역을 등록하세요.';
    return;
  }
  if (hint) hint.textContent = '';
  document.getElementById('f-comp-leave-id').innerHTML = available
    .map(c => `<option value="${c.id}" ${c.id === preId ? 'selected' : ''}>${fmt(c.generatedDate)} — ${c.workContent}</option>`)
    .join('');
}

function showCompLeaveModal(id = null) {
  const c = id ? state.compLeaves.find(x => x.id === id) : null;

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-title">${c ? '대체휴가 수정' : '대체휴가 등록'}</div>
    <div class="form-group">
      <label>발생일 *</label>
      <input type="date" id="fc-date" value="${c?.generatedDate || ''}">
    </div>
    <div class="form-group">
      <label>업무내용 *</label>
      <input type="text" id="fc-content" value="${c?.workContent || ''}" placeholder="예: 00일 휴일근무 (행사 준비)">
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" onclick="closeModal()">취소</button>
      <button class="btn btn-success" onclick="saveCompLeave(${id ?? 'null'})">저장</button>
    </div>`;
  openModal();
}

// ── 저장 ─────────────────────────────────────────
async function saveEmployee(id) {
  const name = document.getElementById('f-name').value.trim();
  const joinDate = dateToISO(document.getElementById('f-join').value.trim());
  if (!name || !joinDate || joinDate.length !== 10) { alert('이름과 입사일(8자리)은 필수입니다.'); return; }

  const body = {
    name, joinDate,
    department: document.getElementById('f-dept').value.trim(),
    position: document.getElementById('f-pos').value.trim(),
    memo: document.getElementById('f-memo').value.trim(),
  };

  if (id) {
    await api.put(`/api/employees/${id}`, body);
  } else {
    const emp = await api.post('/api/employees', body);
    state.selectedId = emp.id;
    // 신규 직원은 과거 발생 내역 자동생성
    await api.post(`/api/employees/${emp.id}/auto-allocate`, {});
  }
  closeModal();
  await loadData();
  renderSidebar();
  renderMain();
}

async function autoAllocate() {
  if (!state.selectedId) return;
  const result = await api.post(`/api/employees/${state.selectedId}/auto-allocate`, {});
  let msg = '';
  if (result.created === 0) {
    msg = '새로 생성할 발생 내역이 없습니다.\n(이미 모두 등록되어 있습니다)';
  } else {
    msg = `${result.created}건의 연차 발생 내역이 자동 생성되었습니다.`;
    if (result.deductionApplied > 0) {
      msg += `\n\n📅 선공제 ${result.deductionApplied}일이 발생 일수에서 차감되었습니다.`;
    }
  }
  alert(msg);
  await loadData();
  renderSidebar();
  renderMain();
}

async function saveAlloc(id) {
  const type = document.getElementById('fa-type').value;
  let body;

  if (type === '특별휴가') {
    const year = Number(document.getElementById('fs-year').value);
    const days = Number(document.getElementById('fs-days').value);
    if (!year || !days) { alert('연도와 일수는 필수입니다.'); return; }
    body = {
      employeeId: state.selectedId,
      type: '특별휴가',
      year,
      generatedDate: `${year}-01-01`,
      legalDays: days,
      additionalDays: 0,
      totalDays: days,
      note: document.getElementById('fs-note').value.trim(),
    };
  } else {
    const year = Number(document.getElementById('f-year').value);
    const generatedDate = document.getElementById('f-gen').value;
    if (!year || !generatedDate) { alert('연도와 발생일은 필수입니다.'); return; }
    body = {
      employeeId: state.selectedId,
      type: '연차',
      year, generatedDate,
      legalDays: Number(document.getElementById('f-legal').value) || 0,
      additionalDays: Number(document.getElementById('f-add').value) || 0,
      note: document.getElementById('f-note').value.trim(),
    };
  }

  if (id) await api.put(`/api/allocations/${id}`, body);
  else await api.post('/api/allocations', body);

  closeModal();
  await loadData();
  renderSidebar();
  renderMain();
}

async function saveUsage(id) {
  const startDate = document.getElementById('f-start').value;
  const days = Number(document.getElementById('f-days').value);
  if (!startDate || !days) { alert('시작일과 사용 일수는 필수입니다.'); return; }

  const endDate = document.getElementById('f-end').value || startDate;
  const type = document.getElementById('f-type').value;
  const isComp = COMP_TYPES.includes(type);

  let compLeaveId = null;
  if (isComp) {
    const sel = document.getElementById('f-comp-leave-id');
    compLeaveId = sel ? (Number(sel.value) || null) : null;
    if (!compLeaveId) { alert('사용할 대체/특별 휴가 항목을 선택해주세요.'); return; }
  }

  const body = {
    employeeId: state.selectedId,
    startDate, endDate, days, type,
    reason: document.getElementById('f-reason').value.trim(),
    ...(compLeaveId ? { compLeaveId } : {}),
  };

  // 대체/특별휴가는 연차 잔여 초과 체크 불필요
  if (!id && !isComp) {
    const allAllocs = state.allocations
      .filter(a => a.employeeId === state.selectedId && (!a.type || a.type === '연차'))
      .map(a => ({ ...a, expiryDate: expiryOf(a) }));
    const allUsages = state.usages.filter(u => u.employeeId === state.selectedId);
    const currentRemaining = calcValidRemaining(allAllocs, allUsages);
    const excessDays = days - Math.max(0, currentRemaining);

    if (excessDays > 0) {
      showDeductionScreen(body, excessDays, currentRemaining);
      return;
    }
  }

  if (id) await api.put(`/api/usages/${id}`, body);
  else await api.post('/api/usages', body);

  closeModal();
  await loadData();
  renderSidebar();
  renderMain();
}

async function saveCompLeave(id) {
  const generatedDate = document.getElementById('fc-date').value;
  const workContent = document.getElementById('fc-content').value.trim();
  if (!generatedDate || !workContent) { alert('발생일과 업무내용은 필수입니다.'); return; }

  const body = {
    employeeId: state.selectedId,
    type: '대체휴가',
    generatedDate,
    workContent,
  };

  if (id) await api.put(`/api/comp-leaves/${id}`, body);
  else await api.post('/api/comp-leaves', body);

  closeModal();
  await loadData();
  renderSidebar();
  renderMain();
}

async function toggleCompLeaveUsed(id, used) {
  await api.put(`/api/comp-leaves/${id}`, { used });
  await loadData();
  renderMain();
}

// ── 삭제 ─────────────────────────────────────────
async function deleteEmployee(id) {
  if (!confirm('직원을 삭제하면 모든 연차 기록도 함께 삭제됩니다.\n계속하시겠습니까?')) return;
  await api.del(`/api/employees/${id}`);
  state.selectedId = null;
  await loadData();
  renderSidebar();
  renderMain();
}

async function deleteCompLeave(id) {
  if (!confirm('대체휴가 기록을 삭제하시겠습니까?')) return;
  await api.del(`/api/comp-leaves/${id}`);
  await loadData();
  renderSidebar();
  renderMain();
}

async function deleteAlloc(id) {
  if (!confirm('발생 기록을 삭제하시겠습니까?')) return;
  await api.del(`/api/allocations/${id}`);
  await loadData();
  renderSidebar();
  renderMain();
}

async function deleteUsage(id) {
  if (!confirm('사용 기록을 삭제하시겠습니까?')) return;
  await api.del(`/api/usages/${id}`);
  await loadData();
  renderSidebar();
  renderMain();
}

// ── 잔여 연차 관리자 수정 ─────────────────────────
function showAdjustModal(empId, empName, currentRemaining) {
  document.getElementById('modalContent').innerHTML = `
    <div class="modal-title">잔여 연차 수정 — ${empName}</div>
    <div style="margin-bottom:14px;color:#475569;font-size:0.9rem;">현재 잔여: <strong>${currentRemaining}일</strong></div>
    <div class="form-group">
      <label>조정 후 잔여 일수</label>
      <input type="number" id="adj-days" value="${currentRemaining}" min="0" step="0.5" style="width:100%">
    </div>
    <div class="form-group">
      <label>사유</label>
      <input type="text" id="adj-reason" placeholder="관리자 조정 사유" style="width:100%">
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="saveAdjust(${empId},${currentRemaining})">저장</button>
    </div>`;
  document.getElementById('modalOverlay').classList.remove('hidden');
}

async function saveAdjust(empId, currentRemaining) {
  const newDays = Number(document.getElementById('adj-days').value);
  const reason = document.getElementById('adj-reason').value || '관리자 조정';
  if (isNaN(newDays) || newDays < 0) { alert('올바른 일수를 입력하세요.'); return; }

  const diff = newDays - currentRemaining;
  if (diff === 0) { closeModal(); return; }

  const today = new Date().toISOString().slice(0, 10);

  if (diff > 0) {
    // 잔여 증가 → 발생 내역 추가
    await api.post('/api/allocations', {
      employeeId: empId,
      type: '관리자조정',
      year: Number(today.slice(0, 4)),
      generatedDate: today,
      legalDays: diff,
      additionalDays: 0,
      totalDays: diff,
      expiryDate: today.slice(0, 4) + '-12-31',
      note: reason,
    });
  } else {
    // 잔여 감소 → 사용 내역 추가 (관리자 차감)
    await api.post('/api/usages', {
      employeeId: empId,
      startDate: today,
      endDate: today,
      days: Math.abs(diff),
      type: '관리자조정',
      reason,
    });
  }

  closeModal();
  await loadData();
  renderSidebar();
  renderMain();
  if (state.view === 'admin') renderAdminView();
}

// ── 네비게이션 ────────────────────────────────────
function selectEmployee(id) {
  state.selectedId = id;
  if (state.view === 'admin') switchView('employees');
  renderSidebar();
  renderMain();
}

function changeYear(y) {
  state.year = Number(y);
  renderSidebar();
  renderMain();
}

function switchTab(tab) {
  state.tab = tab;
  renderMain();
}

function switchView(view) {
  state.view = view;
  document.getElementById('empLayout').classList.toggle('hidden', view !== 'employees');
  document.getElementById('adminLayout').classList.toggle('hidden', view !== 'admin');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-${view}`).classList.add('active');
  if (view === 'admin') renderAdminView();
}

function updateAdminFilter(key, value) {
  state.adminFilter[key] = (key === 'month') ? Number(value) : (key === 'year' ? (value ? Number(value) : 0) : value);
  renderAdminView();
}

// ── 관리자 조회 뷰 ─────────────────────────────────
function renderAdminView() {
  const { year, month, department } = state.adminFilter;
  const today = new Date().toISOString().slice(0, 10);
  const curYear = new Date().getFullYear();

  // 부서 목록
  const departments = [...new Set(state.employees.map(e => e.department).filter(Boolean))].sort();
  const deptOpts = ['', ...departments].map(d =>
    `<option value="${d}" ${d === department ? 'selected' : ''}>${d || '전체 부서'}</option>`
  ).join('');
  const yearOpts = [0, curYear - 2, curYear - 1, curYear, curYear + 1].map(y =>
    `<option value="${y}" ${y === year ? 'selected' : ''}>${y || '전체 연도'}</option>`
  ).join('');
  const monthOpts = [0, ...Array.from({ length: 12 }, (_, i) => i + 1)].map(m =>
    `<option value="${m}" ${m === month ? 'selected' : ''}>${m ? m + '월' : '전체 월'}</option>`
  ).join('');

  // 직원 필터
  let filtered = [...state.employees];
  if (department) filtered = filtered.filter(e => e.department === department);

  // 월 선택 시: 해당 월과 겹치는 연차 사용 내역이 있는 직원만 표시
  if (month) {
    filtered = filtered.filter(emp => state.usages.some(u => overlapsMonth(u, year, month) && u.employeeId === emp.id));
  }

  filtered.sort((a, b) => (a.department || '').localeCompare(b.department || '') || a.name.localeCompare(b.name));

  let totalAllocated = 0, totalUsed = 0, totalRemaining = 0;

  const rows = filtered.map(emp => {
    const allAllocs = state.allocations.filter(a => a.employeeId === emp.id)
      .map(a => ({ ...a, expiryDate: expiryOf(a) }));
    const allUsages = state.usages.filter(u => u.employeeId === emp.id);

    // 기간 필터 적용한 사용 내역
    let periodUsages = allUsages.filter(u => u.type !== '관리자조정');
    if (year || month) periodUsages = periodUsages.filter(u => overlapsMonth(u, year, month));

    const validAllocated = allAllocs.filter(a => a.expiryDate >= today)
      .reduce((s, a) => s + (Number(a.totalDays) || 0), 0);
    const periodUsed = periodUsages.reduce((s, u) => s + (Number(u.days) || 0), 0);
    const validRemaining = calcValidRemaining(allAllocs, allUsages);
    const next = getNextAlloc(emp.joinDate);

    totalAllocated += validAllocated;
    totalUsed += periodUsed;
    totalRemaining += validRemaining;

    const remCls = validRemaining <= 0 ? 'num-danger' : validRemaining <= 3 ? 'num-warn' : 'num-ok';
    const usedItems = periodUsages.length > 0
      ? periodUsages.sort((a, b) => b.startDate.localeCompare(a.startDate))
          .slice(0, 3)
          .map(u => {
            const dateStr = u.endDate && u.endDate !== u.startDate
              ? `${fmt(u.startDate)} ~ ${fmt(u.endDate)}`
              : fmt(u.startDate);
            return `<div class="usage-mini">${dateStr} · ${u.days}일 (${u.type})</div>`;
          })
          .join('') + (periodUsages.length > 3 ? `<div class="usage-mini text-muted">+${periodUsages.length - 3}건 더</div>` : '')
      : '<span class="text-muted" style="font-size:0.78rem;">없음</span>';

    return `
      <tr onclick="selectEmployee(${emp.id})" class="admin-row">
        <td>
          <div class="admin-name">${emp.name}</div>
          <div class="text-muted">${[emp.department, emp.position].filter(Boolean).join(' · ')}</div>
        </td>
        <td>${fmt(emp.joinDate)}</td>
        <td>${servicePeriod(emp.joinDate)}</td>
        <td class="num-center"><strong>${validAllocated}</strong>일</td>
        <td class="num-center"><strong class="${periodUsed > 0 ? 'num-used' : ''}">${periodUsed}</strong>일</td>
        <td class="num-center"><strong class="${remCls}">${validRemaining}</strong>일
          <button class="btn-admin-adjust" onclick="event.stopPropagation();showAdjustModal(${emp.id},'${emp.name}',${validRemaining})" title="잔여 수정">✏️</button>
        </td>
        <td>${next ? `${fmt(next.date)}<br><span class="text-muted">${next.days}일 예정</span>` : '<span class="text-muted">-</span>'}</td>
        <td class="usage-col">${usedItems}</td>
      </tr>`;
  }).join('');

  const periodLabel = [year ? year + '년' : '전체', month ? month + '월' : ''].filter(Boolean).join(' ') || '전체 기간';

  document.getElementById('adminPanel').innerHTML = `
    <div class="admin-filter-bar">
      <div class="filter-group">
        <label>연도</label>
        <select onchange="updateAdminFilter('year', this.value)">${yearOpts}</select>
      </div>
      <div class="filter-group">
        <label>월</label>
        <select onchange="updateAdminFilter('month', this.value)">${monthOpts}</select>
      </div>
      <div class="filter-group">
        <label>부서</label>
        <select onchange="updateAdminFilter('department', this.value)">${deptOpts}</select>
      </div>
      <span class="filter-count">${filtered.length}명</span>
    </div>

    <div class="admin-table-wrap">
      <table class="data-table admin-table">
        <thead>
          <tr>
            <th>직원</th>
            <th>입사일</th>
            <th>근속기간</th>
            <th class="num-center">유효 발생</th>
            <th class="num-center">사용 (${periodLabel})</th>
            <th class="num-center">잔여</th>
            <th>다음 발생 예정</th>
            <th>사용 내역</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="8" class="empty-table">해당하는 직원이 없습니다.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ── 초기화 ────────────────────────────────────────
async function init() {
  if (!sessionStorage.getItem('auth')) {
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginId').focus();
    return;
  }
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('headerSub').textContent = `${state.year}년 연차 현황`;
  await loadData();
  renderSidebar();
  renderMain();
}

init();
