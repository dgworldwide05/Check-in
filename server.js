const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const cron = require('node-cron');
const db = require('./db');
const { requireAdmin, login, me } = require('./auth');
const { sendBirthdayEmailIfAny, MONTH_NAMES } = require('./mailer');

const app = express();
app.set('trust proxy', 1); // correct https URLs + client IPs behind Render's proxy

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));


// ---------- Input helpers ----------
// Normalizes Ghana numbers so "024 123 4567", "0241234567" and "+233241234567"
// are all treated as the same person.
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-().]/g, '');
  if (p.startsWith('+233')) p = '0' + p.slice(4);
  else if (p.startsWith('00233')) p = '0' + p.slice(5);
  else if (/^233\d{9}$/.test(p)) p = '0' + p.slice(3);
  return p;
}
function validPhone(p) { return /^\+?\d{9,15}$/.test(p); }
function parseBirthday(day, month) {
  const d = day ? parseInt(day, 10) : null;
  const m = month ? parseInt(month, 10) : null;
  if ((d === null) !== (m === null)) return { error: 'Please select both birthday day and month' };
  if (d !== null && (!(d >= 1 && d <= 31) || !(m >= 1 && m <= 12))) return { error: 'Invalid birthday' };
  return { d, m };
}
const ALLOWED_TYPES = ['member', 'visitor'];
const ALLOWED_DEPTS_MAX_LEN = 60;

app.post('/admin/login', login);
app.get('/admin/me', me);

// Generate QR code for the check-in page link
app.get('/qrcode', async (req, res) => {
  try {
    // Builds the URL automatically from whatever domain is serving this request —
    // works on Render's URL, your own custom domain, or localhost, with no manual editing.
    const url = `${req.protocol}://${req.get('host')}/checkin.html`;
    const qr = await QRCode.toDataURL(url);
    res.json({ qr, url });
  } catch (err) {
    res.json({ error: 'Failed to generate QR code' });
  }
});

// Generate a QR code that encodes a member's phone number (so they can scan instead of typing)
app.get('/qrcode/member/:phone', async (req, res) => {
  try {
    const qr = await QRCode.toDataURL(req.params.phone.trim());
    res.json({ qr });
  } catch (err) {
    res.json({ error: 'Failed to generate phone QR code' });
  }
});

