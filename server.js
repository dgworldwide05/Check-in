const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const cron = require('node-cron');
const db = require('./db');
const { sendBirthdayEmailIfAny, MONTH_NAMES } = require('./mailer');
const { ensureLeaderSchema } = require('./db-init');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Leaders ----------

// Every way a Ghana number can be written ("0244123456", "+233244123456", "233244123456")
// so a member is found no matter how the number was typed at sign-up or check-in.
function phoneVariants(raw) {
  const p = (raw || '').trim().replace(/\s+/g, '');
  let local = p;
  if (/^\+233\d{9}$/.test(p)) local = '0' + p.slice(4);
  else if (/^233\d{9}$/.test(p)) local = '0' + p.slice(3);
  const variants = new Set([p, local]);
  if (/^0\d{9}$/.test(local)) variants.add('+233' + local.slice(1));
  return [...variants].filter(Boolean);
}

// A member row together with the name of their assigned leader (null if none yet).
const MEMBER_WITH_LEADER_BY_PHONE =
  'SELECT m.*, l.name AS leader FROM members m LEFT JOIN leaders l ON l.id = m.leader_id WHERE m.phone IN (?)';

const sameName = (a, b) => (a || '').trim().replace(/\s+/g, ' ').toLowerCase() === (b || '').trim().replace(/\s+/g, ' ').toLowerCase();

// List of existing leaders (feeds the Leader dropdowns)
app.get('/leaders', (req, res) => {
  db.query('SELECT id, name FROM leaders ORDER BY id ASC', (err, results) => {
    if (err) return res.json([]);
    res.json(results);
  });
});

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
  const { name, phone, type, departments, birthdayDay, birthdayMonth, location, leaderId } = req.body;
  const deptList = Array.isArray(departments) ? departments : (departments ? [departments] : []);
  if (deptList.includes('None') && deptList.length > 1) {
    return res.json({ success: false, message: '"None" cannot be combined with other departments' });
  }
  if (deptList.length > 3) {
    return res.json({ success: false, message: 'You can select up to 3 departments only' });
  }
  const dept = deptList.join(', ');
  const bDay = birthdayDay ? parseInt(birthdayDay, 10) : null;
  const bMonth = birthdayMonth ? parseInt(birthdayMonth, 10) : null;
  const loc = (location || '').trim() || null;
  const date = new Date().toISOString().split('T')[0];

  if (!name || !phone) return res.json({ success: false, message: 'Name and phone number are required' });
  if (!loc) return res.json({ success: false, message: 'Please tell us where you stay' });

  db.query(MEMBER_WITH_LEADER_BY_PHONE, [phoneVariants(phone)], (err, existing) => {
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
              leader: member.leader || null,
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
                    leader: member.leader || null,
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
                leader: member.leader || null,
                alreadyRegistered: true,
                alreadyCheckedIn: false
              });
            }
          );
        }
      );
    }

    // First-time person: save them (with their leader, if one was chosen) and check them in.
    const insertNewMember = (leaderRow) => {
      const leaderName = leaderRow ? leaderRow.name : null;
      db.query(
        'INSERT INTO members (name, phone, type, department, birthday_day, birthday_month, location, leader_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, phone, type, dept, bDay, bMonth, loc, leaderRow ? leaderRow.id : null],
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
                    leader: leaderName,
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
                leader: leaderName,
                alreadyRegistered: false
              });
            }
          );
        }
      );
    };

    const wantedLeader = parseInt(leaderId, 10) || null;
    if (!wantedLeader) return insertNewMember(null);
    db.query('SELECT id, name FROM leaders WHERE id = ?', [wantedLeader], (lerr, lrows) => {
      if (lerr) return res.json({ success: false, message: 'Error checking leader' });
      if (lrows.length === 0) return res.json({ success: false, message: 'Selected leader was not found' });
      insertNewMember(lrows[0]);
    });
  });
});

// Look up a member by their phone number (used to show "Welcome back, name" before confirming)
app.get('/member/:phone', (req, res) => {
  const phone = req.params.phone.trim();
  db.query(MEMBER_WITH_LEADER_BY_PHONE, [phoneVariants(phone)], (err, results) => {
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
      location: m.location,
      leader: m.leader || null
    });
  });
});

// Returning member check-in — just the phone number, no re-entering details
app.post('/checkin/id', (req, res) => {
  const phone = (req.body.phone || '').trim();
  if (!phone) return res.json({ success: false, message: 'Please enter your phone number' });

  db.query(MEMBER_WITH_LEADER_BY_PHONE, [phoneVariants(phone)], (err, results) => {
    if (err) return res.json({ success: false, message: 'Error looking up phone number' });
    if (results.length === 0) return res.json({ success: false, message: 'Phone number not found. Please sign up first.' });

    const member = results[0];
    const date = new Date().toISOString().split('T')[0];

    db.query(
      'SELECT * FROM attendance WHERE phone = ? AND date = ?',
      [member.phone, date],
      (err2, already) => {
        if (err2) return res.json({ success: false, message: 'Error checking attendance' });
        if (already.length > 0) {
          return res.json({
            success: true,
            message: 'You are already checked in today!',
            name: member.name,
            leader: member.leader || null,
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
                  leader: member.leader || null,
                  alreadyCheckedIn: true
                });
              }
              return res.json({ success: false, message: 'Error saving attendance' });
            }
            res.json({
              success: true,
              message: 'Checked in successfully!',
              name: member.name,
              leader: member.leader || null,
              alreadyCheckedIn: false
            });
          }
        );
      }
    );
  });
});

