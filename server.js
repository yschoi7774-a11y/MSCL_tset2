const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

app.use(express.json());
app.use(express.static('public'));

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = { employees: [], allocations: [], usages: [], compLeaves: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  if (!db.compLeaves) db.compLeaves = [];
  return db;
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// 회사 규정 연차 발생 기준 (근속 기간별)
const LEAVE_SCHEDULE = [
  { minYears: 6.5, days: 20 },
  { minYears: 5.5, days: 18 },
  { minYears: 4.5, days: 16 },
  { minYears: 3.5, days: 14 },
  { minYears: 2.5, days: 12 },
  { minYears: 1.5, days: 11 },
  { minYears: 0.5, days: 10 },
];

function calcLegalDays(joinDate, generatedDate) {
  const diffYears = (new Date(generatedDate) - new Date(joinDate)) / (365.25 * 86400000);
  for (const { minYears, days } of LEAVE_SCHEDULE) {
    if (diffYears >= minYears) return days;
  }
  return 0;
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

// 입사일 기준 전체 발생 스케줄 계산
// 0.5년, 1.5년, 2.5년 ... 6.5년, 이후 매 12개월
const SCHEDULE_POINTS = [
  { months: 6,  days: 10 },
  { months: 18, days: 11 },
  { months: 30, days: 12 },
  { months: 42, days: 14 },
  { months: 54, days: 16 },
  { months: 66, days: 18 },
];
for (let m = 78; m <= 78 + 12 * 30; m += 12) {
  SCHEDULE_POINTS.push({ months: m, days: 20 });
}

function getFullSchedule(joinDate) {
  return SCHEDULE_POINTS.map(s => {
    const date = addMonths(joinDate, s.months);
    return { months: s.months, days: s.days, date, expiryDate: addYears(date, 2) };
  });
}

const COMP_TYPES = ['대체휴가', '특별휴가'];

// 잔여 연차 = 유효 발생 합계 - 전체 사용 합계 (신청 즉시 반영)
function calcValidRemaining(allocs, usages) {
  const today = new Date().toISOString().slice(0, 10);
  const totalValid = allocs
    .filter(a => (!a.type || a.type === '연차'))
    .filter(a => (a.expiryDate || addYears(a.generatedDate, 2)) >= today)
    .reduce((s, a) => s + (Number(a.totalDays) || 0), 0);
  const totalUsed = usages
    .filter(u => !COMP_TYPES.includes(u.type))
    .reduce((s, u) => s + (Number(u.days) || 0), 0);
  return Math.max(0, totalValid - totalUsed);
}

// ── 직원 ──────────────────────────────────────────
app.get('/api/employees', (req, res) => {
  res.json(readDB().employees);
});

app.post('/api/employees', (req, res) => {
  const db = readDB();
  const emp = { id: Date.now(), ...req.body };
  db.employees.push(emp);
  writeDB(db);
  res.json(emp);
});

app.put('/api/employees/:id', (req, res) => {
  const db = readDB();
  const idx = db.employees.findIndex(e => e.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });
  db.employees[idx] = { ...db.employees[idx], ...req.body };
  writeDB(db);
  res.json(db.employees[idx]);
});

app.delete('/api/employees/:id', (req, res) => {
  const db = readDB();
  const id = Number(req.params.id);
  db.employees = db.employees.filter(e => e.id !== id);
  db.allocations = db.allocations.filter(a => a.employeeId !== id);
  db.usages = db.usages.filter(u => u.employeeId !== id);
  db.compLeaves = db.compLeaves.filter(c => c.employeeId !== id);
  writeDB(db);
  res.json({ ok: true });
});

// ── 연차 발생 ──────────────────────────────────────
app.get('/api/allocations', (req, res) => {
  const db = readDB();
  const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
  res.json(empId ? db.allocations.filter(a => a.employeeId === empId) : db.allocations);
});

app.post('/api/allocations', (req, res) => {
  const db = readDB();
  const item = { id: Date.now(), ...req.body };
  item.totalDays = (Number(item.legalDays) || 0) + (Number(item.additionalDays) || 0);
  item.expiryDate = item.expiryDate || addYears(item.generatedDate, 2);
  db.allocations.push(item);
  writeDB(db);
  res.json(item);
});

app.put('/api/allocations/:id', (req, res) => {
  const db = readDB();
  const idx = db.allocations.findIndex(a => a.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '발생 기록을 찾을 수 없습니다.' });
  db.allocations[idx] = { ...db.allocations[idx], ...req.body };
  db.allocations[idx].totalDays = (Number(db.allocations[idx].legalDays) || 0) + (Number(db.allocations[idx].additionalDays) || 0);
  db.allocations[idx].expiryDate = db.allocations[idx].expiryDate || addYears(db.allocations[idx].generatedDate, 2);
  writeDB(db);
  res.json(db.allocations[idx]);
});

