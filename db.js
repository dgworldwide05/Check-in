const mysql = require('mysql2');

// These read from environment variables when set (used on Render/TiDB Cloud).
// If not set, they fall back to your local MySQL setup — so this file
// works unchanged both on your PC and once hosted.
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Dominic12-12',
  database: process.env.DB_NAME || 'church_attendance',
  ssl: process.env.DB_HOST ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
});

db.connect((err) => {
  if (err) {
    console.log('Database connection failed:', err);
  } else {
    console.log('Connected to MySQL (' + (process.env.DB_NAME || 'church_attendance') + ')!');
  }
});

module.exports = db;
