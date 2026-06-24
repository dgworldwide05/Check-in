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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  phone VARCHAR(20),
  type VARCHAR(10),
  department VARCHAR(255),
  date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  member_id VARCHAR(20)
);
