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
    const url = `https://YOUR-NGROK-DOMAIN-HERE.ngrok-free.dev/checkin.html`;
    const qr = await QRCode.toDataURL(url);
    res.json({ qr, url });
  } catch (err) {
    res.json({ error: 'Failed to generate QR code' });
  }
});

// Generate the next member ID, e.g. DG-0001, DG-0002, ...
function generateNextMemberId(callback) {
  db.query(
    "SELECT member_id FROM members ORDER BY id DESC LIMIT 1",
    (err, results) => {
      if (err) return callback(err);
      let nextNum = 1;
      if (results.length > 0) {
        const last = results[0].member_id || '';
        const match = last.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      const memberId = 'DG-' + String(nextNum).padStart(4, '0');
      callback(null, memberId);
    }
  );
}

// Generate a QR code that encodes a member's ID (so they can scan instead of typing)
app.get('/qrcode/member/:memberId', async (req, res) => {
  try {
    const qr = await QRCode.toDataURL(req.params.memberId.trim().toUpperCase());
    res.json({ qr });
  } catch (err) {
    res.json({ error: 'Failed to generate Member ID QR code' });
  }
});

// Submit attendance (first-time signup) — creates a member record + gives a Member ID
app.post('/checkin', (req, res) => {
  const { name, phone, type, departments } = req.body;
  const dept = Array.isArray(departments) ? departments.join(', ') : (departments || '');
  const date = new Date().toISOString().split('T')[0];

  db.query('SELECT * FROM members WHERE phone = ?', [phone], (err, existing) => {
    if (err) return res.json({ success: false, message: 'Error checking member record' });

    if (existing.length > 0) {
      const member = existing[0];
      return db.query(
        'INSERT INTO attendance (name, phone, type, department, date, member_id) VALUES (?, ?, ?, ?, ?, ?)',
        [member.name, member.phone, member.type, member.department, date, member.member_id],
        (err2) => {
          if (err2) return res.json({ success: false, message: 'Error saving attendance' });
          res.json({
            success: true,
            message: 'Welcome back! You already have a Member ID.',
            memberId: member.member_id,
            alreadyRegistered: true
          });
        }
      );
    }

    generateNextMemberId((genErr, memberId) => {
      if (genErr) return res.json({ success: false, message: 'Error generating Member ID' });

      db.query(
        'INSERT INTO members (member_id, name, phone, type, department) VALUES (?, ?, ?, ?, ?)',
        [memberId, name, phone, type, dept],
        (err2) => {
          if (err2) return res.json({ success: false, message: 'Error saving member record' });

          db.query(
            'INSERT INTO attendance (name, phone, type, department, date, member_id) VALUES (?, ?, ?, ?, ?, ?)',
            [name, phone, type, dept, date, memberId],
            (err3) => {
              if (err3) return res.json({ success: false, message: 'Error saving attendance' });
              res.json({
                success: true,
                message: 'Attendance recorded!',
                memberId,
                alreadyRegistered: false
              });
            }
          );
        }
      );
    });
  });
});

// Look up a member's ID by their phone number (for "Forgot your Member ID?")
app.get('/member/by-phone/:phone', (req, res) => {
  const phone = req.params.phone.trim();
  db.query('SELECT * FROM members WHERE phone = ?', [phone], (err, results) => {
    if (err) return res.json({ success: false, message: 'Lookup failed' });
    if (results.length === 0) return res.json({ success: false, message: 'No Member ID found for that phone number.' });
    const m = results[0];
    res.json({ success: true, memberId: m.member_id, name: m.name });
  });
});

// Look up a member by their Member ID (used to show "Welcome back, name" before confirming)
app.get('/member/:memberId', (req, res) => {
  const memberId = req.params.memberId.trim().toUpperCase();
  db.query('SELECT * FROM members WHERE member_id = ?', [memberId], (err, results) => {
    if (err) return res.json({ success: false, message: 'Lookup failed' });
    if (results.length === 0) return res.json({ success: false, message: 'Member ID not found' });
    const m = results[0];
    res.json({
      success: true,
      memberId: m.member_id,
      name: m.name,
      phone: m.phone,
      type: m.type,
      department: m.department
    });
  });
});

// Returning member check-in — just the Member ID, no re-entering details
app.post('/checkin/id', (req, res) => {
  const memberId = (req.body.memberId || '').trim().toUpperCase();
  if (!memberId) return res.json({ success: false, message: 'Please enter your Member ID' });

  db.query('SELECT * FROM members WHERE member_id = ?', [memberId], (err, results) => {
    if (err) return res.json({ success: false, message: 'Error looking up Member ID' });
    if (results.length === 0) return res.json({ success: false, message: 'Member ID not found. Please sign up first.' });

    const member = results[0];
    const date = new Date().toISOString().split('T')[0];

    db.query(
      'SELECT * FROM attendance WHERE member_id = ? AND date = ?',
      [memberId, date],
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
          'INSERT INTO attendance (name, phone, type, department, date, member_id) VALUES (?, ?, ?, ?, ?, ?)',
          [member.name, member.phone, member.type, member.department, date, memberId],
          (err3) => {
            if (err3) return res.json({ success: false, message: 'Error saving attendance' });
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

app.listen(3000, () => {
  console.log('Church attendance server running on http://localhost:3000');
});
