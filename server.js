const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
  const { name, phone, type, departments, birthdayDay, birthdayMonth, location } = req.body;
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
  if (!bDay || !bMonth) return res.json({ success: false, message: 'Please select your birthday (day and month)' });
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
app.get('/member/:phone', (req, res) => {
  const phone = req.params.phone.trim();
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
  const phone = (req.body.phone || '').trim();
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
app.get('/attendance', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  db.query(
    'SELECT * FROM attendance WHERE date = ? ORDER BY id DESC',
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
  db.query('SELECT * FROM members ORDER BY name ASC', (err, results) => {
    if (err) return res.json([]);
    res.json(results);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Church attendance server running on port ' + PORT);
});
