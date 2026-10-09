const db = require('./db');

// Makes sure the leader tables/columns exist every time the server starts, so the
// app never breaks if the code is deployed before migrations/001_add_leaders.sql
// has been run. Everything here is idempotent and never touches existing rows.
// (This does NOT link existing members to leaders - that is what the migration
// SQL file does, using Dcn.xlsx.)

// Same leaders, same order as Dcn.xlsx. Only inserted when the leaders table is empty.
const DEFAULT_LEADERS = [
  "Ps. Loretta Essien",
  "DNC NATHANIEL",
  "DCN ISAAC",
  "SHP OLIVER",
  "DCNS GIFTY",
  "PS BISMARK",
  "DCNS IRENE",
  "Deacon Tom",
  "DCN ASAMOAH",
  "DNC ELLA NORTEY"
];

function q(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function ensureLeaderSchema() {
  await q(`CREATE TABLE IF NOT EXISTS leaders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  const col = await q(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'leader_id'`
  );
  if (!col[0].c) await q('ALTER TABLE members ADD COLUMN leader_id INT NULL');

  const idx = await q(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND INDEX_NAME = 'idx_members_leader_id'`
  );
  if (!idx[0].c) await q('CREATE INDEX idx_members_leader_id ON members (leader_id)');

  const count = await q('SELECT COUNT(*) AS c FROM leaders');
  if (!count[0].c) {
    await q('INSERT IGNORE INTO leaders (name) VALUES ?', [DEFAULT_LEADERS.map(n => [n])]);
  }
}

module.exports = { ensureLeaderSchema };