// Submit attendance (first-time signup) — creates a member record keyed by phone number
app.post('/checkin', (req, res) => {
  const { departments, birthdayDay, birthdayMonth } = req.body;
  const name = String(req.body.name || '').trim().slice(0, 100);
  const phone = normalizePhone(req.body.phone);
  const type = String(req.body.type || '').toLowerCase();
  const deptList = (Array.isArray(departments) ? departments : (departments ? [departments] : []))
    .map(d => String(d).trim().slice(0, ALLOWED_DEPTS_MAX_LEN)).filter(Boolean);
  if (deptList.includes('None') && deptList.length > 1) {
    return res.json({ success: false, message: '"None" cannot be combined with other departments' });
  }
  if (deptList.length > 3) {
    return res.json({ success: false, message: 'You can select up to 3 departments only' });
  }
  const dept = deptList.join(', ');
  const bd = parseBirthday(birthdayDay, birthdayMonth);
  if (bd.error) return res.json({ success: false, message: bd.error });
  const bDay = bd.d, bMonth = bd.m;
  const loc = String(req.body.location || '').trim().slice(0, 255) || null;
  const date = new Date().toISOString().split('T')[0];

  if (!name || !phone) return res.json({ success: false, message: 'Name and phone number are required' });
  if (!validPhone(phone)) return res.json({ success: false, message: 'Please enter a valid phone number' });
  if (!ALLOWED_TYPES.includes(type)) return res.json({ success: false, message: 'Please choose member or visitor' });
  if (!loc) return res.json({ success: false, message: 'Please tell us where you stay' });

  db.query('SELECT * FROM members WHERE phone = ?', [phone], (err, existing) => {
    if (err) return res.json({ success: false, message: 'Error checking member record' });

    if (existing.length > 0) {
      const member = existing[0];
      return db.query(
        'SELECT * FROM attendance WHERE phone = ? AND date = ?',
        [member.phone, date],
        (checkErr, already) => {
          if (checkErr) return res.json({ success: false, message: 'Error checking attendance' });
          if (already.length > 0) {
            return res.json({
              success: true,
              message: 'You are already checked in today!',
              phone: member.phone,
              alreadyRegistered: true,
              alreadyCheckedIn: true
            });
          }

          db.query(
            'INSERT INTO attendance (name, phone, type, department, birthday_day, birthday_month, location, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [member.name, member.phone, member.type, member.department, member.birthday_day, member.birthday_month, member.location, date],
            (err2) => {
              if (err2) {
                // ER_DUP_ENTRY: the unique (phone, date) constraint caught a
                // near-simultaneous duplicate request that slipped past the check above.
                if (err2.code === 'ER_DUP_ENTRY') {
                  return res.json({
                    success: true,
                    message: 'You are already checked in today!',
                    phone: member.phone,
                    alreadyRegistered: true,
                    alreadyCheckedIn: true
                  });
                }
                return res.json({ success: false, message: 'Error saving attendance' });
              }
              res.json({
                success: true,
                message: 'Welcome back! This phone number is already registered.',
                phone: member.phone,
                alreadyRegistered: true,
                alreadyCheckedIn: false
              });
            }
          );
        }
      );
    }

    db.query(
      'INSERT INTO members (name, phone, type, department, birthday_day, birthday_month, location) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, phone, type, dept, bDay, bMonth, loc],
      (err2) => {
        if (err2) {
          console.error('INSERT INTO members failed:', err2.code, err2.sqlMessage || err2.message);
          return res.json({ success: false, message: 'Error saving member record' });
        }

        db.query(
          'INSERT INTO attendance (name, phone, type, department, birthday_day, birthday_month, location, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [name, phone, type, dept, bDay, bMonth, loc, date],
          (err3) => {
            if (err3) {
              if (err3.code === 'ER_DUP_ENTRY') {
                return res.json({
                  success: true,
                  message: 'You are already checked in today!',
                  phone,
                  alreadyRegistered: false,
                  alreadyCheckedIn: true
                });
              }
              console.error('INSERT INTO attendance failed:', err3.code, err3.sqlMessage || err3.message);
              return res.json({ success: false, message: 'Error saving attendance' });
            }
            res.json({
              success: true,
              message: 'Attendance recorded!',
              phone,
              alreadyRegistered: false
            });
          }
        );
      }
    );
  });
});

// Look up a member by their phone number (used to show "Welcome back, name" before confirming)
app.get('/member/:phone', requireAdmin, (req, res) => {
  const phone = normalizePhone(req.params.phone);
  db.query('SELECT * FROM members WHERE phone = ?', [phone], (err, results) => {
    if (err) return res.json({ success: false, message: 'Lookup failed' });
    if (results.length === 0) return res.json({ success: false, message: 'Phone number not found' });
    const m = results[0];
    res.json({
      success: true,
      name: m.name,
      phone: m.phone,
      type: m.type,
      department: m.department,
      birthdayDay: m.birthday_day,
      birthdayMonth: m.birthday_month,
      location: m.location
    });
  });
});