// Get attendance by date (defaults to today)
app.get('/attendance', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  db.query(
    // Leader comes from the member's saved record (matched on phone), so past
    // attendance rows show the leader too without any change to attendance data.
    `SELECT a.*, l.name AS leader
     FROM attendance a
     LEFT JOIN members m ON m.phone = a.phone
     LEFT JOIN leaders l ON l.id = m.leader_id
     WHERE a.date = ?
     ORDER BY a.id DESC`,
    [date],
    (err, results) => {
      if (err) return res.json([]);
      res.json(results);
    }
  );
});

// Get attendance stats by date (defaults to today)
app.get('/attendance/stats', (req, res) => {
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
app.get('/members', (req, res) => {
  db.query(
    `SELECT m.*, l.name AS leader
     FROM members m LEFT JOIN leaders l ON l.id = m.leader_id
     ORDER BY m.name ASC`,
    (err, results) => {
      if (err) return res.json([]);
      res.json(results);
    }
  );
});

// Register a person (no check-in) and assign them to an existing leader.
// Members must have a leader; visitors may optionally have one.
app.post('/members', (req, res) => {
  const { name, phone, type, departments, birthdayDay, birthdayMonth, location, leaderId } = req.body;
  const cleanName = (name || '').trim().replace(/\s+/g, ' ');
  const cleanPhone = (phone || '').trim();
  const memberType = type === 'visitor' ? 'visitor' : 'member';
  const loc = (location || '').trim() || null;
  const deptList = memberType === 'visitor' ? [] : (Array.isArray(departments) ? departments : (departments ? [departments] : []));
  const bDay = birthdayDay ? parseInt(birthdayDay, 10) : null;
  const bMonth = birthdayMonth ? parseInt(birthdayMonth, 10) : null;
  const wantedLeader = parseInt(leaderId, 10) || null;

  if (!cleanName) return res.json({ success: false, message: 'Please enter their name' });
  if (!/^[a-zA-Z\s]+$/.test(cleanName)) return res.json({ success: false, message: 'Please enter a valid name (letters only)' });
  if (!cleanPhone) return res.json({ success: false, message: 'Please enter a phone number' });
  if (!/^(\+233|0)[0-9]{9}$/.test(cleanPhone)) return res.json({ success: false, message: 'Please enter a valid Ghana phone number' });
  if (!loc) return res.json({ success: false, message: 'Please enter where they stay' });
  if (deptList.includes('None') && deptList.length > 1) {
    return res.json({ success: false, message: '"None" cannot be combined with other departments' });
  }
  if (deptList.length > 3) return res.json({ success: false, message: 'You can select up to 3 departments only' });
  if (memberType === 'member' && !wantedLeader) return res.json({ success: false, message: 'Please choose a leader' });
  if ((bDay && (bDay < 1 || bDay > 31)) || (bMonth && (bMonth < 1 || bMonth > 12))) {
    return res.json({ success: false, message: 'Please enter a valid birthday' });
  }
  const dept = deptList.join(', ');

  const finish = (leaderRow) => {
    db.query(MEMBER_WITH_LEADER_BY_PHONE, [phoneVariants(cleanPhone)], (err, existing) => {
      if (err) return res.json({ success: false, message: 'Error checking member record' });

      if (existing.length > 0) {
        const m = existing[0];
        if (!sameName(m.name, cleanName)) {
          return res.json({ success: false, message: `This phone number is already registered to ${m.name}.` });
        }
        if (m.leader) {
          return res.json({ success: false, message: `${m.name} is already registered under ${m.leader}.` });
        }
        // Already on file but never given a leader: just assign the leader we were given.
        if (!leaderRow) return res.json({ success: false, message: `${m.name} is already registered. Choose a leader to assign them.` });
        return db.query('UPDATE members SET leader_id = ? WHERE id = ? AND leader_id IS NULL', [leaderRow.id, m.id], (uerr) => {
          if (uerr) return res.json({ success: false, message: 'Error saving leader' });
          res.json({ success: true, assigned: true, name: m.name, phone: m.phone, leader: leaderRow.name,
            message: `${m.name} was already registered - now assigned to ${leaderRow.name}.` });
        });
      }

      db.query(
        'INSERT INTO members (name, phone, type, department, birthday_day, birthday_month, location, leader_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [cleanName, cleanPhone, memberType, dept, bDay, bMonth, loc, leaderRow ? leaderRow.id : null],
        (ierr) => {
          if (ierr) {
            if (ierr.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: 'This phone number is already registered.' });
            console.error('INSERT INTO members failed:', ierr.code, ierr.sqlMessage || ierr.message);
            return res.json({ success: false, message: 'Error saving member record' });
          }
          res.json({ success: true, assigned: false, name: cleanName, phone: cleanPhone, leader: leaderRow ? leaderRow.name : null,
            message: leaderRow ? `${cleanName} added under ${leaderRow.name}.` : `${cleanName} added.` });
        }
      );
    });
  };

  if (!wantedLeader) return finish(null);
  db.query('SELECT id, name FROM leaders WHERE id = ?', [wantedLeader], (lerr, lrows) => {
    if (lerr) return res.json({ success: false, message: 'Error checking leader' });
    if (lrows.length === 0) return res.json({ success: false, message: 'Selected leader was not found' });
    finish(lrows[0]);
  });
});

// Get all distinct dates that have attendance records
app.get('/attendance/dates', (req, res) => {
  db.query(
    'SELECT DISTINCT date FROM attendance ORDER BY date DESC',
    (err, results) => {
      if (err) return res.json([]);
      res.json(results.map(r => r.date));
    }
  );
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

app.get('/birthdays/today', async (req, res) => {
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
ensureLeaderSchema()
  .catch((err) => console.error('Leader schema check failed (run migrations/001_add_leaders.sql):', err.message))
  .then(() => app.listen(PORT, () => {
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
}));