app.delete('/api/allocations/:id', (req, res) => {
  const db = readDB();
  db.allocations = db.allocations.filter(a => a.id !== Number(req.params.id));
  writeDB(db);
  res.json({ ok: true });
});

// ── 연차 사용 ──────────────────────────────────────
app.get('/api/usages', (req, res) => {
  const db = readDB();
  const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
  res.json(empId ? db.usages.filter(u => u.employeeId === empId) : db.usages);
});

app.post('/api/usages', (req, res) => {
  const db = readDB();
  const item = { id: Date.now(), ...req.body, registeredAt: new Date().toISOString() };
  db.usages.push(item);
  if (item.compLeaveId) {
    const idx = db.compLeaves.findIndex(c => c.id === item.compLeaveId);
    if (idx !== -1) db.compLeaves[idx].used = true;
  }
  writeDB(db);
  res.json(item);
});

app.put('/api/usages/:id', (req, res) => {
  const db = readDB();
  const idx = db.usages.findIndex(u => u.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '사용 기록을 찾을 수 없습니다.' });
  const oldUsage = db.usages[idx];
  const newUsage = { ...oldUsage, ...req.body };
  // 연결된 compLeave 변경 시 used 플래그 갱신
  if (oldUsage.compLeaveId && oldUsage.compLeaveId !== newUsage.compLeaveId) {
    const oi = db.compLeaves.findIndex(c => c.id === oldUsage.compLeaveId);
    if (oi !== -1) db.compLeaves[oi].used = false;
  }
  if (newUsage.compLeaveId && oldUsage.compLeaveId !== newUsage.compLeaveId) {
    const ni = db.compLeaves.findIndex(c => c.id === newUsage.compLeaveId);
    if (ni !== -1) db.compLeaves[ni].used = true;
  }
  db.usages[idx] = newUsage;
  writeDB(db);
  res.json(newUsage);
});

app.delete('/api/usages/:id', (req, res) => {
  const db = readDB();
  const usage = db.usages.find(u => u.id === Number(req.params.id));
  if (usage?.compLeaveId) {
    const idx = db.compLeaves.findIndex(c => c.id === usage.compLeaveId);
    if (idx !== -1) db.compLeaves[idx].used = false;
  }
  db.usages = db.usages.filter(u => u.id !== Number(req.params.id));
  writeDB(db);
  res.json({ ok: true });
});

// ── 요약 (유효 잔여 연차) ──────────────────────────
app.get('/api/employees/:id/summary', (req, res) => {
  const db = readDB();
  const employeeId = Number(req.params.id);
  const year = Number(req.query.year) || new Date().getFullYear();

  const employee = db.employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });

  const today = new Date().toISOString().slice(0, 10);
  const allAllocs = db.allocations
    .filter(a => a.employeeId === employeeId)
    .map(a => ({ ...a, expiryDate: a.expiryDate || addYears(a.generatedDate, 2) }));
  const allUsages = db.usages.filter(u => u.employeeId === employeeId);

  // 유효 잔여 (FIFO)
  const validRemaining = calcValidRemaining(allAllocs, allUsages);
  const totalUsed = allUsages.reduce((s, u) => s + (Number(u.days) || 0), 0);
  const totalValidAllocated = allAllocs
    .filter(a => a.expiryDate >= today)
    .reduce((s, a) => s + (Number(a.totalDays) || 0), 0);

  // 연도별 상세 (테이블용)
  const yearAllocs = allAllocs.filter(a =>
    a.generatedDate && a.generatedDate.startsWith(String(year))
  );
  const yearUsages = allUsages.filter(u =>
    u.startDate && u.startDate.startsWith(String(year))
  );

  const diffMs = Date.now() - new Date(employee.joinDate);
  const serviceYears = Math.floor(diffMs / (365.25 * 86400000));
  const serviceMonths = Math.floor(diffMs / (30.5 * 86400000)) % 12;

  // 다음 발생 예정
  const fullSchedule = getFullSchedule(employee.joinDate);
  const nextSchedule = fullSchedule.find(s => s.date > today);

  res.json({
    employee, year,
    totalValidAllocated, totalUsed, validRemaining,
    yearAllocations: yearAllocs,
    yearUsages,
    serviceYears, serviceMonths,
    nextSchedule,
  });
});