// Returning member check-in — just the phone number, no re-entering details
app.post('/checkin/id', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.json({ success: false, message: 'Please enter your phone number' });

  db.query('SELECT * FROM members WHERE phone = ?', [phone], (err, results) => {
    if (err) return res.json({ success: false, message: 'Error looking up phone number' });
    if (results.length === 0) return res.json({ success: false, message: 'Phone number not found. Please sign up first.' });

    const member = results[0];
    const date = new Date().toISOString().split('T')[0];

    db.query(
      'SELECT * FROM attendance WHERE phone = ? AND date = ?',
      [phone, date],
      (err2, already) => {
        if (err2) return res.json({ success: false, message: 'Error checking attendance' });
        if (already.length > 0) {
          return res.json({
            success: true,
            message: 'You are already checked in today!',
            name: member.name,
            alreadyCheckedIn: true
          });
        }

        db.query(
          'INSERT INTO attendance (name, phone, type, department, birthday_day, birthday_month, location, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [member.name, member.phone, member.type, member.department, member.birthday_day, member.birthday_month, member.location, date],
          (err3) => {
            if (err3) {
              if (err3.code === 'ER_DUP_ENTRY') {
                return res.json({
                  success: true,
                  message: 'You are already checked in today!',
                  name: member.name,
                  alreadyCheckedIn: true
                });
              }
              return res.json({ success: false, message: 'Error saving attendance' });
            }
            res.json({
              success: true,
              message: 'Checked in successfully!',
              name: member.name,
              alreadyCheckedIn: false
            });
          }
        );
      }
    );
  });
});

// Get attendance by date (defaults to today)
app.get('/attendance', requireAdmin, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  db.query(
    `SELECT a.*, m.leader_id, l.name AS leader_name
     FROM attendance a
     LEFT JOIN members m ON m.phone = a.phone
     LEFT JOIN leaders l ON l.id = m.leader_id
     WHERE a.date = ? ORDER BY a.id DESC`,
    [date],
    (err, results) => {
      if (err) return res.json([]);
      res.json(results);
    }
  );
});

// Get attendance stats by date (defaults to today)
app.get('/attendance/stats', requireAdmin, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  db.query(
    `SELECT 
      COUNT(*) as total,
      SUM(type = 'member') as members,
      SUM(type = 'visitor') as visitors
     FROM attendance WHERE date = ?`,
    [date],
    (err, results) => {
      if (err) return res.json({});
      res.json(results[0]);
    }
  );
});

// Get all members (full member list, not tied to a specific date)
app.get('/members', requireAdmin, (req, res) => {
  db.query(
    `SELECT m.*, l.name AS leader_name FROM members m
     LEFT JOIN leaders l ON l.id = m.leader_id ORDER BY m.name ASC`,
    (err, results) => {
      if (err) return res.json([]);
      res.json(results);
    }
  );
});

// Get all distinct dates that have attendance records
app.get('/attendance/dates', requireAdmin, (req, res) => {
  db.query(
    'SELECT DISTINCT date FROM attendance ORDER BY date DESC',
    (err, results) => {
      if (err) return res.json([]);
      res.json(results.map(r => r.date));
    }
  );
});


// ---------- Leaders ----------
app.get('/leaders', requireAdmin, (req, res) => {
  db.query(
    `SELECT l.id, l.name, l.phone, COUNT(m.id) AS member_count
     FROM leaders l LEFT JOIN members m ON m.leader_id = l.id
     GROUP BY l.id, l.name, l.phone ORDER BY l.name ASC`,
    (err, results) => {
      if (err) return res.json([]);
      res.json(results);
    }
  );
});

app.post('/leaders', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const phone = normalizePhone(req.body.phone) || null;
  if (!name) return res.json({ success: false, message: 'Leader name is required' });
  db.query('INSERT INTO leaders (name, phone) VALUES (?, ?)', [name, phone], (err, result) => {
    if (err) return res.json({ success: false, message: 'Could not save leader' });
    res.json({ success: true, id: result.insertId });
  });
});

app.delete('/leaders/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.query('UPDATE members SET leader_id = NULL WHERE leader_id = ?', [id], (err) => {
    if (err) return res.json({ success: false, message: 'Could not remove leader' });
    db.query('DELETE FROM leaders WHERE id = ?', [id], (err2) => {
      if (err2) return res.json({ success: false, message: 'Could not remove leader' });
      res.json({ success: true });
    });
  });
});

