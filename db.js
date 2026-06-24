const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Dominic12-12',
  database: 'church_attendance'   // <-- its own dedicated database
});

db.connect((err) => {
  if (err) {
    console.log('Database connection failed:', err);
  } else {
    console.log('Connected to MySQL (church_attendance)!');
  }
});

module.exports = db;
