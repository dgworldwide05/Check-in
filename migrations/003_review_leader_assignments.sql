-- 003_review_leader_assignments.sql
-- Read-only checks. Run each query on its own and look at the result.
-- Run 001_add_leaders.sql first.

-- 1) Everyone in the database who still has NO leader.
SELECT m.id, m.name, m.phone, m.type
FROM members m
WHERE m.leader_id IS NULL
ORDER BY m.name;

-- 2) People in Dcn.xlsx that are NOT in the database (by phone or exact name).
SELECT r.leader_name AS leader, r.member_name, r.phone
FROM leader_roster_import r
WHERE NOT EXISTS (SELECT 1 FROM members m WHERE r.phone IS NOT NULL AND (CASE WHEN REPLACE(TRIM(m.phone),' ','') LIKE '+233%' THEN CONCAT('0',SUBSTRING(REPLACE(TRIM(m.phone),' ',''),5)) ELSE REPLACE(TRIM(m.phone),' ','') END) = r.phone)
  AND NOT EXISTS (SELECT 1 FROM members m WHERE LOWER(TRIM(REPLACE(REPLACE(REPLACE(m.name,'  ',' '),'  ',' '),'  ',' '))) = r.name_norm)
ORDER BY r.leader_name, r.member_name;

-- 3) Needs a human decision: a person with no leader in the database whose
--    name is in the sheet, but the phone number differs (or the sheet lists
--    them under two leaders). Check the leader, then assign with the UPDATE
--    shown in MIGRATION.md.
SELECT m.id, m.name AS db_name, m.phone AS db_phone,
       r.member_name AS sheet_name, r.phone AS sheet_phone, r.leader_name AS sheet_leader
FROM members m
JOIN leader_roster_import r ON r.name_norm = LOWER(TRIM(REPLACE(REPLACE(REPLACE(m.name,'  ',' '),'  ',' '),'  ',' ')))
WHERE m.leader_id IS NULL
ORDER BY m.name, r.leader_name;

-- 4) Cross-check: members whose leader differs from what the sheet says for
--    their phone number. Empty = every automatic match agrees with the sheet.
--    (Rows here are expected only for people you reassigned by hand.)
SELECT m.id, m.name, m.phone, l.name AS database_leader, r.leader_name AS sheet_leader
FROM members m
JOIN leaders l ON l.id = m.leader_id
JOIN leader_roster_import r ON r.phone = (CASE WHEN REPLACE(TRIM(m.phone),' ','') LIKE '+233%' THEN CONCAT('0',SUBSTRING(REPLACE(TRIM(m.phone),' ',''),5)) ELSE REPLACE(TRIM(m.phone),' ','') END) AND r.phone_leaders = 1
WHERE r.leader_name <> l.name;

-- 5) Head-count per leader.
SELECT l.id, l.name AS leader, COUNT(m.id) AS members
FROM leaders l LEFT JOIN members m ON m.leader_id = l.id
GROUP BY l.id, l.name ORDER BY l.id;