// Assign (or clear, with leaderId = null) a leader for one or many members at once.
app.post('/members/assign-leader', requireAdmin, (req, res) => {
  const ids = (Array.isArray(req.body.memberIds) ? req.body.memberIds : [])
    .map(n => parseInt(n, 10)).filter(Number.isInteger);
  const leaderId = req.body.leaderId ? parseInt(req.body.leaderId, 10) : null;
  if (ids.length === 0) return res.json({ success: false, message: 'Select at least one member' });
  const run = () => db.query('UPDATE members SET leader_id = ? WHERE id IN (?)', [leaderId, ids], (err, result) => {
    if (err) return res.json({ success: false, message: 'Could not assign leader' });
    res.json({ success: true, updated: result.affectedRows });
  });
  if (leaderId === null) return run();
  db.query('SELECT id FROM leaders WHERE id = ?', [leaderId], (err, rows) => {
    if (err || rows.length === 0) return res.json({ success: false, message: 'Leader not found' });
    run();
  });
});

// Get everyone whose birthday is today (or a given day/month via query params)
function getBirthdayPeople(day, month) {
  return new Promise((resolve, reject) => {
    db.query(
      'SELECT * FROM members WHERE birthday_day = ? AND birthday_month = ? ORDER BY name ASC',
      [day, month],
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      }
    );
  });
}

app.get('/birthdays/today', requireAdmin, async (req, res) => {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  try {
    const people = await getBirthdayPeople(day, month);
    res.json(people);
  } catch (err) {
    res.json([]);
  }
});

// Triggers today's birthday email. Protected by a shared secret so randoms
// on the internet can't spam your inbox. Call this from an external daily
// scheduler (e.g. cron-job.org) as a reliable backup to the in-app cron below —
// useful because Render's free tier can put the app to sleep, which would
// skip the in-app cron if nothing else is waking the server up.
app.get('/birthdays/send-today', async (req, res) => {
  if (!process.env.BIRTHDAY_CRON_SECRET || req.query.token !== process.env.BIRTHDAY_CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  try {
    const people = await getBirthdayPeople(day, month);
    const result = await sendBirthdayEmailIfAny(people, dateLabel);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send birthday email', error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Church attendance server running on port ' + PORT);

  // In-app daily scheduler — runs at BIRTHDAY_EMAIL_TIME, default "06:00".
  // Accepts 24h "HH:mm" (e.g. "06:00") or 12h "H:mm AM/PM" (e.g. "6:00 AM").
  // Falls back safely to 06:00 and logs a warning instead of crashing the
  // whole server if the value is invalid — a bad env var should never take
  // check-ins down.
  function parseEmailTime(raw) {
    const fallback = { hh: 6, mm: 0 };
    if (!raw) return fallback;
    const match = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/);
    if (!match) {
      console.warn(`BIRTHDAY_EMAIL_TIME "${raw}" is not valid (use "HH:mm" like "06:00" or "6:00 AM"). Falling back to 06:00.`);
      return fallback;
    }
    let hh = Number(match[1]);
    const mm = Number(match[2]);
    const ampm = match[3] ? match[3].toUpperCase() : null;
    if (ampm === 'PM' && hh < 12) hh += 12;
    if (ampm === 'AM' && hh === 12) hh = 0;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      console.warn(`BIRTHDAY_EMAIL_TIME "${raw}" is out of range. Falling back to 06:00.`);
      return fallback;
    }
    return { hh, mm };
  }

  const { hh, mm } = parseEmailTime(process.env.BIRTHDAY_EMAIL_TIME);
  const cronExpr = `${mm} ${hh} * * *`;
  cron.schedule(cronExpr, async () => {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    try {
      const people = await getBirthdayPeople(day, month);
      const result = await sendBirthdayEmailIfAny(people, dateLabel);
      console.log('Birthday email check:', result);
    } catch (err) {
      console.error('Birthday email check failed:', err.message);
    }
  }, { timezone: process.env.BIRTHDAY_TZ || 'Africa/Accra' });
  console.log(`Birthday email scheduled for ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} (${process.env.BIRTHDAY_TZ || 'Africa/Accra'})`);
});
