const db = require('./db');
const roster = require('./roster-data');

// Makes sure the leader tables/columns exist every time the server starts, so the
// app never breaks if the code is deployed before migrations/001_add_leaders.sql
// has been run. Everything here is idempotent and never touches existing rows.
// On first start it also links existing members to their leaders from Dcn.xlsx
// (see linkExistingMembersOnce below), so running the SQL file by hand is optional.

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

  await linkExistingMembersOnce();
}

// One-time: link members who are already in the database to their leader using
// Dcn.xlsx. Same rules as migrations/001_add_leaders.sql. It only fills empty
// leader_id values (never overwrites) and runs only the first time - the presence
// of the leader_roster_import table is the "already done" marker, so leaders you
// change later are never touched on restart.
async function linkExistingMembersOnce() {
  const done = await q(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leader_roster_import'`
  );
  if (done[0].c) return;
  await q(roster.createRosterTable);
  await q(roster.insertRoster);
  for (const stmt of roster.linkStatements) await q(stmt);
  const r = await q('SELECT COUNT(*) AS total, SUM(leader_id IS NOT NULL) AS linked FROM members');
  console.log(`Linked existing members to leaders: ${r[0].linked || 0} of ${r[0].total}`);
}

module.exports = { ensureLeaderSchema };