// ── 자동 발생 생성 ──────────────────────────────────
app.post('/api/employees/:id/auto-allocate', (req, res) => {
  const db = readDB();
  const employeeId = Number(req.params.id);
  const employee = db.employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });

  const today = new Date().toISOString().slice(0, 10);
  const schedule = getFullSchedule(employee.joinDate);
  const past = schedule.filter(s => s.date <= today);
  const existing = db.allocations.filter(a => a.employeeId === employeeId);

  // 미적용 선공제 합산
  const pendingDeduction = db.usages
    .filter(u => u.employeeId === employeeId && u.deductionType === 'nextAlloc' && !u.deductionApplied)
    .reduce((s, u) => s + (Number(u.excessDays) || 0), 0);

  let created = 0;
  let deductionApplied = false;

  for (const s of past) {
    const alreadyExists = existing.some(a => a.generatedDate === s.date);
    if (!alreadyExists) {
      let legalDays = s.days;
      let note = '자동생성';

      // 첫 번째 새 발생에 선공제 적용
      if (!deductionApplied && pendingDeduction > 0) {
        legalDays = Math.max(0, s.days - pendingDeduction);
        note = `자동생성 (선공제 -${pendingDeduction}일 적용)`;
        deductionApplied = true;
      }

      db.allocations.push({
        id: Date.now() + Math.random(),
        employeeId,
        year: Number(s.date.slice(0, 4)),
        generatedDate: s.date,
        legalDays,
        additionalDays: 0,
        totalDays: legalDays,
        expiryDate: s.expiryDate,
        note,
      });
      created++;
    }
  }

  // 선공제 적용 완료 표시
  if (deductionApplied) {
    db.usages = db.usages.map(u =>
      u.employeeId === employeeId && u.deductionType === 'nextAlloc' && !u.deductionApplied
        ? { ...u, deductionApplied: true }
        : u
    );
  }

  const next = schedule.find(s => s.date > today);
  writeDB(db);
  res.json({ created, nextSchedule: next, deductionApplied: deductionApplied ? pendingDeduction : 0 });
});

// ── 급여 공제 처리 완료 ────────────────────────────
app.post('/api/employees/:id/salary-processed', (req, res) => {
  const db = readDB();
  const employeeId = Number(req.params.id);
  db.usages = db.usages.map(u =>
    u.employeeId === employeeId && u.deductionType === 'salary' && !u.salaryProcessed
      ? { ...u, salaryProcessed: true }
      : u
  );
  writeDB(db);
  res.json({ ok: true });
});

// ── 대체휴가 ──────────────────────────────────────
app.get('/api/comp-leaves', (req, res) => {
  const db = readDB();
  const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
  res.json(empId ? db.compLeaves.filter(c => c.employeeId === empId) : db.compLeaves);
});

app.post('/api/comp-leaves', (req, res) => {
  const db = readDB();
  const item = { id: Date.now(), used: false, ...req.body };
  db.compLeaves.push(item);
  writeDB(db);
  res.json(item);
});

app.put('/api/comp-leaves/:id', (req, res) => {
  const db = readDB();
  const idx = db.compLeaves.findIndex(c => c.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '대체휴가 기록을 찾을 수 없습니다.' });
  db.compLeaves[idx] = { ...db.compLeaves[idx], ...req.body };
  writeDB(db);
  res.json(db.compLeaves[idx]);
});

app.delete('/api/comp-leaves/:id', (req, res) => {
  const db = readDB();
  db.compLeaves = db.compLeaves.filter(c => c.id !== Number(req.params.id));
  writeDB(db);
  res.json({ ok: true });
});

// ── 유틸 ──────────────────────────────────────────
app.get('/api/calc-legal-days', (req, res) => {
  const { joinDate, generatedDate } = req.query;
  if (!joinDate || !generatedDate) return res.status(400).json({ error: '날짜를 입력하세요.' });
  res.json({ days: calcLegalDays(joinDate, generatedDate) });
});

app.listen(PORT, () => {
  console.log(`연차관리 서버 실행: http://localhost:${PORT}`);
});
