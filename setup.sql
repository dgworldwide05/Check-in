-- Run this once in MySQL to set up the church_attendance database.
-- Open MySQL Command Line, then paste this whole block.

CREATE DATABASE IF NOT EXISTS church_attendance;
USE church_attendance;

CREATE TABLE IF NOT EXISTS members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_id VARCHAR(20) UNIQUE,
  name VARCHAR(100),
  phone VARCHAR(20) UNIQUE,
  type VARCHAR(10),
  department VARCHAR(255),
  birthday_day TINYINT,
  birthday_month TINYINT,
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  phone VARCHAR(20),
  type VARCHAR(10),
  department VARCHAR(255),
  birthday_day TINYINT,
  birthday_month TINYINT,
  location VARCHAR(255),
  date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  member_id VARCHAR(20),
  UNIQUE KEY uq_phone_date (phone, date)
);

-- If you already have this database set up from before, run these two
-- blocks instead of the CREATE TABLE statements above to add the new
-- columns without losing your existing data (MySQL 8+):
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS birthday_day TINYINT,
  ADD COLUMN IF NOT EXISTS birthday_month TINYINT,
  ADD COLUMN IF NOT EXISTS location VARCHAR(255);

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS birthday_day TINYINT,
  ADD COLUMN IF NOT EXISTS birthday_month TINYINT,
  ADD COLUMN IF NOT EXISTS location VARCHAR(255);

-- For an EXISTING database: remove duplicate same-day check-ins first (keeps the earliest),
-- then add the unique key that stops them happening again.
DELETE a FROM attendance a
JOIN attendance b ON a.phone = b.phone AND a.date = b.date AND a.id > b.id;
ALTER TABLE attendance ADD UNIQUE KEY uq_phone_date (phone, date);

-- ---------- Leaders ----------
-- Each member can be assigned to one leader. Attendance shows the member's
-- current leader automatically (looked up by phone number).
CREATE TABLE IF NOT EXISTS leaders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE members ADD COLUMN leader_id INT NULL;
