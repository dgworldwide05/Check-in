const mysql = require('mysql2');

const isProd = process.env.NODE_ENV === 'production' || !!process.env.DB_HOST;

// No default password in the code. Locally, set DB_PASSWORD in your shell or
// a .env-style setup; on Render, set it in the environment variables.
if (isProd && !process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD environment variable is required in production.');
}

// A pool (not a single connection) so dropped/idle connections are replaced
// automatically instead of every query failing until a restart.
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'church_attendance',
  ssl: process.env.DB_HOST ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: 5,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

db.getConnection((err, conn) => {
  if (err) {
    console.log('Database connection failed:', err.message);
  } else {
    console.log('Connected to MySQL (' + (process.env.DB_NAME || 'church_attendance') + ')!');
    conn.release();
  }
});

module.exports = db;
